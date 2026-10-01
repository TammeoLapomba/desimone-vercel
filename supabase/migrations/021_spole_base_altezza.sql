-- ============================================================
-- 021_spole_base_altezza.sql — Spole: base × altezza, tipo (ovale/tonda) e flag «alta»
--
-- Rispetto a 019/020:
--  · le spole non tonde hanno due misure viste dall'alto, base e altezza (la profondità non si registra):
--    width_mm → base_mm, length_mm → height_mm
--  · «alta» non è una forma ma un campo a parte: spola ovale o tonda, alta sì/no
--    (le forme spola-alta e spola-alta-tonda spariscono, i gruppi 43 e 43T passano a ovale/tonda + alta)
--  · il «h 5» delle spole triangolo (prima height_mm) si chiama depth_mm: spessore, da confermare con il cliente
-- I codici degli articoli non cambiano.
-- Richiede 019 e 020.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Colonne di raw_items
-- ------------------------------------------------------------
ALTER TABLE raw_items RENAME COLUMN height_mm TO depth_mm;
ALTER TABLE raw_items RENAME COLUMN length_mm TO height_mm;
ALTER TABLE raw_items RENAME COLUMN width_mm  TO base_mm;
ALTER TABLE raw_items ADD COLUMN is_tall boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- Forme e gruppi
-- ------------------------------------------------------------
ALTER TABLE raw_shapes DROP CONSTRAINT IF EXISTS raw_shapes_size_kind_check;
UPDATE raw_shapes SET size_kind = 'base_height' WHERE size_kind = 'width_length';
ALTER TABLE raw_shapes ADD CONSTRAINT raw_shapes_size_kind_check CHECK (size_kind IN ('diameter', 'base_height', 'none'));

ALTER TABLE raw_shapes
  ADD COLUMN allows_tall       boolean NOT NULL DEFAULT false,   -- la forma può essere «alta»
  ADD COLUMN label_before_tall text NOT NULL DEFAULT '',         -- descrizione quando è alta
  ADD COLUMN label_after_tall  text NOT NULL DEFAULT '';

ALTER TABLE raw_code_groups ADD COLUMN is_tall boolean NOT NULL DEFAULT false;
ALTER TABLE raw_code_groups DROP CONSTRAINT IF EXISTS raw_code_groups_shape_id_quality_finish_key;

-- Spole alte: stessa forma, con il flag
UPDATE raw_shapes SET allows_tall = true, label_before_tall = 'Spole alte',        label_after_tall = '' WHERE slug = 'spola-ovale';
UPDATE raw_shapes SET allows_tall = true, label_before_tall = 'Spole alte tonde',  label_after_tall = '' WHERE slug = 'spola-tonda';

UPDATE raw_items SET is_tall = true,
       shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-ovale')
 WHERE shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-alta');
UPDATE raw_items SET is_tall = true,
       shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-tonda')
 WHERE shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-alta-tonda');

UPDATE raw_code_groups SET is_tall = true, shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-ovale') WHERE code = '43';
UPDATE raw_code_groups SET is_tall = true, shape_id = (SELECT id FROM raw_shapes WHERE slug = 'spola-tonda') WHERE code = '43T';

DELETE FROM raw_shapes WHERE slug IN ('spola-alta', 'spola-alta-tonda');

ALTER TABLE raw_code_groups ADD CONSTRAINT raw_code_groups_shape_tall_quality_finish_key
  UNIQUE (shape_id, is_tall, quality, finish);

-- ------------------------------------------------------------
-- Generazione del codice
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS raw_item_preview(uuid, text, text, numeric, numeric, numeric, numeric, numeric, text[]);

CREATE OR REPLACE FUNCTION raw_item_preview(
  p_shape_id    uuid,
  p_is_tall     boolean,
  p_quality     text,
  p_finish      text,
  p_size_from   numeric,
  p_size_to     numeric,
  p_base        numeric,
  p_height      numeric,
  p_length_cm   numeric,
  p_variants    text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shape    raw_shapes;
  v_group    raw_code_groups;
  v_tall     boolean := COALESCE(p_is_tall, false);
  v_finish   text := COALESCE(p_finish, '');
  v_to       numeric;
  v_variants text[];
  v_size     text;
  v_label    text;
  v_sku      text;
  v_desc     text;
  v_before   text;
  v_after    text;
  v_existing record;
BEGIN
  -- Le colonne hanno due decimali: il codice si calcola sul valore che verrà salvato
  p_size_from := round(p_size_from, 2);
  p_size_to   := round(p_size_to, 2);
  p_base      := round(p_base, 2);
  p_height    := round(p_height, 2);
  p_length_cm := round(p_length_cm, 1);

  SELECT * INTO v_shape FROM raw_shapes WHERE id = p_shape_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forma non valida'; END IF;
  IF v_tall AND NOT v_shape.allows_tall THEN
    RAISE EXCEPTION '% non può essere alta', v_shape.name;
  END IF;

  SELECT * INTO v_group FROM raw_code_groups
  WHERE shape_id = COALESCE(v_shape.base_shape_id, v_shape.id)
    AND is_tall = v_tall
    AND quality = p_quality AND finish = v_finish;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Combinazione non prevista: %',
      concat_ws(' ', v_shape.name, CASE WHEN v_tall THEN 'alta' END, 'qualità', COALESCE(p_quality, '—'), NULLIF(v_finish, ''));
  END IF;

  -- Sigle valide e creabili, sempre nello stesso ordine
  SELECT COALESCE(array_agg(v.code ORDER BY v.sort_order), '{}') INTO v_variants
  FROM raw_variants v WHERE v.creatable AND v.code = ANY (COALESCE(p_variants, '{}'));
  IF cardinality(v_variants) <> cardinality(COALESCE(p_variants, '{}')) THEN
    RAISE EXCEPTION 'Variante non valida';
  END IF;

  IF v_shape.size_kind = 'base_height' THEN
    IF COALESCE(p_base, 0) <= 0 OR COALESCE(p_height, 0) <= 0 THEN
      RAISE EXCEPTION 'Inserisci base e altezza';
    END IF;
    v_size  := raw_num_digits(p_base) || '.' || raw_num_digits(p_height);
    v_label := raw_num_it(p_base) || 'x' || raw_num_it(p_height);
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

  v_before := CASE WHEN v_tall THEN v_shape.label_before_tall ELSE v_shape.label_before END;
  v_after  := CASE WHEN v_tall THEN v_shape.label_after_tall  ELSE v_shape.label_after  END;
  v_desc := v_before || ' SA ' || v_group.quality
         || CASE WHEN v_group.finish <> '' THEN ' ' || v_group.finish ELSE '' END
         || CASE WHEN v_after <> '' THEN ' ' || v_after ELSE '' END
         || ' mm ' || v_label
         || CASE WHEN p_length_cm IS NOT NULL THEN ' cm ' || raw_num_it(p_length_cm) ELSE '' END
         || CASE WHEN cardinality(v_variants) > 0 THEN ' ' || array_to_string(v_variants, ' ') ELSE '' END;

  -- Stesso codice (anche tra gli eliminati: il codice è unico) o stesse caratteristiche
  SELECT id, sku, description INTO v_existing
  FROM raw_items
  WHERE sku = v_sku
     OR (deleted_at IS NULL
         AND shape_id = v_shape.id
         AND is_tall = v_tall
         AND quality = p_quality AND finish = v_finish
         AND size_from_mm IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'diameter' THEN p_size_from END
         AND size_to_mm   IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'diameter' THEN v_to END
         AND base_mm      IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'base_height' THEN p_base END
         AND height_mm    IS NOT DISTINCT FROM CASE WHEN v_shape.size_kind = 'base_height' THEN p_height END
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

-- Trigger di raw_items: se il codice non è dato lo genera
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

    r := raw_item_preview(NEW.shape_id, NEW.is_tall, NEW.quality, NEW.finish, NEW.size_from_mm, NEW.size_to_mm,
                          NEW.base_mm, NEW.height_mm, NEW.length_cm, NEW.variants);
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
    NEW.base_mm      := CASE WHEN v_shape.size_kind = 'base_height' THEN NEW.base_mm END;
    NEW.height_mm    := CASE WHEN v_shape.size_kind = 'base_height' THEN NEW.height_mm END;
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
