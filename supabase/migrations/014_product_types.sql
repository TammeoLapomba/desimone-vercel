-- ============================================================
-- 014_product_types.sql — Tipi prodotto del montato in tabella
-- Sostituisce l'enum product_type (che aveva anche "altro") con la
-- tabella product_types, collegata agli articoli come i materiali.
-- I tipi del semilavorato avranno una tabella a parte.
-- ============================================================

BEGIN;

CREATE TABLE product_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

INSERT INTO product_types (name, slug, sort_order) VALUES
  ('Bracciale',       'bracciale',        1),
  ('Collana',         'collana',          2),
  ('Anello',          'anello',           3),
  ('Orecchini',       'orecchini',        4),
  ('Spilla',          'spilla',           5),
  ('Ciondolo',        'ciondolo',         6),
  ('Gemelli',         'gemelli',          7),
  ('Cuore',           'cuore',            8),
  ('Quadretto',       'quadretto',        9),
  ('Portatovaglioli', 'portatovaglioli', 10),
  ('Ramo di corallo', 'ramo-di-corallo', 11);

-- Come materials: tutti leggono, solo admin scrive
ALTER TABLE product_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_types_select" ON product_types FOR SELECT USING (true);
CREATE POLICY "product_types_insert" ON product_types FOR INSERT WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "product_types_update" ON product_types FOR UPDATE USING (get_user_role() = 'admin');

-- Collegamento articoli → tipo
ALTER TABLE articles ADD COLUMN product_type_id uuid REFERENCES product_types(id);

UPDATE articles a SET product_type_id = t.id
FROM product_types t
WHERE t.slug = a.product_type::text;

-- Gli articoli "altro" (import dal sito) prendono il tipo reale dal nome
UPDATE articles a SET product_type_id = t.id
FROM product_types t
WHERE a.product_type = 'altro'
  AND t.slug = CASE
    WHEN a.name ILIKE 'gemelli%'           THEN 'gemelli'
    WHEN a.name ILIKE 'quadretto%'         THEN 'quadretto'
    WHEN a.name ILIKE '%portatovaglioli%'  THEN 'portatovaglioli'
    WHEN a.name ILIKE 'rami %'             THEN 'ramo-di-corallo'
    WHEN a.name ILIKE 'cuore%'             THEN 'cuore'
  END;

-- Se un articolo "altro" non è stato riconosciuto, qui la migrazione si ferma
-- e non cambia nulla: va aggiunto il suo caso sopra.
ALTER TABLE articles ALTER COLUMN product_type_id SET NOT NULL;
ALTER TABLE articles DROP COLUMN product_type;
DROP TYPE product_type;

COMMIT;
