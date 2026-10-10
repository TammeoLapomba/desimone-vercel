-- ============================================================
-- 022_movimenti.sql — Movimentazione dello stock, fetta 1: il registro dei movimenti
--
-- Realizza il database della sede (P-05) per i componenti logici L-05, L-06 e L-07 della WBA
-- (docs/movimentazione-stock-wba.html v0.5, BBA v1.7): luoghi, operatori, dispositivi, bilance,
-- causali, registro dei movimenti, giacenza come somma dei movimenti, registrazione e annullamento.
--
-- Portabile: gira uguale su Supabase (sviluppo, dati finti) e su PostgreSQL 17 con PostgREST
-- (PC server, scelta D-1). L'utente si legge dal token (request.jwt.claims), non da auth.users;
-- le sole parti di Supabase stanno nei blocchi protetti in fondo.
--
-- Additiva: l'app di oggi continua a funzionare. Delle tabelle esistenti tocca solo raw_items, con la colonna
-- "unit" (valore predefinito, quindi gli inserimenti di oggi non cambiano) e il blocco del suo cambio dopo i
-- primi movimenti. Prove: supabase/tests/run.sh, su un PostgreSQL 17 vuoto. Restano per le fette successive:
-- fiere, conte, conto visione, foto dei movimenti, eliminazione con scelta sullo storico
-- (REQ-A-01…06), passaggio del catalogo alla giacenza nuova.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Tipi
-- ------------------------------------------------------------
CREATE TYPE operator_role AS ENUM ('admin', 'laboratorio', 'negozio', 'fiere');  -- BBA Step 2
CREATE TYPE location_kind AS ENUM ('sede', 'fiera');                              -- REQ-F-01: ogni fiera è un luogo
CREATE TYPE movement_type AS ENUM ('C', 'S', 'T');   -- carico, scarico, trasferimento (REQ-M-23); la lettera entra nel codice
CREATE TYPE weight_source AS ENUM ('bilancia', 'mano', 'calcolo');                -- REQ-U-25
CREATE TYPE raw_unit AS ENUM ('pezzi', 'grammi', 'pezzi_grammi');                 -- REQ-U-03

-- ------------------------------------------------------------
-- Utente dal token: stesso codice su Supabase e su PostgREST
-- ------------------------------------------------------------
CREATE FUNCTION current_operator_id()
RETURNS uuid AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- Anagrafiche del registro
-- ------------------------------------------------------------

-- Luoghi (REQ-001.1, M-07). "active" invece di cancellare: rinomina e disattivazione sono un punto aperto della BBA.
CREATE TABLE locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  kind       location_kind NOT NULL DEFAULT 'sede',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Operatori (REQ-001.3, P-03). In sviluppo l'id è quello dell'utente di Supabase;
-- nella sede lo assegna il servizio (P-07), che firma il token con lo stesso "sub".
CREATE TABLE operators (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  role       operator_role NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Luogo proposto per ruolo (REQ-B-05); chi non ne ha uno lo sceglie (REQ-B-06)
CREATE TABLE role_locations (
  role        operator_role PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES locations(id)
);

-- Dispositivi (REQ-D-04, S-01…S-03): la sigla entra nel codice del movimento
CREATE TABLE devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,6}$'),
  name       text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bilance (CR7: REQ-I-09, I-11, U-26). device_id NULL = collegata alla sede (PC server);
-- altrimenti collegata via cavo a quel dispositivo.
CREATE TABLE scales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  model         text,
  serial_number text UNIQUE,                       -- dal comando I4 della bilancia
  device_id     uuid REFERENCES devices(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scales_one_at_site   ON scales ((true))    WHERE active AND device_id IS NULL;
CREATE UNIQUE INDEX scales_one_per_device ON scales (device_id) WHERE active AND device_id IS NOT NULL;

-- Causali per tipo di movimento (REQ-M-15, M-16). allowed_roles traduce la matrice dei permessi
-- della BBA (Step 2); l'amministrazione può sempre. Le causali "system" le usa solo il registro.
CREATE TABLE movement_reasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  movement_type movement_type NOT NULL,
  allowed_roles operator_role[] NOT NULL DEFAULT '{}',
  system        boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0
);

-- Unità di misura del semilavorato (REQ-U-02, U-03). La sceglie l'anagrafica; il valore iniziale
-- è un'ipotesi da confermare con l'azienda articolo per articolo.
ALTER TABLE raw_items ADD COLUMN unit raw_unit NOT NULL DEFAULT 'pezzi_grammi';

-- ------------------------------------------------------------
-- Registro dei movimenti (L-07)
-- ------------------------------------------------------------
-- Un trasferimento è un solo movimento con due gambe (REQ-M-03, S-09). La giacenza non si scrive mai:
-- è la somma dei movimenti non annullati (par 6b della WBA).
CREATE TABLE movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code <> ''),     -- REQ-M-19, M-20: nasce sul dispositivo; registra una volta sola (REQ-E-11, D-02)
  movement_type    movement_type NOT NULL,                       -- REQ-M-23
  article_id       uuid REFERENCES articles(id),                 -- montato
  raw_item_id      uuid REFERENCES raw_items(id),                -- semilavorato
  from_location_id uuid REFERENCES locations(id),
  to_location_id   uuid REFERENCES locations(id),
  pieces           integer CHECK (pieces > 0),
  grams            numeric(10,1) CHECK (grams > 0),              -- REQ-U-05
  weight_source    weight_source,                                -- REQ-U-25
  scale_id         uuid REFERENCES scales(id),                   -- REQ-U-26
  reason_id        uuid NOT NULL REFERENCES movement_reasons(id),-- REQ-001.2, M-15
  note             text,                                         -- REQ-M-17
  document_ref     text,                                         -- REQ-001.9: bolla, ordine, lavorazione
  shown_stock      jsonb,                                        -- REQ-M-21: giacenza prima e dopo, come l'ha vista l'operatore
  operator_id      uuid NOT NULL REFERENCES operators(id),       -- REQ-001.3
  device_id        uuid NOT NULL REFERENCES devices(id),         -- REQ-M-19
  occurred_at      timestamptz NOT NULL,                         -- REQ-001.4, E-03: quando è avvenuto, non quando è arrivato
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  parent_id        uuid REFERENCES movements(id),                -- movimento che l'ha generato (differenza di pesatura)
  cancelled_at     timestamptz,                                  -- REQ-M-06, M-13
  cancelled_by     uuid REFERENCES operators(id),
  cancel_reason    text,
  CHECK ((article_id IS NULL) <> (raw_item_id IS NULL)),
  CHECK (CASE movement_type
           WHEN 'C' THEN from_location_id IS NULL AND to_location_id IS NOT NULL
           WHEN 'S' THEN from_location_id IS NOT NULL AND to_location_id IS NULL
           ELSE from_location_id IS NOT NULL AND to_location_id IS NOT NULL AND from_location_id <> to_location_id
         END),
  CHECK (pieces IS NOT NULL OR grams IS NOT NULL),
  CHECK ((grams IS NULL) = (weight_source IS NULL)),
  CHECK ((weight_source IS NOT DISTINCT FROM 'bilancia') = (scale_id IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX movements_article_idx  ON movements (article_id)       WHERE article_id IS NOT NULL;
CREATE INDEX movements_raw_item_idx ON movements (raw_item_id)      WHERE raw_item_id IS NOT NULL;
CREATE INDEX movements_from_idx     ON movements (from_location_id) WHERE from_location_id IS NOT NULL;
CREATE INDEX movements_to_idx       ON movements (to_location_id)   WHERE to_location_id IS NOT NULL;
CREATE INDEX movements_occurred_idx ON movements (occurred_at);
CREATE INDEX movements_parent_idx   ON movements (parent_id)        WHERE parent_id IS NOT NULL;

-- Gambe dei movimenti: una per ogni luogo toccato, con il segno (F-12)
CREATE VIEW movement_legs WITH (security_invoker = true) AS
  SELECT m.id AS movement_id, m.code, m.movement_type, m.article_id, m.raw_item_id,
         m.from_location_id AS location_id,
         -coalesce(m.pieces, 0) AS pieces, -coalesce(m.grams, 0) AS grams,
         m.occurred_at, m.recorded_at, m.cancelled_at IS NOT NULL AS cancelled
  FROM movements m WHERE m.from_location_id IS NOT NULL
  UNION ALL
  SELECT m.id, m.code, m.movement_type, m.article_id, m.raw_item_id,
         m.to_location_id,
         coalesce(m.pieces, 0), coalesce(m.grams, 0),
         m.occurred_at, m.recorded_at, m.cancelled_at IS NOT NULL
  FROM movements m WHERE m.to_location_id IS NOT NULL;

-- Giacenza per articolo e luogo (REQ-001.1, C-01: una sola quantità, qualunque sia il prezzo)
CREATE VIEW stock_levels WITH (security_invoker = true) AS
  SELECT article_id, raw_item_id, location_id,
         sum(pieces)::integer AS pieces, sum(grams) AS grams
  FROM movement_legs
  WHERE NOT cancelled
  GROUP BY article_id, raw_item_id, location_id;

-- Storico con la giacenza dopo ogni movimento, ricalcolata nell'ordine in cui i movimenti sono avvenuti
-- (REQ-M-01, M-22). Gli annullati restano, segnati, e non contano (REQ-M-13).
CREATE VIEW movement_history WITH (security_invoker = true) AS
  SELECT l.*,
         sum(CASE WHEN l.cancelled THEN 0 ELSE l.pieces END) OVER w AS pieces_after,
         sum(CASE WHEN l.cancelled THEN 0 ELSE l.grams END)  OVER w AS grams_after
  FROM movement_legs l
  WINDOW w AS (PARTITION BY l.article_id, l.raw_item_id, l.location_id
               ORDER BY l.occurred_at, l.recorded_at, l.code
               ROWS UNBOUNDED PRECEDING);

-- ------------------------------------------------------------
-- Funzioni del registro (L-06, L-07)
-- ------------------------------------------------------------

-- Operatore che fa la richiesta, solo se attivo
CREATE FUNCTION current_operator()
RETURNS operators AS $$
  SELECT o.* FROM operators o WHERE o.id = current_operator_id() AND o.active
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Chi sono e quale luogo mi viene proposto (REQ-B-05): per l'interfaccia
CREATE FUNCTION my_operator()
RETURNS jsonb AS $$
  SELECT jsonb_build_object('id', o.id, 'name', o.name, 'role', o.role,
                            'default_location_id', rl.location_id)
  FROM operators o LEFT JOIN role_locations rl ON rl.role = o.role
  WHERE o.id = current_operator_id() AND o.active
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Giacenza di un articolo in un luogo, dai movimenti non annullati. Gira con i permessi di chi la chiama:
-- chi non è operatore non vede movimenti, quindi non ricava giacenze.
CREATE FUNCTION item_stock(p_article_id uuid, p_raw_item_id uuid, p_location_id uuid,
                           OUT pieces integer, OUT grams numeric) AS $$
  SELECT coalesce(sum(CASE WHEN m.to_location_id = p_location_id THEN 1 ELSE -1 END * coalesce(m.pieces, 0)), 0)::integer,
         coalesce(sum(CASE WHEN m.to_location_id = p_location_id THEN 1 ELSE -1 END * coalesce(m.grams, 0)), 0)
  FROM movements m
  WHERE m.cancelled_at IS NULL
    AND (m.from_location_id = p_location_id OR m.to_location_id = p_location_id)
    AND CASE WHEN p_article_id IS NOT NULL THEN m.article_id = p_article_id
             ELSE m.raw_item_id = p_raw_item_id END
$$ LANGUAGE sql STABLE SET search_path = public;

-- Un solo movimento alla volta per articolo e luogo (REQ-B-01 con 10 operatori, REQ-N-01)
CREATE FUNCTION lock_item_locations(p_item uuid, p_locations uuid[])
RETURNS void AS $$
DECLARE
  v_key bigint;
BEGIN
  FOR v_key IN
    SELECT DISTINCT hashtextextended(p_item::text || ':' || l::text, 0)
    FROM unnest(p_locations) AS l WHERE l IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Registra un movimento chiesto da un operatore: tutto o niente (REQ-E-10), una volta sola (REQ-E-11, D-02).
-- Controlla nell'ordine: operatore, dispositivo, causale e permesso, articolo e unità, peso e bilancia,
-- luoghi, giacenza; poi scrive il movimento e, se i pezzi arrivano a zero, la differenza di pesatura.
CREATE FUNCTION register_movement(
  p_code             text,
  p_movement_type    movement_type,
  p_reason_id        uuid,
  p_device_id        uuid,
  p_occurred_at      timestamptz,
  p_article_id       uuid DEFAULT NULL,
  p_raw_item_id      uuid DEFAULT NULL,
  p_from_location_id uuid DEFAULT NULL,
  p_to_location_id   uuid DEFAULT NULL,
  p_pieces           integer DEFAULT NULL,
  p_grams            numeric DEFAULT NULL,
  p_weight_source    weight_source DEFAULT NULL,
  p_scale_id         uuid DEFAULT NULL,
  p_last             boolean DEFAULT false,
  p_note             text DEFAULT NULL,
  p_document_ref     text DEFAULT NULL,
  p_shown_stock      jsonb DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_op       operators;
  v_dev      devices;
  v_reason   movement_reasons;
  v_unit     raw_unit;
  v_scale    scales;
  v_dev_scale uuid;
  v_from     locations;
  v_to       locations;
  v_item     uuid := coalesce(p_article_id, p_raw_item_id);
  v_stock    record;
  v_sold     integer;
  v_mov      movements;
  v_diff     numeric;
  v_existing movements;
BEGIN
  -- Operatore (REQ-P-03)
  v_op := current_operator();
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operatore non riconosciuto o non attivo';
  END IF;
  IF coalesce(p_code, '') = '' THEN
    RAISE EXCEPTION 'Manca il codice del movimento';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'Manca il momento del movimento';
  END IF;

  -- Richiesta già registrata, per esempio ripetuta dopo un esito non arrivato: si restituisce quella
  SELECT * INTO v_existing FROM movements WHERE code = p_code;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'movement', to_jsonb(v_existing),
      'from_stock', CASE WHEN v_existing.from_location_id IS NOT NULL THEN
        (SELECT to_jsonb(s) FROM item_stock(v_existing.article_id, v_existing.raw_item_id, v_existing.from_location_id) s) END,
      'to_stock', CASE WHEN v_existing.to_location_id IS NOT NULL THEN
        (SELECT to_jsonb(s) FROM item_stock(v_existing.article_id, v_existing.raw_item_id, v_existing.to_location_id) s) END);
  END IF;

  -- Dispositivo (REQ-S-02, S-03)
  SELECT * INTO v_dev FROM devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispositivo sconosciuto';
  END IF;
  IF v_dev.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Dispositivo revocato: non può registrare movimenti';
  END IF;

  -- Causale del tipo giusto (REQ-M-15) e permessa al ruolo (REQ-P-01…P-05, M-04)
  SELECT * INTO v_reason FROM movement_reasons WHERE id = p_reason_id AND active AND NOT system;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Causale non valida';
  END IF;
  IF v_reason.movement_type <> p_movement_type THEN
    RAISE EXCEPTION 'La causale «%» non è del tipo di movimento scelto', v_reason.name;
  END IF;
  IF v_op.role <> 'admin' AND NOT (v_op.role = ANY (v_reason.allowed_roles)) THEN
    RAISE EXCEPTION 'Il ruolo % non può registrare «%»', v_op.role, v_reason.name;
  END IF;

  -- Articolo e quantità nella sua unità (REQ-U-01, U-02, U-04, U-10, U-22, U-23)
  IF (p_article_id IS NULL) = (p_raw_item_id IS NULL) THEN
    RAISE EXCEPTION 'Indicare un articolo, montato o semilavorato';
  END IF;
  IF p_article_id IS NOT NULL THEN
    PERFORM 1 FROM articles WHERE id = p_article_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Articolo non trovato';
    END IF;
    IF p_pieces IS NULL THEN
      RAISE EXCEPTION 'Per un gioiello servono i pezzi';
    END IF;
  ELSE
    SELECT unit INTO v_unit FROM raw_items WHERE id = p_raw_item_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Semilavorato non trovato';
    END IF;
    IF v_unit IN ('pezzi', 'pezzi_grammi') AND p_pieces IS NULL THEN
      RAISE EXCEPTION 'Per questo semilavorato servono i pezzi';
    END IF;
    IF v_unit = 'grammi' AND p_pieces IS NOT NULL THEN
      RAISE EXCEPTION 'Questo semilavorato si muove solo a grammi';
    END IF;
    IF v_unit = 'grammi' AND p_grams IS NULL THEN
      RAISE EXCEPTION 'Per questo semilavorato serve il peso';
    END IF;
    IF v_unit = 'pezzi_grammi' AND p_movement_type <> 'C'
       AND (p_grams IS NULL OR p_weight_source = 'calcolo') THEN
      RAISE EXCEPTION 'Per questo semilavorato serve il peso misurato di ogni uscita';
    END IF;
  END IF;

  -- Peso: decimo di grammo (REQ-U-05, U-09), origine (U-25) e bilancia (U-26, I-11)
  IF p_grams IS NOT NULL AND p_grams <> round(p_grams, 1) THEN
    RAISE EXCEPTION 'Il peso ha più di un decimale';
  END IF;
  IF (p_grams IS NULL) <> (p_weight_source IS NULL) THEN
    RAISE EXCEPTION 'Il peso deve dire da dove viene: bilancia, a mano o calcolo';
  END IF;
  IF p_weight_source = 'bilancia' THEN
    SELECT * INTO v_scale FROM scales WHERE id = p_scale_id AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bilancia sconosciuta o non attiva';
    END IF;
    SELECT id INTO v_dev_scale FROM scales WHERE device_id = v_dev.id AND active;
    IF v_dev_scale IS NOT NULL AND v_scale.id <> v_dev_scale THEN
      RAISE EXCEPTION 'Questo dispositivo ha una sua bilancia: il peso va letto da quella';
    END IF;
    IF v_scale.device_id IS NOT NULL AND v_scale.device_id <> v_dev.id THEN
      RAISE EXCEPTION 'La bilancia è collegata a un altro dispositivo';
    END IF;
  ELSIF p_scale_id IS NOT NULL THEN
    RAISE EXCEPTION 'La bilancia si indica solo per un peso letto dalla bilancia';
  END IF;

  -- Luoghi (REQ-M-03, F-03)
  IF p_from_location_id IS NOT NULL THEN
    SELECT * INTO v_from FROM locations WHERE id = p_from_location_id AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Luogo di partenza non valido';
    END IF;
  END IF;
  IF p_to_location_id IS NOT NULL THEN
    SELECT * INTO v_to FROM locations WHERE id = p_to_location_id AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Luogo di arrivo non valido';
    END IF;
  END IF;
  IF v_reason.code = 'vendita_fiera' AND v_from.kind IS DISTINCT FROM 'fiera' THEN
    RAISE EXCEPTION 'La vendita in fiera si scarica da una fiera';
  END IF;

  PERFORM lock_item_locations(v_item, ARRAY[p_from_location_id, p_to_location_id]);

  -- Giacenza nel luogo di partenza (REQ-B-01, con le eccezioni di REQ-U-11 e U-13)
  IF p_from_location_id IS NOT NULL THEN
    SELECT * INTO v_stock FROM item_stock(p_article_id, p_raw_item_id, p_from_location_id);
    IF p_pieces IS NOT NULL AND p_pieces > v_stock.pieces THEN
      RAISE EXCEPTION 'Quantità oltre la giacenza: in % ci sono % pezzi', v_from.name, v_stock.pieces;
    END IF;
    IF v_unit = 'grammi' AND p_grams > v_stock.grams AND NOT p_last THEN
      RAISE EXCEPTION 'Peso oltre la giacenza: in % ci sono % g', v_from.name, replace(v_stock.grams::text, '.', ',');
    END IF;
    IF v_unit = 'pezzi_grammi' AND p_grams > v_stock.grams AND p_pieces < v_stock.pieces THEN
      RAISE EXCEPTION 'Peso oltre la giacenza: in % ci sono % g', v_from.name, replace(v_stock.grams::text, '.', ',');
    END IF;
  END IF;

  -- Una vendita annullata non può superare il venduto in quel luogo (REQ-B-07)
  IF v_reason.code = 'annullamento_vendita' THEN
    SELECT coalesce(sum(CASE WHEN r.code IN ('vendita_banco', 'vendita_fiera') THEN m.pieces ELSE -m.pieces END), 0)
      INTO v_sold
    FROM movements m JOIN movement_reasons r ON r.id = m.reason_id
    WHERE m.cancelled_at IS NULL
      AND CASE WHEN p_article_id IS NOT NULL THEN m.article_id = p_article_id ELSE m.raw_item_id = p_raw_item_id END
      AND ((r.code IN ('vendita_banco', 'vendita_fiera') AND m.from_location_id = p_to_location_id)
        OR (r.code = 'annullamento_vendita' AND m.to_location_id = p_to_location_id));
    IF coalesce(p_pieces, 0) > v_sold THEN
      RAISE EXCEPTION 'Annullamento oltre il venduto: in % risultano venduti % pezzi', v_to.name, v_sold;
    END IF;
  END IF;

  INSERT INTO movements (code, movement_type, article_id, raw_item_id, from_location_id, to_location_id,
                         pieces, grams, weight_source, scale_id, reason_id, note, document_ref, shown_stock,
                         operator_id, device_id, occurred_at)
  VALUES (p_code, p_movement_type, p_article_id, p_raw_item_id, p_from_location_id, p_to_location_id,
          p_pieces, p_grams, p_weight_source, p_scale_id, p_reason_id, p_note, p_document_ref, p_shown_stock,
          v_op.id, v_dev.id, p_occurred_at)
  RETURNING * INTO v_mov;

  -- Differenza di pesatura (REQ-U-12, U-13, F-10): pezzi a zero, oppure ultimo scarico di un articolo a grammi
  IF p_from_location_id IS NOT NULL AND v_unit IN ('pezzi_grammi', 'grammi') THEN
    SELECT * INTO v_stock FROM item_stock(NULL, p_raw_item_id, p_from_location_id);
    IF v_stock.grams <> 0 AND ((v_unit = 'pezzi_grammi' AND v_stock.pieces = 0) OR (v_unit = 'grammi' AND p_last)) THEN
      v_diff := v_stock.grams;
      INSERT INTO movements (code, movement_type, raw_item_id, from_location_id, to_location_id, grams, weight_source,
                             reason_id, note, operator_id, device_id, occurred_at, parent_id)
      VALUES (p_code || '-D',
              CASE WHEN v_diff > 0 THEN 'S' ELSE 'C' END::movement_type,
              p_raw_item_id,
              CASE WHEN v_diff > 0 THEN p_from_location_id END,
              CASE WHEN v_diff < 0 THEN p_from_location_id END,
              abs(v_diff), 'calcolo',
              (SELECT id FROM movement_reasons
               WHERE code = CASE WHEN v_diff > 0 THEN 'differenza_pesatura_scarico' ELSE 'differenza_pesatura_carico' END),
              'Peso rimasto quando la giacenza è finita', v_op.id, v_dev.id, p_occurred_at, v_mov.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', false,
    'movement', to_jsonb(v_mov),
    'weighing_difference', v_diff,
    'from_stock', CASE WHEN p_from_location_id IS NOT NULL THEN
      (SELECT to_jsonb(s) FROM item_stock(p_article_id, p_raw_item_id, p_from_location_id) s) END,
    'to_stock', CASE WHEN p_to_location_id IS NOT NULL THEN
      (SELECT to_jsonb(s) FROM item_stock(p_article_id, p_raw_item_id, p_to_location_id) s) END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Annulla un movimento con motivo, solo l'amministrazione (REQ-M-06, M-13, M-14, F-09).
-- Il movimento resta nello storico, segnato; con lui si annulla la differenza di pesatura che aveva generato.
CREATE FUNCTION cancel_movement(p_movement_id uuid, p_reason text)
RETURNS jsonb AS $$
DECLARE
  v_op  operators;
  v_mov movements;
  v_neg record;
BEGIN
  v_op := current_operator();
  IF v_op.role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo l''amministrazione può annullare un movimento';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Serve il motivo dell''annullamento';
  END IF;

  SELECT * INTO v_mov FROM movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimento non trovato';
  END IF;
  IF v_mov.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Movimento già annullato';
  END IF;
  IF v_mov.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una differenza di pesatura si annulla insieme al movimento che l''ha generata';
  END IF;

  PERFORM lock_item_locations(coalesce(v_mov.article_id, v_mov.raw_item_id),
                              ARRAY[v_mov.from_location_id, v_mov.to_location_id]);

  UPDATE movements
  SET cancelled_at = now(), cancelled_by = v_op.id, cancel_reason = btrim(p_reason)
  WHERE id = v_mov.id OR parent_id = v_mov.id;

  -- Nessuna giacenza sotto zero dopo l'annullamento (REQ-M-14): se succede, l'errore annulla tutto.
  -- I grammi contano solo per il semilavorato: il peso del gioiello è orientativo (REQ-U-15 da decidere).
  SELECT l.id, l.name, s.pieces, s.grams INTO v_neg
  FROM locations l, item_stock(v_mov.article_id, v_mov.raw_item_id, l.id) s
  WHERE l.id IN (v_mov.from_location_id, v_mov.to_location_id)
    AND (s.pieces < 0 OR (v_mov.raw_item_id IS NOT NULL AND s.grams < 0))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Annullamento rifiutato: in % la giacenza scenderebbe sotto zero', v_neg.name;
  END IF;

  RETURN jsonb_build_object('cancelled', v_mov.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- L'unità di misura non cambia dopo i primi movimenti (proposta della BBA, Step 3)
CREATE FUNCTION raw_items_unit_locked()
RETURNS trigger AS $$
BEGIN
  IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS (SELECT 1 FROM movements WHERE raw_item_id = OLD.id) THEN
    RAISE EXCEPTION 'L''unità di misura non si cambia dopo i primi movimenti';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER raw_items_unit_locked
  BEFORE UPDATE OF unit ON raw_items
  FOR EACH ROW EXECUTE FUNCTION raw_items_unit_locked();

-- ------------------------------------------------------------
-- Permessi per riga (REQ-P-03): legge solo chi ha fatto l'accesso ed è un operatore attivo;
-- il registro si scrive solo con le funzioni qui sopra; le anagrafiche le cambia l'amministrazione.
-- ------------------------------------------------------------
ALTER TABLE locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE scales           ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_select"        ON locations        FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "operators_select"        ON operators        FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "role_locations_select"   ON role_locations   FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "devices_select"          ON devices          FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "scales_select"           ON scales           FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "movement_reasons_select" ON movement_reasons FOR SELECT USING ((current_operator()).id IS NOT NULL);
CREATE POLICY "movements_select"        ON movements        FOR SELECT USING ((current_operator()).id IS NOT NULL);

CREATE POLICY "locations_admin"        ON locations        FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');
CREATE POLICY "operators_admin"        ON operators        FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');
CREATE POLICY "role_locations_admin"   ON role_locations   FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');
CREATE POLICY "devices_admin"          ON devices          FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');
CREATE POLICY "scales_admin"           ON scales           FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');
CREATE POLICY "movement_reasons_admin" ON movement_reasons FOR ALL USING ((current_operator()).role = 'admin') WITH CHECK ((current_operator()).role = 'admin');

-- Le funzioni interne non si chiamano dall'esterno; quelle del registro solo chi ha fatto l'accesso (sotto).
-- current_operator() resta a tutti: la usano i permessi per riga e non rivela nulla.
REVOKE EXECUTE ON FUNCTION lock_item_locations(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION raw_items_unit_locked() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_movement, cancel_movement, my_operator, item_stock FROM PUBLIC;

-- ------------------------------------------------------------
-- Dati iniziali
-- ------------------------------------------------------------
INSERT INTO locations (name, kind) VALUES ('Laboratorio', 'sede'), ('Negozio', 'sede');

INSERT INTO role_locations (role, location_id)
SELECT 'laboratorio'::operator_role, id FROM locations WHERE name = 'Laboratorio'
UNION ALL
SELECT 'negozio'::operator_role, id FROM locations WHERE name = 'Negozio';

-- Bozza degli elenchi della BBA (punto aperto: li conferma l'azienda). Ruoli dalla matrice della BBA, Step 2:
-- caricare = laboratorio; vendere e riaggiungere una vendita = negozio o fiere; perdite = solo amministrazione;
-- trasferire = tutti. Il reso è da definire con l'azienda: per ora solo l'amministrazione.
INSERT INTO movement_reasons (code, name, movement_type, allowed_roles, system, sort_order) VALUES
  ('nuova_produzione',            'Nuova produzione',        'C', '{laboratorio}',              false, 10),
  ('acquisto',                    'Acquisto',                'C', '{laboratorio}',              false, 20),
  ('carico_iniziale',             'Carico iniziale',         'C', '{laboratorio}',              false, 30),
  ('reso',                        'Reso',                    'C', '{}',                         false, 40),
  ('annullamento_vendita',        'Annullamento vendita',    'C', '{negozio,fiere}',            false, 50),
  ('vendita_banco',               'Vendita al banco',        'S', '{negozio}',                  false, 10),
  ('vendita_fiera',               'Vendita in fiera',        'S', '{fiere}',                    false, 20),
  ('rottura',                     'Rottura',                 'S', '{}',                         false, 30),
  ('smarrimento',                 'Smarrimento',             'S', '{}',                         false, 40),
  ('omaggio',                     'Omaggio',                 'S', '{}',                         false, 50),
  ('trasferimento',               'Trasferimento',           'T', '{laboratorio,negozio,fiere}', false, 10),
  ('differenza_pesatura_scarico', 'Differenza di pesatura',  'S', '{}',                         true,  90),
  ('differenza_pesatura_carico',  'Differenza di pesatura',  'C', '{}',                         true,  90);

-- La bilancia di oggi, collegata al PC server (D-3). Il numero di serie si legge con il comando I4.
INSERT INTO scales (name, model) VALUES ('SB16001 del PC server', 'Mettler Toledo SB16001');

-- ------------------------------------------------------------
-- Solo dove esistono: ruoli di PostgREST e utenti di Supabase
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Chi non ha fatto l'accesso non vede né scrive nulla di queste tabelle
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON locations, operators, role_locations, devices, scales, movement_reasons, movements,
                  movement_legs, stock_levels, movement_history FROM anon;
    REVOKE EXECUTE ON FUNCTION register_movement, cancel_movement, my_operator, item_stock FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON locations, operators, role_locations, devices, scales, movement_reasons, movements,
                    movement_legs, stock_levels, movement_history TO authenticated;
    GRANT INSERT, UPDATE ON locations, operators, role_locations, devices, scales, movement_reasons TO authenticated;
    GRANT EXECUTE ON FUNCTION register_movement, cancel_movement, my_operator, item_stock,
                              current_operator, current_operator_id TO authenticated;
  END IF;

  -- Sviluppo su Supabase: gli utenti con un ruolo diventano operatori (admin resta admin, staff → laboratorio).
  -- Il ruolo si cambia poi con un UPDATE su operators, per provare negozio e fiere.
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO operators (id, name, role)
    SELECT u.id,
           coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), u.email),
           CASE u.raw_app_meta_data ->> 'role' WHEN 'admin' THEN 'admin' ELSE 'laboratorio' END::operator_role
    FROM auth.users u
    WHERE u.raw_app_meta_data ->> 'role' IN ('admin', 'staff')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;
