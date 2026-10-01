-- ============================================================
-- 019_semilavorato_codici.sql — Codici del semilavorato secondo lo standard del cliente
--
-- Il codice di un pallino o di una spola si genera dai campi scelti (tipo, forma, qualità,
-- finitura, misura, varianti) con la regola dei codici storici:
--     <GRUPPO>.<MISURA>[B][SIGLE]      es. 1.6.5 · 41.6.12 · 46.10.5 · 1.9.10CDD
-- Le regole stanno in tabelle (gruppi, forme, varianti): un nuovo tipo si aggiunge con delle righe,
-- senza toccare il codice. I codici dei 430 articoli esistenti sono in 020_semilavorato_import.sql.
-- Analisi: docs/codici-inventario/README.md
-- ============================================================

BEGIN;
-- Forme (filo, bracciale, spola ovale…). Una forma appartiene a una categoria (il «tipo di oggetto»).
CREATE TABLE raw_shapes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,
  name             text NOT NULL,
  category_id      uuid NOT NULL REFERENCES raw_categories(id),
  base_shape_id    uuid REFERENCES raw_shapes(id),   -- forma da cui prende il gruppo (il bracciale usa i gruppi del filo)
  size_kind        text NOT NULL CHECK (size_kind IN ('diameter', 'width_length', 'none')),
  has_length_cm    boolean NOT NULL DEFAULT false,   -- fili e bracciali: lunghezza in cm (non entra nel codice)
  creatable        boolean NOT NULL DEFAULT false,   -- false: solo importata, l'app non la propone nel modulo
  label_before     text NOT NULL,                    -- descrizione: «Fili pallini» SA I mm 6
  label_after      text NOT NULL DEFAULT '',         -- descrizione: Spole SA I «OVALI» mm 6x12
  sort_order       integer NOT NULL DEFAULT 0
);

-- Gruppi: il numero che apre il codice. Portano forma di base, qualità e finitura.
CREATE TABLE raw_code_groups (
  code        text PRIMARY KEY,
  prefix      text NOT NULL,                         -- come si scrive nel codice (43T → «43.T»)
  name        text NOT NULL,                         -- descrizione del gruppo, come nel file del cliente
  shape_id    uuid NOT NULL REFERENCES raw_shapes(id),
  quality     text NOT NULL,                         -- I, II, IIIA
  finish      text NOT NULL DEFAULT '',              -- '', EX, EX EX
  zero_suffix boolean NOT NULL DEFAULT false,        -- i fili interi si scrivono 3.0 (e non 3) in questo gruppo
  half_digits smallint NOT NULL DEFAULT 1 CHECK (half_digits IN (1, 2)),  -- mezzo mm: .5 oppure .50
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (shape_id, quality, finish)
);

-- Sigle di variante che si aggiungono in coda al codice
CREATE TABLE raw_variants (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  notes      text,
  creatable  boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE raw_shapes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_code_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_variants    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_shapes_select"      ON raw_shapes      FOR SELECT USING (true);
CREATE POLICY "raw_code_groups_select" ON raw_code_groups FOR SELECT USING (true);
CREATE POLICY "raw_variants_select"    ON raw_variants    FOR SELECT USING (true);
CREATE POLICY "raw_shapes_write"       ON raw_shapes      FOR ALL USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "raw_code_groups_write"  ON raw_code_groups FOR ALL USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "raw_variants_write"     ON raw_variants    FOR ALL USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- Campi del semilavorato. Il codice è raw_items.sku (unico); description e size sono testi leggibili.
ALTER TABLE raw_items
  ADD COLUMN description  text,
  ADD COLUMN group_code   text REFERENCES raw_code_groups(code),
  ADD COLUMN shape_id     uuid REFERENCES raw_shapes(id),
  ADD COLUMN finish       text NOT NULL DEFAULT '',
  ADD COLUMN size_from_mm numeric(6,2),              -- diametro, o inizio dell'intervallo
  ADD COLUMN size_to_mm   numeric(6,2),              -- fine dell'intervallo (uguale a size_from_mm se misura singola)
  ADD COLUMN width_mm     numeric(6,2),              -- spole ovali, alte, navette
  ADD COLUMN length_mm    numeric(6,2),
  ADD COLUMN height_mm    numeric(6,2),              -- spole a triangolo
  ADD COLUMN length_cm    numeric(6,1),              -- fili e bracciali
  ADD COLUMN variants     text[] NOT NULL DEFAULT '{}';

CREATE INDEX raw_items_shape_idx ON raw_items(shape_id);
CREATE INDEX raw_items_group_idx ON raw_items(group_code);

-- ------------------------------------------------------------
-- Dati: categorie (tipi di oggetto), forme, gruppi, varianti
-- ------------------------------------------------------------

-- Se le categorie esistono già (create dall'app) si riusano
INSERT INTO raw_categories (name, slug, sku_prefix, sort_order) VALUES
  ('Pallini', 'pallini', 'PAL', 1),
  ('Spole',   'spole',   'SPO', 2),
  ('Navette', 'navette', 'NAV', 3)
ON CONFLICT (slug) DO UPDATE SET sort_order = EXCLUDED.sort_order, deleted_at = NULL;

INSERT INTO raw_shapes (slug, name, category_id, size_kind, has_length_cm, creatable, label_before, label_after, sort_order)
SELECT v.slug, v.name, c.id, v.size_kind, v.has_length_cm, v.creatable, v.label_before, v.label_after, v.sort_order
FROM (VALUES
  ('filo',             'Filo',             'pallini', 'diameter',     true,  true,  'Fili pallini',    '',       1),
  ('bracciale',        'Bracciale',        'pallini', 'diameter',     true,  true,  'Bracciali pallini', '',     2),
  ('spola-ovale',      'Spola ovale',      'spole',   'width_length', false, true,  'Spole',           'OVALI',  3),
  ('spola-alta',       'Spola alta',       'spole',   'width_length', false, true,  'Spole alte',      '',       4),
  ('spola-alta-tonda', 'Spola alta tonda', 'spole',   'diameter',     false, true,  'Spole alte tonde', '',      5),
  ('spola-tonda',      'Spola tonda',      'spole',   'diameter',     false, true,  'Spole tonde',     '',       6),
  ('spola-triangolo',  'Spola triangolo',  'spole',   'diameter',     false, false, 'Spola triangolo', '',       7),
  ('spola-perle',      'Spola perlé',      'spole',   'diameter',     false, false, 'Spole perlé',     '',       8),
  ('set-spole',        'Set di spole',     'spole',   'none',         false, false, 'Set spole',       '',       9),
  ('navetta',          'Navetta',          'navette', 'width_length', false, false, 'Navette',         '',      10)
) AS v(slug, name, cat_slug, size_kind, has_length_cm, creatable, label_before, label_after, sort_order)
JOIN raw_categories c ON c.slug = v.cat_slug;

-- Forme che prendono i gruppi di un'altra
UPDATE raw_shapes SET base_shape_id = (SELECT id FROM raw_shapes WHERE slug = 'filo')        WHERE slug = 'bracciale';
UPDATE raw_shapes SET base_shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-ovale') WHERE slug IN ('spola-triangolo', 'set-spole');
UPDATE raw_shapes SET base_shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-tonda')  WHERE slug = 'spola-perle';

INSERT INTO raw_code_groups (code, prefix, name, shape_id, quality, finish, zero_suffix, half_digits, sort_order)
SELECT v.code, v.prefix, v.name, s.id, v.quality, v.finish, v.zero_suffix, v.half_digits, v.sort_order
FROM (VALUES
  ('1',   '1',    'Fili pallini SA I',          'filo',             'I',    '',      true,  1::smallint,  1),
  ('2',   '2',    'Fili pallini SA I Ex',       'filo',             'I',    'EX',    true,  1::smallint,  2),
  ('3',   '3',    'Fili pallini SA I EX EX',    'filo',             'I',    'EX EX', false, 1::smallint,  3),
  ('4',   '4',    'Fili pallini SA II',         'filo',             'II',   '',      true,  1::smallint,  4),
  ('8',   '8',    'Fili pallini SA IIIA EX',    'filo',             'IIIA', 'EX',    true,  1::smallint,  5),
  ('41',  '41',   'Spole SA I OVALI',           'spola-ovale',      'I',    '',      false, 1::smallint,  6),
  ('41N', '41N',  'Navette SA I',               'navetta',          'I',    '',      false, 1::smallint,  7),
  ('42N', '42N',  'Navette SA EXTRA',           'navetta',          'I',    'EX',    false, 1::smallint,  8),
  ('42',  '42',   'Spole SA I EXTRA OVALI',     'spola-ovale',      'I',    'EX',    false, 1::smallint,  9),
  ('43',  '43',   'SPOLE ALTE SA I',            'spola-alta',       'I',    '',      false, 1::smallint, 10),
  ('43T', '43.T', 'SPOLE ALTE SA I TONDE',      'spola-alta-tonda', 'I',    '',      false, 1::smallint, 11),
  ('44',  '44',   'Spole SA II OVALI',          'spola-ovale',      'II',   '',      false, 1::smallint, 12),
  ('45',  '45',   'Spole SA II EXTRA OVALI',    'spola-ovale',      'II',   'EX',    false, 1::smallint, 13),
  ('46',  '46',   'Spole tonde SA I',           'spola-tonda',      'I',    '',      false, 1::smallint, 14),
  ('47',  '47',   'Spole tonde SA I EX',        'spola-tonda',      'I',    'EX',    false, 2::smallint, 15),
  ('48',  '48',   'spole tonde SA II',          'spola-tonda',      'II',   '',      false, 2::smallint, 16),
  ('49',  '49',   'Spole tonde SA II Extra',    'spola-tonda',      'II',   'EX',    false, 2::smallint, 17)
) AS v(code, prefix, name, shape_slug, quality, finish, zero_suffix, half_digits, sort_order)
JOIN raw_shapes s ON s.slug = v.shape_slug;

INSERT INTO raw_variants (code, name, notes, creatable, sort_order) VALUES
  ('CDD',  'CDD',          'Sigla del cliente, significato da confermare',                       true,  1),
  ('CEL',  'CEL',          'Sigla del cliente, significato da confermare',                       true,  2),
  ('NINO', 'NINO',         'Sigla del cliente, significato da confermare',                       true,  3),
  ('FM',   'Fuori misura', 'Assortimento di misure fuori standard: il codice non è generato',    false, 4),
  ('UP',   'E oltre',      'Misura indicata e tutte le maggiori: il codice non è generato',      false, 5);

-- ------------------------------------------------------------
-- Generazione del codice
-- ------------------------------------------------------------

-- 6,5 → '65'   10,25 → '1025'   7 → '7'  (decimali incollati, senza separatore)
CREATE OR REPLACE FUNCTION raw_num_digits(x numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT replace(trim_scale(x)::text, '.', '') $$;

-- 6,5 → '6.5'   3 → '3' o '3.0'   6,5 → '6.50' se il gruppo scrive i mezzi con due cifre
CREATE OR REPLACE FUNCTION raw_num_single(x numeric, p_zero boolean, p_half smallint) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s text := trim_scale(x)::text;
BEGIN
  IF x = trunc(x) THEN
    RETURN CASE WHEN p_zero THEN s || '.0' ELSE s END;
  END IF;
  IF p_half = 2 AND right(s, 2) = '.5' THEN s := s || '0'; END IF;
  RETURN s;
END;
$$;

-- 6,5 → '6,5' (testo in italiano per descrizioni ed etichette)
CREATE OR REPLACE FUNCTION raw_num_it(x numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT replace(trim_scale(x)::text, '.', ',') $$;

-- Dai campi scelti: gruppo, codice, descrizione, etichetta misura, e l'eventuale articolo già presente.
-- La usa l'app per l'anteprima nel modulo e il trigger di raw_items per assegnare il codice.
CREATE OR REPLACE FUNCTION raw_item_preview(
  p_shape_id    uuid,
  p_quality     text,
  p_finish      text,
  p_size_from   numeric,
  p_size_to     numeric,
  p_width       numeric,
  p_length      numeric,
  p_length_cm   numeric,
  p_variants    text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shape    raw_shapes;
  v_group    raw_code_groups;
  v_finish   text := COALESCE(p_finish, '');
  v_to       numeric;
  v_variants text[];
  v_size     text;
  v_label    text;
  v_sku      text;
  v_desc     text;
  v_existing record;
BEGIN
  -- Le colonne hanno due decimali: il codice si calcola sul valore che verrà salvato
  p_size_from := round(p_size_from, 2);
  p_size_to   := round(p_size_to, 2);
  p_width     := round(p_width, 2);
  p_length    := round(p_length, 2);
  p_length_cm := round(p_length_cm, 1);

  SELECT * INTO v_shape FROM raw_shapes WHERE id = p_shape_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forma non valida'; END IF;

  SELECT * INTO v_group FROM raw_code_groups
  WHERE shape_id = COALESCE(v_shape.base_shape_id, v_shape.id)
    AND quality = p_quality AND finish = v_finish;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Combinazione non prevista: % qualità % %', v_shape.name, COALESCE(p_quality, '—'), v_finish;
  END IF;

  -- Sigle valide e creabili, sempre nello stesso ordine
  SELECT COALESCE(array_agg(v.code ORDER BY v.sort_order), '{}') INTO v_variants
  FROM raw_variants v WHERE v.creatable AND v.code = ANY (COALESCE(p_variants, '{}'));
  IF cardinality(v_variants) <> cardinality(COALESCE(p_variants, '{}')) THEN
    RAISE EXCEPTION 'Variante non valida';
  END IF;

  IF v_shape.size_kind = 'width_length' THEN
    IF COALESCE(p_width, 0) <= 0 OR COALESCE(p_length, 0) <= 0 THEN
      RAISE EXCEPTION 'Inserisci larghezza e lunghezza';
    END IF;
    v_size  := raw_num_digits(p_width) || '.' || raw_num_digits(p_length);
    v_label := raw_num_it(p_width) || 'x' || raw_num_it(p_length);
  ELSIF v_shape.size_kind = 'diameter' THEN
    IF COALESCE(p_size_from, 0) <= 0 THEN RAISE EXCEPTION 'Inserisci la misura'; END IF;
    v_to := COALESCE(p_size_to, p_size_from);
    IF v_to < p_size_from THEN RAISE EXCEPTION 'La misura finale non può essere minore dell''iniziale'; END IF;
    IF v_to = p_size_from THEN
      v_size  := raw_num_single(
                   p_size_from,
                   v_group.zero_suffix AND v_shape.slug = 'filo' AND cardinality(v_variants) = 0,
                   v_group.half_digits);
      v_label := raw_num_it(p_size_from);
    ELSE
      v_size  := raw_num_digits(p_size_from) || '.' || raw_num_digits(v_to);
      v_label := raw_num_it(p_size_from) || '/' || raw_num_it(v_to);
    END IF;
  ELSE
    RAISE EXCEPTION 'Forma senza misura: codice non generabile';
  END IF;

  v_sku := v_group.prefix || '.' || v_size
        || CASE WHEN v_shape.slug = 'bracciale' THEN 'B' ELSE '' END
        || array_to_string(v_variants, '');

  v_desc := v_shape.label_before || ' SA ' || v_group.quality
         || CASE WHEN v_group.finish <> '' THEN ' ' || v_group.finish ELSE '' END
         || CASE WHEN v_shape.label_after <> '' THEN ' ' || v_shape.label_after ELSE '' END
         || ' mm ' || v_label
         || CASE WHEN p_length_cm IS NOT NULL THEN ' cm ' || raw_num_it(p_length_cm) ELSE '' END
         || CASE WHEN cardinality(v_variants) > 0 THEN ' ' || array_to_string(v_variants, ' ') ELSE '' END;

  -- Stesso codice (anche tra gli eliminati: il codice è unico) o stesse caratteristiche
  SELECT id, sku, description INTO v_existing
  FROM raw_items
  WHERE sku = v_sku
     OR (deleted_at IS NULL
         AND shape_id = v_shape.id
         AND quality = p_quality AND finish = v_finish
         AND size_from_mm IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'diameter' THEN p_size_from END
         AND size_to_mm   IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'diameter' THEN v_to END
         AND width_mm     IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'width_length' THEN p_width END
         AND length_mm    IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'width_length' THEN p_length END
         AND length_cm    IS NOT DISTINCT FROM p_length_cm
         AND variants = v_variants)
  ORDER BY (sku = v_sku) DESC, sku
  LIMIT 1;

  RETURN jsonb_build_object(
    'group_code',  v_group.code,
    'sku',         v_sku,
    'description', v_desc,
    'size_label',  v_label || ' mm',
    'size_from',   CASE WHEN v_shape.size_kind = 'diameter' THEN p_size_from END,
    'size_to',     CASE WHEN v_shape.size_kind = 'diameter' THEN v_to END,
    'variants',    to_jsonb(v_variants),
    'existing',    CASE WHEN v_existing.id IS NULL THEN NULL
                        ELSE jsonb_build_object('id', v_existing.id, 'sku', v_existing.sku, 'description', v_existing.description) END
  );
END;
$$;

-- Trigger di raw_items: se il codice non è dato lo genera (sostituisce quello di 012).
-- Un articolo senza forma (vecchio modulo) ha ancora il codice SM-PRE-NNNNN.
CREATE OR REPLACE FUNCTION set_raw_item_sku()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix varchar(3);
  v_num    bigint;
  v_q      text;
  v_shape  raw_shapes;
  r        jsonb;
BEGIN
  IF NEW.sku IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.shape_id IS NOT NULL THEN
    SELECT * INTO v_shape FROM raw_shapes WHERE id = NEW.shape_id;
    IF v_shape.id IS NULL OR NOT v_shape.creatable THEN
      RAISE EXCEPTION 'Questa forma non si può ancora creare dall''app';
    END IF;

    r := raw_item_preview(NEW.shape_id, NEW.quality, NEW.finish, NEW.size_from_mm, NEW.size_to_mm,
                          NEW.width_mm, NEW.length_mm, NEW.length_cm, NEW.variants);
    IF jsonb_typeof(r->'existing') = 'object' THEN
      RAISE EXCEPTION 'Esiste già: % (%)', r->'existing'->>'sku', COALESCE(r->'existing'->>'description', '');
    END IF;

    NEW.category_id  := v_shape.category_id;
    NEW.sku          := r->>'sku';
    NEW.group_code   := r->>'group_code';
    NEW.size         := COALESCE(NEW.size, r->>'size_label');
    NEW.description  := COALESCE(NEW.description, r->>'description');
    NEW.size_from_mm := CASE WHEN v_shape.size_kind = 'diameter' THEN NEW.size_from_mm END;
    NEW.size_to_mm   := CASE WHEN v_shape.size_kind = 'diameter' THEN (r->>'size_to')::numeric END;
    NEW.width_mm     := CASE WHEN v_shape.size_kind = 'width_length' THEN NEW.width_mm END;
    NEW.length_mm    := CASE WHEN v_shape.size_kind = 'width_length' THEN NEW.length_mm END;
    NEW.variants     := ARRAY(SELECT jsonb_array_elements_text(r->'variants'));
    RETURN NEW;
  END IF;

  SELECT sku_prefix INTO v_prefix FROM raw_categories WHERE id = NEW.category_id FOR SHARE;
  v_num := nextval('raw_item_sku_seq');
  v_q   := COALESCE(NEW.quality, '');
  IF v_q != '' THEN
    NEW.sku := 'SM-' || v_prefix || '-' || v_q || '-' || LPAD(v_num::text, 5, '0');
  ELSE
    NEW.sku := 'SM-' || v_prefix || '-' || LPAD(v_num::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
