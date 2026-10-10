-- ============================================================
-- 023_movimenti_peso.sql — Movimenti: il peso dove la BBA lo chiede sempre
--
-- Confrontando la schermata del movimento (fetta 2) con la BBA v1.7 sono emersi due requisiti che la 022
-- non faceva rispettare:
--   REQ-U-04  a pezzi e grammi il peso accompagna i pezzi in OGNI movimento, carichi compresi
--             (la 022 lo chiedeva solo alle uscite, REQ-U-10);
--   REQ-U-14  il primo carico di un gioiello nuovo registra il suo peso.
-- Sostituisce register_movement con gli stessi parametri: niente da cambiare nell'app.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION register_movement(
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
    -- REQ-U-14: il primo carico di un gioiello registra il suo peso (orientativo, REQ-U-20)
    IF p_movement_type = 'C' AND p_grams IS NULL
       AND NOT EXISTS (SELECT 1 FROM movements WHERE article_id = p_article_id AND cancelled_at IS NULL) THEN
      RAISE EXCEPTION 'Al primo carico di un gioiello serve il peso';
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
    -- REQ-U-04: a pezzi e grammi il peso accompagna i pezzi in ogni movimento
    IF v_unit = 'pezzi_grammi' AND p_grams IS NULL THEN
      RAISE EXCEPTION 'Per questo semilavorato servono pezzi e peso';
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

COMMIT;
