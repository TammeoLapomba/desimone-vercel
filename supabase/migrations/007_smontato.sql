-- ============================================================
-- 007_smontato.sql — Catalogo Smontato
-- Pezzi lavorati non assemblati: pallini, cannette, sassolini…
-- ============================================================

-- Categorie primo livello (pallini, cannette, sassolini...)
CREATE TABLE raw_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Sottocategorie / pezzi (una riga = una combinazione unica di caratteristiche)
CREATE TABLE raw_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES raw_categories(id),
  size        text,         -- es. "4mm", "Grande", "18cm"
  color       text,         -- es. "Rosso", "Rosa", "Bianco"
  quality     text,         -- es. "Prima scelta", "Seconda", "Extra"
  stock       integer NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Trigger updated_at (riusa la funzione già definita in 003_triggers.sql)
CREATE TRIGGER raw_items_updated_at
  BEFORE UPDATE ON raw_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE raw_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_categories_select" ON raw_categories FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "raw_categories_insert" ON raw_categories FOR INSERT WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "raw_categories_update" ON raw_categories FOR UPDATE USING (get_user_role() = 'admin');

CREATE POLICY "raw_items_select" ON raw_items FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "raw_items_insert" ON raw_items FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "raw_items_update" ON raw_items FOR UPDATE USING (get_user_role() IN ('admin', 'staff'));


