-- ============================================================
-- 015_metals_materials.sql — Metalli e materiali separati, più materiali per articolo
-- - metals: i metalli della montatura (uno per articolo, articles.metal_id)
-- - materials: coralli, pietre e altri materiali (quanti se ne vuole per articolo,
--   tabella article_materials; il primo dell'elenco entra nello SKU generato dall'app)
-- ============================================================

BEGIN;

-- ── Metalli ─────────────────────────────────────────────────
CREATE TABLE metals (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  code   text UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- Stessi id dei metalli in materials, così i collegamenti degli articoli restano validi
INSERT INTO metals (id, name, code, active)
SELECT id, name, code, active FROM materials WHERE type = 'metal';

INSERT INTO metals (name, code) VALUES
  ('Oro Giallo 18k',     'AU'),
  ('Oro Bianco 18k',     'AUB'),
  ('Oro Rosa 18k',       'AUR'),
  ('Oro Brunito 18k',    'AUN'),
  ('Argento 925',        'AG'),
  ('Argento Bianco 925', 'AGB'),
  ('Argento Dorato 925', 'AGD'),
  ('Argento Rosa 925',   'AGR')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE metals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metals_select" ON metals FOR SELECT USING (true);
CREATE POLICY "metals_insert" ON metals FOR INSERT WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "metals_update" ON metals FOR UPDATE USING (get_user_role() = 'admin');

ALTER TABLE articles ADD COLUMN metal_id uuid REFERENCES metals(id);
UPDATE articles SET metal_id = metal_material_id WHERE metal_material_id IS NOT NULL;

-- ── Materiali di ogni articolo ──────────────────────────────
CREATE TABLE article_materials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id),
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (article_id, material_id)
);
CREATE INDEX article_materials_material_idx ON article_materials(material_id);

INSERT INTO article_materials (article_id, material_id, sort_order)
SELECT id, coral_material_id, 1 FROM articles WHERE coral_material_id IS NOT NULL;

ALTER TABLE article_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "article_materials_select" ON article_materials FOR SELECT USING (true);
CREATE POLICY "article_materials_insert" ON article_materials FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "article_materials_update" ON article_materials FOR UPDATE USING (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "article_materials_delete" ON article_materials FOR DELETE USING (get_user_role() IN ('admin', 'staff'));

CREATE TRIGGER article_materials_audit
  AFTER INSERT OR UPDATE OR DELETE ON article_materials
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- Sostituisce l'elenco materiali di un articolo, nell'ordine dato.
-- Tocca solo le righe che cambiano, così lo storico registra solo le modifiche vere.
CREATE FUNCTION set_article_materials(p_article_id uuid, p_material_ids uuid[])
RETURNS void AS $$
  DELETE FROM article_materials
  WHERE article_id = p_article_id AND material_id <> ALL (p_material_ids);

  INSERT INTO article_materials (article_id, material_id, sort_order)
  SELECT p_article_id, m.id, m.pos FROM unnest(p_material_ids) WITH ORDINALITY AS m(id, pos)
  ON CONFLICT (article_id, material_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
  WHERE article_materials.sort_order IS DISTINCT FROM EXCLUDED.sort_order;
$$ LANGUAGE sql;

-- ── materials diventa solo coralli, pietre e altri materiali ──
ALTER TABLE articles DROP COLUMN coral_material_id;
ALTER TABLE articles DROP COLUMN metal_material_id;
DELETE FROM materials WHERE type = 'metal';
ALTER TABLE materials DROP COLUMN type;
DROP TYPE material_type;

UPDATE materials SET name = 'Corallo Sciacca' WHERE code = 'CS';

INSERT INTO materials (name, code) VALUES
  ('Corallo Rosso del Mediterraneo', 'CR'),
  ('Corallo Sciacca',                'CS'),
  ('Corallo Rosa',                   'RP'),
  ('Corallo Bianco',                 'RB'),
  ('Turchese',                       'TU'),
  ('Diamante',                       'DI'),
  ('Perla',                          'PE'),
  ('Madreperla',                     'MP'),
  ('Agata',                          'AT'),
  ('Acquamarina',                    'AQ'),
  ('Lapislazzuli',                   'LZ'),
  ('Onice',                          'ON'),
  ('Cianite',                        'CI'),
  ('Crisoprasio',                    'CP'),
  ('Conchiglia',                     'CO'),
  ('Granato',                        'GR'),
  ('Malachite',                      'MA'),
  ('Pelle',                          'PL'),
  ('Pietra lavica',                  'LV'),
  ('Plexiglass',                     'PX')
ON CONFLICT (code) DO NOTHING;

-- ── SKU generato dall'app: COLL-MATERIALE-METALLO-NNN ─────────
DROP FUNCTION generate_sku(uuid, uuid, uuid);
CREATE FUNCTION generate_sku(
  p_collection_id uuid,
  p_material_id uuid,
  p_metal_id uuid
) RETURNS text AS $$
DECLARE
  v_coll_code text;
  v_material_code text;
  v_metal_code text;
  v_next_num integer;
  v_prefix text;
BEGIN
  SELECT CASE slug
    WHEN 'intreccio' THEN 'INTR'
    WHEN 'abbraccio' THEN 'ABBR'
    WHEN 'trame-di-corallo' THEN 'TRAM'
    WHEN 'cielo-stellato' THEN 'CIEL'
    ELSE UPPER(LEFT(slug, 4))
  END INTO v_coll_code FROM collections WHERE id = p_collection_id;

  SELECT code INTO v_material_code FROM materials WHERE id = p_material_id;
  SELECT code INTO v_metal_code FROM metals WHERE id = p_metal_id;

  v_prefix := v_coll_code || '-' || v_material_code || '-' || v_metal_code || '-';

  SELECT COALESCE(MAX(CAST(RIGHT(sku, 3) AS integer)), 0) + 1
  INTO v_next_num
  FROM articles WHERE sku LIKE v_prefix || '%';

  RETURN v_prefix || LPAD(v_next_num::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
