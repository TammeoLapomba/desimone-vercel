-- ============================================================
-- setup_new_project.sql — setup completo di un progetto Supabase NUOVO
-- Incollare tutto nel SQL Editor ed eseguire una sola volta.
-- Generato da migrations/001-017 (esclusa 008, solo sviluppo).
-- ============================================================

-- ------------------------------------------------------------
-- 001_schema.sql
-- ------------------------------------------------------------
-- Enum types
CREATE TYPE channel_type AS ENUM ('retail', 'wholesale', 'both');
CREATE TYPE product_type AS ENUM ('bracciale', 'collana', 'anello', 'orecchini', 'spilla', 'ciondolo', 'altro');
CREATE TYPE material_type AS ENUM ('coral', 'metal');
CREATE TYPE article_status AS ENUM ('draft', 'processing', 'ready', 'published');
CREATE TYPE photo_type AS ENUM ('raw', 'processed', 'shooting');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'done', 'failed');
CREATE TYPE audit_action AS ENUM ('insert', 'update', 'delete');
CREATE TYPE stock_channel AS ENUM ('retail', 'wholesale');

-- collections
CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description_it text,
  description_en text,
  channel     channel_type NOT NULL DEFAULT 'both',
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- materials
CREATE TABLE materials (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  code   text UNIQUE NOT NULL,
  type   material_type NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- articles
CREATE TABLE articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id       uuid NOT NULL REFERENCES collections(id),
  name                text NOT NULL,
  product_type        product_type NOT NULL,
  coral_material_id   uuid REFERENCES materials(id),
  metal_material_id   uuid REFERENCES materials(id),
  sku                 text UNIQUE NOT NULL,
  price_retail        numeric(10,2),
  price_wholesale     numeric(10,2),
  stock_retail        integer NOT NULL DEFAULT 0,
  stock_wholesale     integer NOT NULL DEFAULT 0,
  channel             channel_type NOT NULL DEFAULT 'both',
  status              article_status NOT NULL DEFAULT 'draft',
  description_it      text,
  description_en      text,
  description_fr      text,
  measurements        jsonb,
  tags                text[],
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- photos
CREATE TABLE photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id        uuid NOT NULL REFERENCES articles(id),
  storage_path      text NOT NULL,
  public_url        text,
  photo_type        photo_type NOT NULL DEFAULT 'raw',
  is_cover          boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  processing_status processing_status NOT NULL DEFAULT 'pending',
  error_message     text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- stock_movements
CREATE TABLE stock_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES articles(id),
  channel     stock_channel NOT NULL,
  delta       integer NOT NULL,
  reason      text,
  order_ref   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id)
);

-- audit_log
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  action      audit_action NOT NULL,
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 002_functions.sql
-- ------------------------------------------------------------
-- Genera SKU univoco: COLL-CORAL-METAL-NNN
CREATE OR REPLACE FUNCTION generate_sku(
  p_collection_id uuid,
  p_coral_id uuid,
  p_metal_id uuid
) RETURNS text AS $$
DECLARE
  v_coll_code text;
  v_coral_code text;
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

  SELECT code INTO v_coral_code FROM materials WHERE id = p_coral_id;
  SELECT code INTO v_metal_code FROM materials WHERE id = p_metal_id;

  v_prefix := v_coll_code || '-' || v_coral_code || '-' || v_metal_code || '-';

  SELECT COALESCE(MAX(CAST(RIGHT(sku, 3) AS integer)), 0) + 1
  INTO v_next_num
  FROM articles WHERE sku LIKE v_prefix || '%';

  RETURN v_prefix || LPAD(v_next_num::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sincronizza snapshot stock da stock_movements
CREATE OR REPLACE FUNCTION sync_stock_snapshot()
RETURNS trigger AS $$
BEGIN
  IF NEW.channel = 'retail' THEN
    UPDATE articles SET stock_retail = stock_retail + NEW.delta WHERE id = NEW.article_id;
  ELSIF NEW.channel = 'wholesale' THEN
    UPDATE articles SET stock_wholesale = stock_wholesale + NEW.delta WHERE id = NEW.article_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Audit log generico
CREATE OR REPLACE FUNCTION log_audit()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log(table_name, record_id, action, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW), auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log(table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(table_name, record_id, action, old_values, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 003_triggers.sql
-- ------------------------------------------------------------
-- updated_at automatico su articles
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sync stock snapshot
CREATE TRIGGER stock_movements_sync
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION sync_stock_snapshot();

-- Audit log su articles
CREATE TRIGGER articles_audit
  AFTER INSERT OR UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- ------------------------------------------------------------
-- 004_rls.sql
-- ------------------------------------------------------------
-- Abilita RLS su tutte le tabelle
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper: ruolo utente da user_metadata
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT COALESCE(raw_user_meta_data->>'role', 'viewer')
  FROM auth.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- collections: tutti leggono, solo admin scrive
CREATE POLICY "collections_select" ON collections FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "collections_insert" ON collections FOR INSERT WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "collections_update" ON collections FOR UPDATE USING (get_user_role() = 'admin');

-- materials: tutti leggono, solo admin scrive
CREATE POLICY "materials_select" ON materials FOR SELECT USING (true);
CREATE POLICY "materials_insert" ON materials FOR INSERT WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "materials_update" ON materials FOR UPDATE USING (get_user_role() = 'admin');

-- articles: tutti leggono non-deleted, staff/admin scrivono
CREATE POLICY "articles_select" ON articles FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY "articles_insert" ON articles FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "articles_update" ON articles FOR UPDATE USING (
  deleted_at IS NULL AND get_user_role() IN ('admin', 'staff')
);
CREATE POLICY "articles_delete" ON articles FOR UPDATE USING (get_user_role() = 'admin');

-- photos: stessa logica articles
CREATE POLICY "photos_select" ON photos FOR SELECT USING (true);
CREATE POLICY "photos_insert" ON photos FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "photos_update" ON photos FOR UPDATE USING (get_user_role() IN ('admin', 'staff'));

-- stock_movements: tutti leggono, staff/admin inseriscono
CREATE POLICY "stock_select" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "stock_insert" ON stock_movements FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));

-- audit_log: solo admin legge
CREATE POLICY "audit_select" ON audit_log FOR SELECT USING (get_user_role() = 'admin');

-- ------------------------------------------------------------
-- 005_seed.sql
-- ------------------------------------------------------------
-- Collezioni De Simone
INSERT INTO collections (name, slug, channel, sort_order) VALUES
  ('Intreccio',         'intreccio',         'both', 1),
  ('Abbraccio',         'abbraccio',         'both', 2),
  ('Trame di Corallo',  'trame-di-corallo',  'both', 3),
  ('Cielo Stellato',    'cielo-stellato',    'both', 4);

-- Materiali — Corallo
INSERT INTO materials (name, code, type) VALUES
  ('Corallo Rosso del Mediterraneo', 'CR',  'coral'),
  ('Corallo Rosso Sciacca',          'CS',  'coral'),
  ('Corallo Rosa',                   'RP',  'coral'),
  ('Corallo Bianco',                 'RB',  'coral');

-- Materiali — Metallo
INSERT INTO materials (name, code, type) VALUES
  ('Oro Giallo 18k',     'AU',  'metal'),
  ('Argento 925',        'AG',  'metal'),
  ('Oro Bianco 18k',     'AUB', 'metal'),
  ('Oro Rosa 18k',       'AUR', 'metal');

-- ------------------------------------------------------------
-- Bucket storage 'photos' (pubblico)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 006_storage_policies.sql
-- ------------------------------------------------------------
-- Storage bucket: photos (deve essere creato manualmente in Dashboard → Storage → New bucket)
-- Name: photos, Public: true

-- Chiunque può leggere (bucket pubblico)
CREATE POLICY "photos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'photos');

-- Utenti autenticati possono caricare
CREATE POLICY "photos_auth_upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'photos' AND
  auth.role() = 'authenticated'
);

-- Utenti autenticati possono aggiornare
CREATE POLICY "photos_auth_update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'photos' AND
  auth.role() = 'authenticated'
);

-- ------------------------------------------------------------
-- 007_smontato.sql
-- ------------------------------------------------------------
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



-- ------------------------------------------------------------
-- 009_raw_photos.sql
-- ------------------------------------------------------------
-- ============================================================
-- 009_raw_photos.sql — Foto pezzi smontati (senza elaborazione AI)
-- ============================================================

-- Aggiunge cover_url a raw_items per accesso rapido alla cover
ALTER TABLE raw_items ADD COLUMN cover_url text;

-- Tabella foto per i pezzi smontati (no processing, no pipeline)
CREATE TABLE raw_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_item_id  uuid NOT NULL REFERENCES raw_items(id),
  storage_path text NOT NULL,
  public_url   text,
  is_cover     boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE raw_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_photos_select" ON raw_photos FOR SELECT USING (true);
CREATE POLICY "raw_photos_insert" ON raw_photos FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'staff'));
CREATE POLICY "raw_photos_update" ON raw_photos FOR UPDATE USING (get_user_role() IN ('admin', 'staff'));

-- ------------------------------------------------------------
-- 010_smontato_sku.sql
-- ------------------------------------------------------------
-- ============================================================
-- 010_smontato_sku.sql — Aggiunta SKU per "Smontato"
-- ============================================================

-- 1. Aggiungiamo sku_prefix alla categoria
ALTER TABLE raw_categories ADD COLUMN IF NOT EXISTS sku_prefix varchar(3);

-- Per le categorie esistenti (qualora ce ne fossero), impostiamo un prefisso generico basato sul nome, poi lo forziamo a non nullo
UPDATE raw_categories SET sku_prefix = UPPER(SUBSTRING(slug FROM 1 FOR 3)) WHERE sku_prefix IS NULL;
ALTER TABLE raw_categories ALTER COLUMN sku_prefix SET NOT NULL;

-- 2. Aggiungiamo lo SKU al singolo raw_item
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS sku text UNIQUE;

-- 3. Sequenza univoca per i raw_items
CREATE SEQUENCE IF NOT EXISTS raw_item_sku_seq;

-- 4. Funzione atomically sicura per generare lo SKU
CREATE OR REPLACE FUNCTION generate_raw_sku(p_category_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix varchar(3);
  v_num bigint;
  v_sku text;
BEGIN
  -- Trova il prefisso della categoria
  SELECT sku_prefix INTO v_prefix FROM raw_categories WHERE id = p_category_id FOR SHARE;
  
  -- Prendi il prossimo valore dalla sequenza globale per il magazzino smontato
  v_num := nextval('raw_item_sku_seq');
  
  -- Formato: SM-PRE-00001 (SM = Smontato, PRE = Prefisso)
  v_sku := 'SM-' || v_prefix || '-' || LPAD(v_num::text, 5, '0');
  
  RETURN v_sku;
END;
$$;

-- 5. Trigger per assegnare lo SKU in automatico ai nuovi "Fili"
CREATE OR REPLACE FUNCTION set_raw_item_sku()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sku IS NULL THEN
    NEW.sku := generate_raw_sku(NEW.category_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS raw_items_set_sku_trigger ON raw_items;
CREATE TRIGGER raw_items_set_sku_trigger
  BEFORE INSERT ON raw_items
  FOR EACH ROW
  EXECUTE FUNCTION set_raw_item_sku();

-- ------------------------------------------------------------
-- 011_smontato_peso.sql
-- ------------------------------------------------------------
-- ============================================================
-- 011_smontato_peso.sql — Aggiunta campo Peso per i Fili
-- ============================================================

-- Aggiungiamo peso_totale (in grammi) alla tabella raw_items
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS weight numeric(10, 2) DEFAULT 0.0;

-- ------------------------------------------------------------
-- 012_smontato_sku_quality.sql
-- ------------------------------------------------------------
-- ============================================================
-- 012_smontato_sku_quality.sql — Aggiornamento trigger SKU per Qualità
-- ============================================================

-- Rimpiazziamo la funzione del trigger per includere la qualità (es. I, II, III) nell'SKU
CREATE OR REPLACE FUNCTION set_raw_item_sku()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix varchar(3);
  v_num bigint;
  v_q text;
BEGIN
  IF NEW.sku IS NULL THEN
    -- Trova il prefisso della categoria
    SELECT sku_prefix INTO v_prefix FROM raw_categories WHERE id = NEW.category_id FOR SHARE;
    
    -- Prendi il prossimo valore dalla sequenza globale per il magazzino smontato
    v_num := nextval('raw_item_sku_seq');
    
    -- Estraiamo la qualità in modo sicuro
    v_q := COALESCE(NEW.quality, '');
    
    -- Se c'è una qualità, la mettiamo al centro (es: SM-PAL-I-00001)
    -- Altrimenti generiamo il classico SM-PAL-00001
    IF v_q != '' THEN
       NEW.sku := 'SM-' || v_prefix || '-' || v_q || '-' || LPAD(v_num::text, 5, '0');
    ELSE
       NEW.sku := 'SM-' || v_prefix || '-' || LPAD(v_num::text, 5, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 013_production_security.sql
-- ------------------------------------------------------------
-- ============================================================
-- 013_production_security.sql — Riattiva la sicurezza per la produzione
-- Annulla 008_dev_rls_bypass.sql e rende il ruolo non modificabile dall'utente
-- ============================================================

ALTER TABLE collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_photos       ENABLE ROW LEVEL SECURITY;

-- Il ruolo si legge da app_metadata: user_metadata è modificabile dall'utente
-- stesso via supabase.auth.updateUser(), quindi chiunque potrebbe farsi admin.
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT COALESCE(raw_app_meta_data->>'role', 'viewer')
  FROM auth.users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Aggiornamenti live dello stato articoli nel catalogo (subscribeToArticleStatus)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE articles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------
-- 014_product_types.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 015_metals_materials.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 016_delete_article.sql
-- ------------------------------------------------------------
-- ============================================================
-- 016_delete_article.sql — Eliminazione definitiva di un articolo (solo admin)
-- Si cancellano articolo, foto, materiali e movimenti di magazzino.
-- Lo storico (audit_log) conserva i dati dell'articolo eliminato.
-- ============================================================

BEGIN;

CREATE POLICY "articles_hard_delete" ON articles FOR DELETE USING (get_user_role() = 'admin');
CREATE POLICY "photos_delete" ON photos FOR DELETE USING (get_user_role() = 'admin');
CREATE POLICY "stock_delete" ON stock_movements FOR DELETE USING (get_user_role() = 'admin');

-- File delle foto nello Storage
CREATE POLICY "photos_admin_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'photos' AND
  public.get_user_role() = 'admin'
);

-- Lo storico registra anche l'eliminazione, con i dati che l'articolo aveva
DROP TRIGGER articles_audit ON articles;
CREATE TRIGGER articles_audit
  AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- Tutto in un'unica operazione: se qualcosa fallisce non si cancella nulla.
-- Restituisce i percorsi dei file foto, che il frontend toglie dallo Storage.
CREATE FUNCTION delete_article(p_article_id uuid)
RETURNS text[] AS $$
DECLARE
  v_paths text[];
BEGIN
  -- get_user_role() è NULL senza utente: IS DISTINCT FROM blocca anche quel caso
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un amministratore può eliminare un articolo';
  END IF;

  WITH deleted AS (
    DELETE FROM photos WHERE article_id = p_article_id RETURNING storage_path
  )
  SELECT array_agg(storage_path) INTO v_paths FROM deleted;

  DELETE FROM stock_movements WHERE article_id = p_article_id;

  -- I materiali (article_materials) si cancellano in cascata
  DELETE FROM articles WHERE id = p_article_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Articolo non trovato';
  END IF;

  RETURN COALESCE(v_paths, '{}');
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ------------------------------------------------------------
-- 017_article_status_empty.sql
-- ------------------------------------------------------------
-- ============================================================
-- 017_article_status_empty.sql — Stato articolo vuoto per ora
-- Il campo status resta (con i suoi valori possibili) ma è facoltativo,
-- senza valore predefinito e vuoto per tutti: il suo uso si deciderà più avanti.
-- ============================================================

BEGIN;

ALTER TABLE articles ALTER COLUMN status DROP NOT NULL;
ALTER TABLE articles ALTER COLUMN status DROP DEFAULT;
UPDATE articles SET status = NULL WHERE status IS NOT NULL;

COMMIT;
