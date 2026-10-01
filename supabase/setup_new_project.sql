-- ============================================================
-- setup_new_project.sql — setup completo di un progetto Supabase NUOVO
-- Incollare tutto nel SQL Editor ed eseguire una sola volta.
-- Generato da migrations/001-021 (esclusa 008, solo sviluppo).
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

-- ------------------------------------------------------------
-- 018_delete_collection.sql
-- ------------------------------------------------------------
-- ============================================================
-- 018_delete_collection.sql — Eliminazione definitiva di una collezione (solo admin)
-- Prima si eliminano tutti i suoi articoli (con foto, materiali e movimenti),
-- poi la collezione. Lo storico (audit_log) conserva i dati degli articoli eliminati.
-- ============================================================

BEGIN;

-- SECURITY DEFINER: elimina anche eventuali articoli nascosti (deleted_at), che le
-- regole di lettura non mostrano e che altrimenti bloccherebbero la cancellazione.
-- Per questo il controllo del ruolo è fatto qui dentro.
CREATE FUNCTION delete_collection(p_collection_id uuid)
RETURNS text[] AS $$
DECLARE
  v_paths text[];
BEGIN
  -- get_user_role() è NULL senza utente: IS DISTINCT FROM blocca anche quel caso
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un amministratore può eliminare una collezione';
  END IF;

  WITH deleted AS (
    DELETE FROM photos
    WHERE article_id IN (SELECT id FROM articles WHERE collection_id = p_collection_id)
    RETURNING storage_path
  )
  SELECT array_agg(storage_path) INTO v_paths FROM deleted;

  DELETE FROM stock_movements
  WHERE article_id IN (SELECT id FROM articles WHERE collection_id = p_collection_id);

  -- I materiali (article_materials) si cancellano in cascata
  DELETE FROM articles WHERE collection_id = p_collection_id;

  DELETE FROM collections WHERE id = p_collection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collezione non trovata';
  END IF;

  RETURN COALESCE(v_paths, '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;

-- ------------------------------------------------------------
-- 019_semilavorato_codici.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 020_semilavorato_import.sql
-- ------------------------------------------------------------
-- ============================================================
-- 020_semilavorato_import.sql — I 430 articoli del file «codici inventario pallini e spole»
--
-- Codici e descrizioni sono quelli del cliente, senza modifiche (tolti solo gli spazi a inizio e fine).
-- Quantità e peso partono da 0: il file è un elenco di codici, non una giacenza.
-- I valori delle colonne B, M, A, F del file non sono importati (significato da confermare).
-- Gli articoli già presenti (stesso codice) non vengono toccati: si può rieseguire.
-- Richiede 019_semilavorato_codici.sql.
-- ============================================================

BEGIN;
INSERT INTO raw_items (sku, description, category_id, group_code, shape_id, quality, finish, size,
                       size_from_mm, size_to_mm, width_mm, length_mm, height_mm, length_cm, variants)
SELECT v.sku, v.description, c.id, v.group_code, s.id, v.quality, v.finish, v.size,
       v.size_from_mm::numeric, v.size_to_mm::numeric, v.width_mm::numeric, v.length_mm::numeric,
       v.height_mm::numeric, v.length_cm::numeric, v.variants::text[]
FROM (VALUES
  ('1.2.25', 'Fili pallini SA I mm 2,25', 'pallini', '1', 'filo', 'I', '', '2,25 mm', 2.25, 2.25, NULL, NULL, NULL, NULL, '{}'),
  ('1.2.50', 'Fili pallini SA I mm 2,50', 'pallini', '1', 'filo', 'I', '', '2,5 mm', 2.5, 2.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.2.75', 'Fili pallini SA I mm 2,75', 'pallini', '1', 'filo', 'I', '', '2,75 mm', 2.75, 2.75, NULL, NULL, NULL, NULL, '{}'),
  ('1.3.0', 'Fili pallini SA I mm 3', 'pallini', '1', 'filo', 'I', '', '3 mm', 3, 3, NULL, NULL, NULL, NULL, '{}'),
  ('1.3.5', 'Fili pallini SA I mm 3,5', 'pallini', '1', 'filo', 'I', '', '3,5 mm', 3.5, 3.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.4.0', 'Fili pallini SA I mm 4', 'pallini', '1', 'filo', 'I', '', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('1.4.5', 'Fili pallini SA I mm 4,5', 'pallini', '1', 'filo', 'I', '', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.4.5B', 'Bracciali pallini SA I mm 4,5 cm 18', 'pallini', '1', 'bracciale', 'I', '', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, 18, '{}'),
  ('1.5', 'Fili pallini SA I mm 5', 'pallini', '1', 'filo', 'I', '', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('1.5B', 'Fili pallini SA I mm 5', 'pallini', '1', 'filo', 'I', '', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('1.5.5', 'Fili pallini SA I mm 5,5', 'pallini', '1', 'filo', 'I', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.5.50B', 'Bracciali pallini SA I mm 5,5 cm 17,5', 'pallini', '1', 'bracciale', 'I', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, 17.5, '{}'),
  ('1.6.0', 'Fili pallini SA I mm 6', 'pallini', '1', 'filo', 'I', '', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('1.6.5', 'Fili pallini SA I mm 6,5', 'pallini', '1', 'filo', 'I', '', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.6B', 'Bracciali pallini SA I mm 6 cm 16,5', 'pallini', '1', 'bracciale', 'I', '', '6 mm', 6, 6, NULL, NULL, NULL, 16.5, '{}'),
  ('1.6.5B', 'Bracciali pallini Sa i mm 6,5 cm 18', 'pallini', '1', 'bracciale', 'I', '', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, 18, '{}'),
  ('1.6.65B', 'Bracciali pallini SA I mm 6-6,5 cm 18', 'pallini', '1', 'bracciale', 'I', '', '6/6,5 mm', 6, 6.5, NULL, NULL, NULL, 18, '{}'),
  ('1.7.0', 'Fili pallini SA I mm 7', 'pallini', '1', 'filo', 'I', '', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('1.7.5', 'Fili pallini SA I mm 7,5 cm 45', 'pallini', '1', 'filo', 'I', '', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, 45, '{}'),
  ('1.7.50.8B', 'Bracciali pallini SA I mm 7,5 /8 cm 15 20 pallini', 'pallini', '1', 'bracciale', 'I', '', '7,5/8 mm', 7.5, 8, NULL, NULL, NULL, 15, '{}'),
  ('1.7B', 'Bracciali pallini SA I mm 7 cm 18', 'pallini', '1', 'bracciale', 'I', '', '7 mm', 7, 7, NULL, NULL, NULL, 18, '{}'),
  ('1.7.8', 'Fili pallini SA I mm 7/ 8', 'pallini', '1', 'filo', 'I', '', '7/8 mm', 7, 8, NULL, NULL, NULL, NULL, '{}'),
  ('1.7.85B', 'Bracciali pallini Sa i mm 7/8,5 cm 18', 'pallini', '1', 'bracciale', 'I', '', '7/8,5 mm', 7, 8.5, NULL, NULL, NULL, 18, '{}'),
  ('1.825.1025', 'Fili pallini SA I mm 8,25-10,25', 'pallini', '1', 'filo', 'I', '', '8,25/10,25 mm', 8.25, 10.25, NULL, NULL, NULL, NULL, '{}'),
  ('1.85.95', 'Fili pallini SA I mm 8,5/9,5 CM 45', 'pallini', '1', 'filo', 'I', '', '8,5/9,5 mm', 8.5, 9.5, NULL, NULL, NULL, 45, '{}'),
  ('1.8.9', 'Fili pallini SA I mm 8/9', 'pallini', '1', 'filo', 'I', '', '8/9 mm', 8, 9, NULL, NULL, NULL, NULL, '{}'),
  ('1.9.0', 'Fili pallini SA I mm 9', 'pallini', '1', 'filo', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('1.9B', 'Bracciale pallini SA I mm 9 cm 23', 'pallini', '1', 'bracciale', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, 23, '{}'),
  ('1.95.10B', 'Bracciale pallini SA I mm 9,5 - 10 cm 20', 'pallini', '1', 'bracciale', 'I', '', '9,5/10 mm', 9.5, 10, NULL, NULL, NULL, 20, '{}'),
  ('1.9.95', 'Fili pallini SA I mm 9/9,5', 'pallini', '1', 'filo', 'I', '', '9/9,5 mm', 9, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.9.10', 'Fili pallini SA I mm 9/10', 'pallini', '1', 'filo', 'I', '', '9/10 mm', 9, 10, NULL, NULL, NULL, NULL, '{}'),
  ('1.9.5', 'Fili pallini SA I mm 9,5', 'pallini', '1', 'filo', 'I', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('1.8.5CDD', 'Fili pallini SA I mm 8,5 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.8.9CDD', 'Fili pallini SA I mm 8/9 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '8/9 mm', 8, 9, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.85.10CDD', 'Fili pallini SA I mm 8,5/10 cm 38 CDD', 'pallini', '1', 'filo', 'I', '', '8,5/10 mm', 8.5, 10, NULL, NULL, NULL, 38, '{CDD}'),
  ('1.8CDD', 'Fili pallini SA I mm 8 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '8 mm', 8, 8, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.9.10CDD', 'Fili pallini SA I mm 9/10 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '9/10 mm', 9, 10, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.9.5CDD', 'Fili pallini SA I mm 9,5 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.9CDD', 'Fili pallini SA I mm 9 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.11CDD', 'Fili pallini SA I mm 11 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '11 mm', 11, 11, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.7,5CDD', 'Fili pallini SA I mm 7,5 cm 45 CDD', 'pallini', '1', 'filo', 'I', '', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, 45, '{CDD}'),
  ('1.7CDD', 'Fili pallini SA I mm 7cm 30 CDD', 'pallini', '1', 'filo', 'I', '', '7 mm', 7, 7, NULL, NULL, NULL, 30, '{CDD}'),
  ('1.9.10CEL', 'Fili pallini SA IEX mm 9/10 cm 42', 'pallini', '1', 'filo', 'I', '', '9/10 mm', 9, 10, NULL, NULL, NULL, 42, '{CEL}'),
  ('1.9.10.41CEL', 'Fili pallini SA I mm 9/10 cm 41', 'pallini', '1', 'filo', 'I', '', '9/10 mm', 9, 10, NULL, NULL, NULL, 41, '{CEL}'),
  ('1.9.CEL', 'Fili pallini SA I mm 9 cm 42', 'pallini', '1', 'filo', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, 42, '{CEL}'),
  ('1.85.95CEL', 'Fili pallini SA I mm 8,5/9,5 cm 50', 'pallini', '1', 'filo', 'I', '', '8,5/9,5 mm', 8.5, 9.5, NULL, NULL, NULL, 50, '{CEL}'),
  ('1.89CEL', 'Fili pallini SA I mm 8/9 cm 44', 'pallini', '1', 'filo', 'I', '', '8/9 mm', 8, 9, NULL, NULL, NULL, 44, '{CEL}'),
  ('2.2.25', 'fili palline SA Iex mm 2,25', 'pallini', '2', 'filo', 'I', 'EX', '2,25 mm', 2.25, 2.25, NULL, NULL, NULL, NULL, '{}'),
  ('2.2.50', 'fili palline SA Iex mm 2,5', 'pallini', '2', 'filo', 'I', 'EX', '2,5 mm', 2.5, 2.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.3.0', 'fili palline SA Iex mm 3', 'pallini', '2', 'filo', 'I', 'EX', '3 mm', 3, 3, NULL, NULL, NULL, NULL, '{}'),
  ('2.3.50', 'fili palline SA Iex mm 3,5', 'pallini', '2', 'filo', 'I', 'EX', '3,5 mm', 3.5, 3.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.4.0', 'fili palline SA Iex mm 4', 'pallini', '2', 'filo', 'I', 'EX', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('2.4.5', 'fili palline SA Iex mm 4,5', 'pallini', '2', 'filo', 'I', 'EX', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.5.0', 'fili palline SA Iex mm 5', 'pallini', '2', 'filo', 'I', 'EX', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('2.5.5', 'fili palline SA Iex mm 5,5', 'pallini', '2', 'filo', 'I', 'EX', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.6.0', 'fili palline SA Iex mm 6', 'pallini', '2', 'filo', 'I', 'EX', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('2.6.40', 'fili palline SA Iex mm 6 cm 40', 'pallini', '2', 'filo', 'I', 'EX', '6 mm', 6, 6, NULL, NULL, NULL, 40, '{}'),
  ('2.6.5', 'fili palline SA Iex mm 6,5', 'pallini', '2', 'filo', 'I', 'EX', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.6.65', 'fili palline SA Iex mm 6/ 6,5', 'pallini', '2', 'filo', 'I', 'EX', '6/6,5 mm', 6, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.65.725', 'fili palline SA Iex mm 6,5/ 7,25', 'pallini', '2', 'filo', 'I', 'EX', '6,5/7,25 mm', 6.5, 7.25, NULL, NULL, NULL, NULL, '{}'),
  ('2.7.0', 'fili palline SA Iex mm 7', 'pallini', '2', 'filo', 'I', 'EX', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('2.7.5', 'fili palline SA Iex mm 7,5', 'pallini', '2', 'filo', 'I', 'EX', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('2.7.975', 'fili palline SA Iex mm 7-9,75', 'pallini', '2', 'filo', 'I', 'EX', '7/9,75 mm', 7, 9.75, NULL, NULL, NULL, NULL, '{}'),
  ('2.75.8', 'fili palline SA Iex mm 7,5-8', 'pallini', '2', 'filo', 'I', 'EX', '7,5/8 mm', 7.5, 8, NULL, NULL, NULL, NULL, '{}'),
  ('2.7.12', 'fili palline SA Iex mm 7-12 CM 60', 'pallini', '2', 'filo', 'I', 'EX', '7/12 mm', 7, 12, NULL, NULL, NULL, 60, '{}'),
  ('2.5.50B', 'bracciale fili palline SA Iex mm 5,5 CM 18', 'pallini', '2', 'bracciale', 'I', 'EX', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, 18, '{}'),
  ('2.6B', 'bracciale fili palline SA Iex mm 6 CM 18', 'pallini', '2', 'bracciale', 'I', 'EX', '6 mm', 6, 6, NULL, NULL, NULL, 18, '{}'),
  ('2.65.7B', 'bracciale fili palline SA Iex mm 6,5/7 CM 16', 'pallini', '2', 'bracciale', 'I', 'EX', '6,5/7 mm', 6.5, 7, NULL, NULL, NULL, 16, '{}'),
  ('2.5.5B', 'bracciale fili palline SA Iex mm 5,5 CM 17', 'pallini', '2', 'bracciale', 'I', 'EX', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, 17, '{}'),
  ('2.6.5B', 'bracciale fili palline SA Iex mm 6,5 CM 12,5', 'pallini', '2', 'bracciale', 'I', 'EX', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, 12.5, '{}'),
  ('2.7B', 'bracciale fili palline SA Iex mm 7 CM 19', 'pallini', '2', 'bracciale', 'I', 'EX', '7 mm', 7, 7, NULL, NULL, NULL, 19, '{}'),
  ('2.7.5B', 'bracciale fili palline SA Iex mm 7,5 CM 18,5', 'pallini', '2', 'bracciale', 'I', 'EX', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, 18.5, '{}'),
  ('2.8B', 'bracciale fili palline SA Iex mm 8 CM 18', 'pallini', '2', 'bracciale', 'I', 'EX', '8 mm', 8, 8, NULL, NULL, NULL, 18, '{}'),
  ('2.7.825B', 'bracciale fili palline SA Iex mm 7/8,25 CM 19,5', 'pallini', '2', 'bracciale', 'I', 'EX', '7/8,25 mm', 7, 8.25, NULL, NULL, NULL, 19.5, '{}'),
  ('2.7.75B', 'bracciale fili palline SA Iex mm 7/7,5 CM 18', 'pallini', '2', 'bracciale', 'I', 'EX', '7/7,5 mm', 7, 7.5, NULL, NULL, NULL, 18, '{}'),
  ('2.8', 'fili palline SA Iex mm 8', 'pallini', '2', 'filo', 'I', 'EX', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('2.8.95B', 'bracciale fili palline SA Iex mm 8/9,5 CM 18', 'pallini', '2', 'bracciale', 'I', 'EX', '8/9,5 mm', 8, 9.5, NULL, NULL, NULL, 18, '{}'),
  ('2.85.95', 'fili palline SA Iex mm 8,5-9,5 cm 45', 'pallini', '2', 'filo', 'I', 'EX', '8,5/9,5 mm', 8.5, 9.5, NULL, NULL, NULL, 45, '{}'),
  ('2.9.11', 'fili palline SA Iex mm 9-11', 'pallini', '2', 'filo', 'I', 'EX', '9/11 mm', 9, 11, NULL, NULL, NULL, NULL, '{}'),
  ('2 1025 1250', 'fili palline SA Iex mm 10,25-12,50', 'pallini', '2', 'filo', 'I', 'EX', '10,25/12,5 mm', 10.25, 12.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.4.5', 'Fili pallini SA I EX EX mm 4,5', 'pallini', '3', 'filo', 'I', 'EX EX', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.6', 'Fili pallini SA I EX EX mm 6', 'pallini', '3', 'filo', 'I', 'EX EX', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('3.6.5', 'Fili pallini SA I EX EX mm 6,5', 'pallini', '3', 'filo', 'I', 'EX EX', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.6.65', 'Fili pallini SA I EX EX mm 6/65', 'pallini', '3', 'filo', 'I', 'EX EX', '6/6,5 mm', 6, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.7', 'Fili pallini SA I EX EX mm 7', 'pallini', '3', 'filo', 'I', 'EX EX', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('3.7.5', 'Fili pallini SA I EX EX mm 7,5', 'pallini', '3', 'filo', 'I', 'EX EX', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.7.8', 'Fili pallini SA I EX EX mm 7/8', 'pallini', '3', 'filo', 'I', 'EX EX', '7/8 mm', 7, 8, NULL, NULL, NULL, NULL, '{}'),
  ('3.7.95', 'Fili pallini SA I EX EX mm 7/9,5', 'pallini', '3', 'filo', 'I', 'EX EX', '7/9,5 mm', 7, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('3.8.75', 'Fili pallini SA I EX EX mm 7,5/8', 'pallini', '3', 'filo', 'I', 'EX EX', '7,5/8 mm', 7.5, 8, NULL, NULL, NULL, NULL, '{}'),
  ('4.5.5', 'Fili pallini SA II mm 5,5', 'pallini', '4', 'filo', 'II', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('4.9.0', 'Fili pallini SA II mm 9', 'pallini', '4', 'filo', 'II', '', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('4.9.50', 'Fili pallini SA II mm 9,5', 'pallini', '4', 'filo', 'II', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('4.95.105', 'Fili pallini SA II mm 9,5/10,5', 'pallini', '4', 'filo', 'II', '', '9,5/10,5 mm', 9.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('4.10.115', 'Fili pallini SA II mm 10/11,5', 'pallini', '4', 'filo', 'II', '', '10/11,5 mm', 10, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('8.8.0', 'fili pallini SA III A EX mm 8 cm 45', 'pallini', '8', 'filo', 'IIIA', 'EX', '8 mm', 8, 8, NULL, NULL, NULL, 45, '{}'),
  ('8.8.5', 'fili pallini SA III A EX mm 8,5 cm 45', 'pallini', '8', 'filo', 'IIIA', 'EX', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, 45, '{}'),
  ('8.9.95', 'fili pallini SA III A EX mm  9/ 9,5 cm 45', 'pallini', '8', 'filo', 'IIIA', 'EX', '9/9,5 mm', 9, 9.5, NULL, NULL, NULL, 45, '{}'),
  ('8.8.12', 'fili pallini SA III A EX mm  8/12 cm 45', 'pallini', '8', 'filo', 'IIIA', 'EX', '8/12 mm', 8, 12, NULL, NULL, NULL, 45, '{}'),
  ('41.3.5', 'Spole SA I OVALI mm 3x5', 'spole', '41', 'spola-ovale', 'I', '', '3x5 mm', NULL, NULL, 3, 5, NULL, NULL, '{}'),
  ('41.4.6', 'Spole SA I OVALI mm 4x6', 'spole', '41', 'spola-ovale', 'I', '', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('41.5.7', 'Spole SA I OVALI mm 5x7', 'spole', '41', 'spola-ovale', 'I', '', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{}'),
  ('41.5.10', 'Spole SA I OVALI mm 5x10', 'spole', '41', 'spola-ovale', 'I', '', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('41.5.15', 'Spole SA I OVALI mm 5x15', 'spole', '41', 'spola-ovale', 'I', '', '5x15 mm', NULL, NULL, 5, 15, NULL, NULL, '{}'),
  ('41.6.8', 'Spole SA I OVALI mm 6x8', 'spole', '41', 'spola-ovale', 'I', '', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{}'),
  ('41.6.8NINO', 'Spole SA I OVALI mm 6x8 NINO', 'spole', '41', 'spola-ovale', 'I', '', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{NINO}'),
  ('41.6.10', 'Spole SA I OVALI mm 6x10', 'spole', '41', 'spola-ovale', 'I', '', '6x10 mm', NULL, NULL, 6, 10, NULL, NULL, '{}'),
  ('41.6.12', 'Spole SA I OVALI mm 6x12', 'spole', '41', 'spola-ovale', 'I', '', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('41.6.14', 'Spole SA I OVALI mm 6x14', 'spole', '41', 'spola-ovale', 'I', '', '6x14 mm', NULL, NULL, 6, 14, NULL, NULL, '{}'),
  ('41.6.16', 'Spole SA I OVALI mm 6x16', 'spole', '41', 'spola-ovale', 'I', '', '6x16 mm', NULL, NULL, 6, 16, NULL, NULL, '{}'),
  ('41.6.18', 'Spole SA I OVALI mm 6x18', 'spole', '41', 'spola-ovale', 'I', '', '6x18 mm', NULL, NULL, 6, 18, NULL, NULL, '{}'),
  ('41.7.9', 'Spole SA I OVALI mm 7x9', 'spole', '41', 'spola-ovale', 'I', '', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{}'),
  ('41.7.9NINO', 'Spole SA I OVALI mm 7x9 NINO', 'spole', '41', 'spola-ovale', 'I', '', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{NINO}'),
  ('41.7.10', 'Spole SA I OVALI mm 7x10', 'spole', '41', 'spola-ovale', 'I', '', '7x10 mm', NULL, NULL, 7, 10, NULL, NULL, '{}'),
  ('41.7.11', 'Spole SA I OVALI mm 7x11', 'spole', '41', 'spola-ovale', 'I', '', '7x11 mm', NULL, NULL, 7, 11, NULL, NULL, '{}'),
  ('41.7.12', 'Spole SA I OVALI mm 7x12', 'spole', '41', 'spola-ovale', 'I', '', '7x12 mm', NULL, NULL, 7, 12, NULL, NULL, '{}'),
  ('41.7.13', 'Spole SA I OVALI mm 7x13', 'spole', '41', 'spola-ovale', 'I', '', '7x13 mm', NULL, NULL, 7, 13, NULL, NULL, '{}'),
  ('41.7.14', 'Spole SA I OVALI mm 7x14', 'spole', '41', 'spola-ovale', 'I', '', '7x14 mm', NULL, NULL, 7, 14, NULL, NULL, '{}'),
  ('41.7.16', 'Spole SA I OVALI mm 7x16', 'spole', '41', 'spola-ovale', 'I', '', '7x16 mm', NULL, NULL, 7, 16, NULL, NULL, '{}'),
  ('41.7.18', 'Spole SA I OVALI mm 7x18', 'spole', '41', 'spola-ovale', 'I', '', '7x18 mm', NULL, NULL, 7, 18, NULL, NULL, '{}'),
  ('41.7.20', 'Spole SA I OVALI mm 7x20', 'spole', '41', 'spola-ovale', 'I', '', '7x20 mm', NULL, NULL, 7, 20, NULL, NULL, '{}'),
  ('41.8.10', 'Spole SA I OVALI mm 8x10', 'spole', '41', 'spola-ovale', 'I', '', '8x10 mm', NULL, NULL, 8, 10, NULL, NULL, '{}'),
  ('41.8.11', 'Spole SA I OVALI mm 8x11', 'spole', '41', 'spola-ovale', 'I', '', '8x11 mm', NULL, NULL, 8, 11, NULL, NULL, '{}'),
  ('41.8.12', 'Spole SA I OVALI mm 8x12', 'spole', '41', 'spola-ovale', 'I', '', '8x12 mm', NULL, NULL, 8, 12, NULL, NULL, '{}'),
  ('41.8.13', 'Spole SA I OVALI mm 8x13', 'spole', '41', 'spola-ovale', 'I', '', '8x13 mm', NULL, NULL, 8, 13, NULL, NULL, '{}'),
  ('41.8.14', 'Spole SA I OVALI mm 8x14', 'spole', '41', 'spola-ovale', 'I', '', '8x14 mm', NULL, NULL, 8, 14, NULL, NULL, '{}'),
  ('41.8.15', 'Spole SA I OVALI mm 8x15', 'spole', '41', 'spola-ovale', 'I', '', '8x15 mm', NULL, NULL, 8, 15, NULL, NULL, '{}'),
  ('41.8.16', 'Spole SA I OVALI mm 8x16', 'spole', '41', 'spola-ovale', 'I', '', '8x16 mm', NULL, NULL, 8, 16, NULL, NULL, '{}'),
  ('41.8.18', 'Spole SA I OVALI mm 8x18', 'spole', '41', 'spola-ovale', 'I', '', '8x18 mm', NULL, NULL, 8, 18, NULL, NULL, '{}'),
  ('41.8.20', 'Spole SA I OVALI mm 8x20', 'spole', '41', 'spola-ovale', 'I', '', '8x20 mm', NULL, NULL, 8, 20, NULL, NULL, '{}'),
  ('41.9.11', 'Spole SA I OVALI mm 9x11', 'spole', '41', 'spola-ovale', 'I', '', '9x11 mm', NULL, NULL, 9, 11, NULL, NULL, '{}'),
  ('41.9.12', 'Spole SA I OVALI mm9x12', 'spole', '41', 'spola-ovale', 'I', '', '9x12 mm', NULL, NULL, 9, 12, NULL, NULL, '{}'),
  ('41.9.13', 'Spole SA I OVALI mm 9x13', 'spole', '41', 'spola-ovale', 'I', '', '9x13 mm', NULL, NULL, 9, 13, NULL, NULL, '{}'),
  ('41.9.14', 'Spole SA I OVALI mm 9x14', 'spole', '41', 'spola-ovale', 'I', '', '9x14 mm', NULL, NULL, 9, 14, NULL, NULL, '{}'),
  ('41.9.15', 'Spole SA I OVALI mm 9x15', 'spole', '41', 'spola-ovale', 'I', '', '9x15 mm', NULL, NULL, 9, 15, NULL, NULL, '{}'),
  ('41.9.16', 'Spole SA I OVALI mm 9x16', 'spole', '41', 'spola-ovale', 'I', '', '9x16 mm', NULL, NULL, 9, 16, NULL, NULL, '{}'),
  ('41.10.12', 'Spole SA I OVALI mm 10x12', 'spole', '41', 'spola-ovale', 'I', '', '10x12 mm', NULL, NULL, 10, 12, NULL, NULL, '{}'),
  ('41.10.14', 'Spole SA I OVALI mm 10x14', 'spole', '41', 'spola-ovale', 'I', '', '10x14 mm', NULL, NULL, 10, 14, NULL, NULL, '{}'),
  ('41.10.16', 'Spole SA I OVALI mm 10x16', 'spole', '41', 'spola-ovale', 'I', '', '10x16 mm', NULL, NULL, 10, 16, NULL, NULL, '{}'),
  ('41.11.15', 'Spole SA I OVALI mm 11x15', 'spole', '41', 'spola-ovale', 'I', '', '11x15 mm', NULL, NULL, 11, 15, NULL, NULL, '{}'),
  ('41.12.14', 'Spole SA I OVALI mm 12x14', 'spole', '41', 'spola-ovale', 'I', '', '12x14 mm', NULL, NULL, 12, 14, NULL, NULL, '{}'),
  ('41.12.16', 'Spole SA I OVALI mm 12x16', 'spole', '41', 'spola-ovale', 'I', '', '12x16 mm', NULL, NULL, 12, 16, NULL, NULL, '{}'),
  ('41.13.18', 'Spole SA I OVALI mm 13x18', 'spole', '41', 'spola-ovale', 'I', '', '13x18 mm', NULL, NULL, 13, 18, NULL, NULL, '{}'),
  ('41.15.20', 'Spole SA I OVALI mm 15x20', 'spole', '41', 'spola-ovale', 'I', '', '15x20 mm', NULL, NULL, 15, 20, NULL, NULL, '{}'),
  ('41/FM 6.7', 'Spole SA I OVALI mm 6/7 f.m.', 'spole', '41', 'spola-ovale', 'I', '', '6/7 mm f.m.', 6, 7, NULL, NULL, NULL, NULL, '{FM}'),
  ('41.FM.8.9.10', 'Spole SA I OVALI mm 8/9/10 f.m.', 'spole', '41', 'spola-ovale', 'I', '', '8/9/10 mm f.m.', 8, 10, NULL, NULL, NULL, NULL, '{FM}'),
  ('41/FM.11up', 'Spole SA I OVALI mm 11/15 f.m.', 'spole', '41', 'spola-ovale', 'I', '', '11/15 mm f.m. e oltre', 11, 15, NULL, NULL, NULL, NULL, '{FM,UP}'),
  ('41TR.12', 'Spola triangolo SA I mm 12 h 5', 'spole', '41', 'spola-triangolo', 'I', '', '12 mm', 12, 12, NULL, NULL, 5, NULL, '{}'),
  ('41TR.16', 'Spola triangolo SA I mm 16 h 5', 'spole', '41', 'spola-triangolo', 'I', '', '16 mm', 16, 16, NULL, NULL, 5, NULL, '{}'),
  ('41N.3.5', 'Navette SA I mm 3x5', 'navette', '41N', 'navetta', 'I', '', '3x5 mm', NULL, NULL, 3, 5, NULL, NULL, '{}'),
  ('41N.3.6', 'Navette SA I mm 3x6', 'navette', '41N', 'navetta', 'I', '', '3x6 mm', NULL, NULL, 3, 6, NULL, NULL, '{}'),
  ('41N.4.6', 'Navette SA I mm 4x6', 'navette', '41N', 'navetta', 'I', '', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('41N.4.8', 'Navette SA I mm 4x8', 'navette', '41N', 'navetta', 'I', '', '4x8 mm', NULL, NULL, 4, 8, NULL, NULL, '{}'),
  ('41N.5.10', 'Navette SA I mm 5x10', 'navette', '41N', 'navetta', 'I', '', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('41N.6.12', 'Navette SA I mm 6x12', 'navette', '41N', 'navetta', 'I', '', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('41N.9.2150', 'Navette SA I mm 9x21,5', 'navette', '41N', 'navetta', 'I', '', '9x21,5 mm', NULL, NULL, 9, 21.5, NULL, NULL, '{}'),
  ('41N.10.20', 'Navette SA I mm 10x20', 'navette', '41N', 'navetta', 'I', '', '10x20 mm', NULL, NULL, 10, 20, NULL, NULL, '{}'),
  ('41N.FM.5.6.7', 'Navette SA I  FM mm 5/6/7', 'navette', '41N', 'navetta', 'I', '', '5/6/7 mm f.m.', 5, 7, NULL, NULL, NULL, NULL, '{FM}'),
  ('41N.FM.7.8.9', 'Navette SA I  FM mm 7/8/9', 'navette', '41N', 'navetta', 'I', '', '7/8/9 mm f.m.', 7, 9, NULL, NULL, NULL, NULL, '{FM}'),
  ('42N.4.8', 'Navette SA I EXTRA mm 4x8', 'navette', '42N', 'navetta', 'I', 'EX', '4x8 mm', NULL, NULL, 4, 8, NULL, NULL, '{}'),
  ('42N.5.10', 'Navette SA I EXTRA mm 5X10', 'navette', '42N', 'navetta', 'I', 'EX', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('42.3.5', 'Spole SA I EXTRA OVALI mm3x5', 'spole', '42', 'spola-ovale', 'I', 'EX', '3x5 mm', NULL, NULL, 3, 5, NULL, NULL, '{}'),
  ('42.4.6', 'Spole SA I EXTRA OVALI mm 4x6', 'spole', '42', 'spola-ovale', 'I', 'EX', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('42.5.7', 'Spole SA I EXTRA OVALI mm 5x7', 'spole', '42', 'spola-ovale', 'I', 'EX', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{}'),
  ('42.5.10', 'Spole SA I EXTRA OVALI mm 5x10', 'spole', '42', 'spola-ovale', 'I', 'EX', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('42.5.15', 'Spole SA I EXTRA OVALI mm 5x15', 'spole', '42', 'spola-ovale', 'I', 'EX', '5x15 mm', NULL, NULL, 5, 15, NULL, NULL, '{}'),
  ('42.6.8', 'Spole SA I EXTRA OVALI mm 6x8', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{}'),
  ('42.6.10', 'Spole SA I EXTRA OVALI mm 6x10', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x10 mm', NULL, NULL, 6, 10, NULL, NULL, '{}'),
  ('42.6.12', 'Spole SA I EXTRA OVALI mm 6x12', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('42.6.13', 'Spole SA I EXTRA OVALI mm 6x13', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x13 mm', NULL, NULL, 6, 13, NULL, NULL, '{}'),
  ('42.6.14', 'Spole SA I EXTRA OVALI mm 6x14', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x14 mm', NULL, NULL, 6, 14, NULL, NULL, '{}'),
  ('42.6.18', 'Spole SA I EXTRA OVALI mm 6x18', 'spole', '42', 'spola-ovale', 'I', 'EX', '6x18 mm', NULL, NULL, 6, 18, NULL, NULL, '{}'),
  ('42.7.9', 'Spole SA I EXTRA OVALI mm 7x9', 'spole', '42', 'spola-ovale', 'I', 'EX', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{}'),
  ('42.7.10', 'Spole SA I EXTRA OVALI mm 7x10', 'spole', '42', 'spola-ovale', 'I', 'EX', '7x10 mm', NULL, NULL, 7, 10, NULL, NULL, '{}'),
  ('42.7.11', 'Spole SA I EXTRA OVALI mm 7x11', 'spole', '42', 'spola-ovale', 'I', 'EX', '7x11 mm', NULL, NULL, 7, 11, NULL, NULL, '{}'),
  ('42.7.12', 'Spole SA I EXTRA OVALI mm 7x12', 'spole', '42', 'spola-ovale', 'I', 'EX', '7x12 mm', NULL, NULL, 7, 12, NULL, NULL, '{}'),
  ('42.7.14', 'Spole SA I EXTRA OVALI mm 7x14', 'spole', '42', 'spola-ovale', 'I', 'EX', '7x14 mm', NULL, NULL, 7, 14, NULL, NULL, '{}'),
  ('42.8.10', 'Spole SA I EXTRA OVALI mm 8x10', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x10 mm', NULL, NULL, 8, 10, NULL, NULL, '{}'),
  ('42.8.11', 'Spole SA I EXTRA OVALI mm 8x11', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x11 mm', NULL, NULL, 8, 11, NULL, NULL, '{}'),
  ('42.8.12', 'Spole SA I EXTRA OVALI mm 8x12', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x12 mm', NULL, NULL, 8, 12, NULL, NULL, '{}'),
  ('42.8.14', 'Spole SA I EXTRA OVALI mm 8x14', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x14 mm', NULL, NULL, 8, 14, NULL, NULL, '{}'),
  ('42.8.16', 'Spole SA I EXTRA OVALI mm 8x16', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x16 mm', NULL, NULL, 8, 16, NULL, NULL, '{}'),
  ('42.8.18', 'Spole SA I EXTRA OVALI mm 8x18', 'spole', '42', 'spola-ovale', 'I', 'EX', '8x18 mm', NULL, NULL, 8, 18, NULL, NULL, '{}'),
  ('42.9.11', 'Spole SA I EXTRA OVALI mm 9x11', 'spole', '42', 'spola-ovale', 'I', 'EX', '9x11 mm', NULL, NULL, 9, 11, NULL, NULL, '{}'),
  ('42.9.12', 'Spole SA I EXTRA OVALI mm 9x12', 'spole', '42', 'spola-ovale', 'I', 'EX', '9x12 mm', NULL, NULL, 9, 12, NULL, NULL, '{}'),
  ('42.9.13', 'Spole SA I EXTRA OVALI mm 9x13', 'spole', '42', 'spola-ovale', 'I', 'EX', '9x13 mm', NULL, NULL, 9, 13, NULL, NULL, '{}'),
  ('42.9.15', 'Spole SA I EXTRA OVALI mm9x15', 'spole', '42', 'spola-ovale', 'I', 'EX', '9x15 mm', NULL, NULL, 9, 15, NULL, NULL, '{}'),
  ('42.10.12', 'Spole SA I EXTRA OVALI mm 10x12', 'spole', '42', 'spola-ovale', 'I', 'EX', '10x12 mm', NULL, NULL, 10, 12, NULL, NULL, '{}'),
  ('42.10.14', 'Spole SA I EXTRA OVALI mm 10x14', 'spole', '42', 'spola-ovale', 'I', 'EX', '10x14 mm', NULL, NULL, 10, 14, NULL, NULL, '{}'),
  ('42.10.16', 'Spole SA I EXTRA OVALI mm 10x16', 'spole', '42', 'spola-ovale', 'I', 'EX', '10x16 mm', NULL, NULL, 10, 16, NULL, NULL, '{}'),
  ('42.11.15', 'Spole SA I EXTRA OVALI mm 11x15', 'spole', '42', 'spola-ovale', 'I', 'EX', '11x15 mm', NULL, NULL, 11, 15, NULL, NULL, '{}'),
  ('42.12.16', 'Spole SA I EXTRA OVALI mm 12x16', 'spole', '42', 'spola-ovale', 'I', 'EX', '12x16 mm', NULL, NULL, 12, 16, NULL, NULL, '{}'),
  ('42.13.18', 'Spole SA I EXTRA OVALI mm 13x18', 'spole', '42', 'spola-ovale', 'I', 'EX', '13x18 mm', NULL, NULL, 13, 18, NULL, NULL, '{}'),
  ('42.15.20', 'Spole SA I EXTRA OVALI mm 15x20', 'spole', '42', 'spola-ovale', 'I', 'EX', '15x20 mm', NULL, NULL, 15, 20, NULL, NULL, '{}'),
  ('42.16.22', 'Spole SA I EXTRA OVALI mm 16x22', 'spole', '42', 'spola-ovale', 'I', 'EX', '16x22 mm', NULL, NULL, 16, 22, NULL, NULL, '{}'),
  ('42.17.25', 'Spole SA I EXTRA OVALI mm 17x25', 'spole', '42', 'spola-ovale', 'I', 'EX', '17x25 mm', NULL, NULL, 17, 25, NULL, NULL, '{}'),
  ('42.FM.5.6.7', 'Spole SA I EXTRA OVALI mm 5/6/7 f.m.', 'spole', '42', 'spola-ovale', 'I', 'EX', '5/6/7 mm f.m.', 5, 7, NULL, NULL, NULL, NULL, '{FM}'),
  ('42.FM.8.9.10', 'Spole SA I EXTRA OVALI mm 9/10 f.m.', 'spole', '42', 'spola-ovale', 'I', 'EX', '9/10 mm f.m.', 9, 10, NULL, NULL, NULL, NULL, '{FM}'),
  ('42.11.UP', 'Spole SA I EXTRA OVALI mm 11 UP f.m.', 'spole', '42', 'spola-ovale', 'I', 'EX', '11 mm f.m. e oltre', 11, 11, NULL, NULL, NULL, NULL, '{FM,UP}'),
  ('42.21.25', 'Spola SA I EXTRA OVALI mm 21x25', 'spole', '42', 'spola-ovale', 'I', 'EX', '21x25 mm', NULL, NULL, 21, 25, NULL, NULL, '{}'),
  ('42.SET.BUL', 'SET SPOLE BUL', 'spole', '42', 'set-spole', 'I', 'EX', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}'),
  ('43.3.5', 'SPOLE ALTE SA I mm 3x5', 'spole', '43', 'spola-alta', 'I', '', '3x5 mm', NULL, NULL, 3, 5, NULL, NULL, '{}'),
  ('43.4.6', 'SPOLE ALTE SA I mm 4x6', 'spole', '43', 'spola-alta', 'I', '', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('43.5.7', 'SPOLE ALTE SA I mm 5x7', 'spole', '43', 'spola-alta', 'I', '', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{}'),
  ('43.5.10', 'SPOLE ALTE SA I mm 5x10', 'spole', '43', 'spola-alta', 'I', '', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('43.5.15', 'SPOLE ALTE SA I mm 5x15', 'spole', '43', 'spola-alta', 'I', '', '5x15 mm', NULL, NULL, 5, 15, NULL, NULL, '{}'),
  ('43.6.8', 'SPOLE ALTE SA I mm 6X8 + NINO', 'spole', '43', 'spola-alta', 'I', '', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{}'),
  ('43.6.10', 'SPOLE ALTE SA I mm 6X10', 'spole', '43', 'spola-alta', 'I', '', '6x10 mm', NULL, NULL, 6, 10, NULL, NULL, '{}'),
  ('43.6.12', 'SPOLE ALTE SA I mm 6x12', 'spole', '43', 'spola-alta', 'I', '', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('43.6.16', 'SPOLE ALTE SA I mm 6x16', 'spole', '43', 'spola-alta', 'I', '', '6x16 mm', NULL, NULL, 6, 16, NULL, NULL, '{}'),
  ('43.6.18', 'SPOLE ALTE SA I mm 6x18', 'spole', '43', 'spola-alta', 'I', '', '6x18 mm', NULL, NULL, 6, 18, NULL, NULL, '{}'),
  ('43.7.9', 'SPOLE ALTE SA I mm 7x9 + NINO', 'spole', '43', 'spola-alta', 'I', '', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{}'),
  ('43.7.10', 'SPOLE ALTE SA I mm 7x10', 'spole', '43', 'spola-alta', 'I', '', '7x10 mm', NULL, NULL, 7, 10, NULL, NULL, '{}'),
  ('43.7.11', 'SPOLE ALTE SA I mm 7x11', 'spole', '43', 'spola-alta', 'I', '', '7x11 mm', NULL, NULL, 7, 11, NULL, NULL, '{}'),
  ('43.7.12', 'SPOLE ALTE SA I mm 7x12', 'spole', '43', 'spola-alta', 'I', '', '7x12 mm', NULL, NULL, 7, 12, NULL, NULL, '{}'),
  ('43.7.13', 'SPOLE ALTE SA I mm 7x13', 'spole', '43', 'spola-alta', 'I', '', '7x13 mm', NULL, NULL, 7, 13, NULL, NULL, '{}'),
  ('43.7.14', 'SPOLE ALTE SA I mm 7x14', 'spole', '43', 'spola-alta', 'I', '', '7x14 mm', NULL, NULL, 7, 14, NULL, NULL, '{}'),
  ('43.7.16', 'SPOLE ALTE SA I mm 7x16', 'spole', '43', 'spola-alta', 'I', '', '7x16 mm', NULL, NULL, 7, 16, NULL, NULL, '{}'),
  ('43.7.18', 'SPOLE ALTE SA I mm 7x18', 'spole', '43', 'spola-alta', 'I', '', '7x18 mm', NULL, NULL, 7, 18, NULL, NULL, '{}'),
  ('43.7.20', 'SPOLE ALTE SA I mm 7x20', 'spole', '43', 'spola-alta', 'I', '', '7x20 mm', NULL, NULL, 7, 20, NULL, NULL, '{}'),
  ('43.8.10', 'SPOLE ALTE SA I mm 8x10', 'spole', '43', 'spola-alta', 'I', '', '8x10 mm', NULL, NULL, 8, 10, NULL, NULL, '{}'),
  ('43.8.11', 'SPOLE ALTE SA I mm 8x11', 'spole', '43', 'spola-alta', 'I', '', '8x11 mm', NULL, NULL, 8, 11, NULL, NULL, '{}'),
  ('43.8.12', 'SPOLE ALTE SA I mm 8x12', 'spole', '43', 'spola-alta', 'I', '', '8x12 mm', NULL, NULL, 8, 12, NULL, NULL, '{}'),
  ('43.8.13', 'SPOLE ALTE SA I mm 8x13', 'spole', '43', 'spola-alta', 'I', '', '8x13 mm', NULL, NULL, 8, 13, NULL, NULL, '{}'),
  ('43.8.14', 'SPOLE ALTE SA I mm 8x14', 'spole', '43', 'spola-alta', 'I', '', '8x14 mm', NULL, NULL, 8, 14, NULL, NULL, '{}'),
  ('43.8.16', 'SPOLE ALTE SA I mm 8x16', 'spole', '43', 'spola-alta', 'I', '', '8x16 mm', NULL, NULL, 8, 16, NULL, NULL, '{}'),
  ('43.8.17', 'SPOLE ALTE SA I mm 8x17', 'spole', '43', 'spola-alta', 'I', '', '8x17 mm', NULL, NULL, 8, 17, NULL, NULL, '{}'),
  ('43.8.18', 'SPOLE ALTE SA I mm 8x18', 'spole', '43', 'spola-alta', 'I', '', '8x18 mm', NULL, NULL, 8, 18, NULL, NULL, '{}'),
  ('43.9.11', 'SPOLE ALTE SA I mm 9x11', 'spole', '43', 'spola-alta', 'I', '', '9x11 mm', NULL, NULL, 9, 11, NULL, NULL, '{}'),
  ('43.9.12', 'SPOLE ALTE SA I mm 9x12', 'spole', '43', 'spola-alta', 'I', '', '9x12 mm', NULL, NULL, 9, 12, NULL, NULL, '{}'),
  ('43.9.13', 'SPOLE ALTE SA I mm 9x13', 'spole', '43', 'spola-alta', 'I', '', '9x13 mm', NULL, NULL, 9, 13, NULL, NULL, '{}'),
  ('43.9.14', 'SPOLE ALTE SA I mm 9x14', 'spole', '43', 'spola-alta', 'I', '', '9x14 mm', NULL, NULL, 9, 14, NULL, NULL, '{}'),
  ('43.9.15', 'SPOLE ALTE SA I mm 9x15', 'spole', '43', 'spola-alta', 'I', '', '9x15 mm', NULL, NULL, 9, 15, NULL, NULL, '{}'),
  ('43.10.12', 'SPOLE ALTE SA I mm 10x12', 'spole', '43', 'spola-alta', 'I', '', '10x12 mm', NULL, NULL, 10, 12, NULL, NULL, '{}'),
  ('43.10.14', 'SPOLE ALTE SA I mm 10x14', 'spole', '43', 'spola-alta', 'I', '', '10x14 mm', NULL, NULL, 10, 14, NULL, NULL, '{}'),
  ('43.10.16', 'SPOLE ALTE SA I mm 10x16', 'spole', '43', 'spola-alta', 'I', '', '10x16 mm', NULL, NULL, 10, 16, NULL, NULL, '{}'),
  ('43.10.20', 'SPOLE ALTE SA I mm 10x20', 'spole', '43', 'spola-alta', 'I', '', '10x20 mm', NULL, NULL, 10, 20, NULL, NULL, '{}'),
  ('43.11.15', 'SPOLE ALTE SA I mm 11x15', 'spole', '43', 'spola-alta', 'I', '', '11x15 mm', NULL, NULL, 11, 15, NULL, NULL, '{}'),
  ('43.12.14', 'SPOLE ALTE SA I mm 12x14', 'spole', '43', 'spola-alta', 'I', '', '12x14 mm', NULL, NULL, 12, 14, NULL, NULL, '{}'),
  ('43.12.16', 'SPOLE ALTE SA I mm 12x16', 'spole', '43', 'spola-alta', 'I', '', '12x16 mm', NULL, NULL, 12, 16, NULL, NULL, '{}'),
  ('43.13.18', 'SPOLE ALTE SA I mm 13x18', 'spole', '43', 'spola-alta', 'I', '', '13x18 mm', NULL, NULL, 13, 18, NULL, NULL, '{}'),
  ('43.15.20', 'SPOLE ALTE SA I mm 15x20', 'spole', '43', 'spola-alta', 'I', '', '15x20 mm', NULL, NULL, 15, 20, NULL, NULL, '{}'),
  ('43.16.22', 'SPOLE ALTE SA I mm 16x22', 'spole', '43', 'spola-alta', 'I', '', '16x22 mm', NULL, NULL, 16, 22, NULL, NULL, '{}'),
  ('43.FM.5.6.7', 'SPOLE ALTE SA I F/M mm 5/6/7', 'spole', '43', 'spola-alta', 'I', '', '5/6/7 mm f.m.', 5, 7, NULL, NULL, NULL, NULL, '{FM}'),
  ('43.FM.sm', 'SPOLE ALTE SA I F/M mm 8/9/10', 'spole', '43', 'spola-alta', 'I', '', '8/9/10 mm f.m.', 8, 10, NULL, NULL, NULL, NULL, '{FM}'),
  ('43.FM.11UP', 'SPOLE ALTE SA I F/M mm 11UP', 'spole', '43', 'spola-alta', 'I', '', '11 mm f.m. e oltre', 11, 11, NULL, NULL, NULL, NULL, '{FM,UP}'),
  ('43.17.29', 'SPOLA ALTA mm 17X29', 'spole', '43', 'spola-alta', 'I', '', '17x29 mm', NULL, NULL, 17, 29, NULL, NULL, '{}'),
  ('43.205.25', 'SPOLA ALTA mm20,5x25', 'spole', '43', 'spola-alta', 'I', '', '20,5x25 mm', NULL, NULL, 20.5, 25, NULL, NULL, '{}'),
  ('43.225.29', 'SPOLA ALTA mm 22,5x29', 'spole', '43', 'spola-alta', 'I', '', '22,5x29 mm', NULL, NULL, 22.5, 29, NULL, NULL, '{}'),
  ('43.NINOEX.5.7', 'SPOLE ALTE SA NINO mm 5x7 EX', 'spole', '43', 'spola-alta', 'I', 'EX', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{NINO}'),
  ('43.NINOEX.6.8', 'SPOLE ALTE SA NINO mm 6x8 EX', 'spole', '43', 'spola-alta', 'I', 'EX', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{NINO}'),
  ('43.T.4', 'SPOLE ALTE TONDE SA I MM 4', 'spole', '43T', 'spola-alta-tonda', 'I', '', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.4.5', 'SPOLE ALTE TONDE SA I MM 4,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.5', 'SPOLE ALTE TONDE SA I MM 5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.5.5', 'SPOLE ALTE TONDE SA I MM 5,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.6', 'SPOLE ALTE TONDE SA I MM 6', 'spole', '43T', 'spola-alta-tonda', 'I', '', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.6.5', 'SPOLE ALTE TONDE SA I MM 6,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.7', 'SPOLE ALTE TONDE SA I MM 7', 'spole', '43T', 'spola-alta-tonda', 'I', '', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.7.5', 'SPOLE ALTE TONDE SA I MM 7,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.8', 'SPOLE ALTE TONDE SA I MM 8', 'spole', '43T', 'spola-alta-tonda', 'I', '', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.8.5', 'SPOLE ALTE TONDE SA I MM 8,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.9', 'SPOLE ALTE TONDE SA I MM 9', 'spole', '43T', 'spola-alta-tonda', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.9.5', 'SPOLE ALTE TONDE SA I MM 9,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.10', 'SPOLE ALTE TONDE SA I MM 10', 'spole', '43T', 'spola-alta-tonda', 'I', '', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.10.5', 'SPOLE ALTE TONDE SA I MM 10,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '10,5 mm', 10.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.11', 'SPOLE ALTE TONDE SA I MM 11', 'spole', '43T', 'spola-alta-tonda', 'I', '', '11 mm', 11, 11, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.11.5', 'SPOLE ALTE TONDE SA I MM 11,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '11,5 mm', 11.5, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.12', 'SPOLE ALTE TONDE SA I MM 12', 'spole', '43T', 'spola-alta-tonda', 'I', '', '12 mm', 12, 12, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.12.5', 'SPOLE ALTE TONDE SA I MM 12,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '12,5 mm', 12.5, 12.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.13', 'SPOLE ALTE TONDE SA I MM 13', 'spole', '43T', 'spola-alta-tonda', 'I', '', '13 mm', 13, 13, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.13.5', 'SPOLE ALTE TONDE SA I MM 13,5', 'spole', '43T', 'spola-alta-tonda', 'I', '', '13,5 mm', 13.5, 13.5, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.14', 'SPOLE ALTE TONDE SA I MM 14', 'spole', '43T', 'spola-alta-tonda', 'I', '', '14 mm', 14, 14, NULL, NULL, NULL, NULL, '{}'),
  ('43.T.15', 'SPOLE ALTE TONDE SA I MM 15', 'spole', '43T', 'spola-alta-tonda', 'I', '', '15 mm', 15, 15, NULL, NULL, NULL, NULL, '{}'),
  ('43T.16/18', 'SPOLE ALTE TONDE SA I MM 16/18', 'spole', '43T', 'spola-alta-tonda', 'I', '', '16/18 mm', 16, 18, NULL, NULL, NULL, NULL, '{}'),
  ('44.3.5', 'Spole SA II  OVALI mm 3x5', 'spole', '44', 'spola-ovale', 'II', '', '3x5 mm', NULL, NULL, 3, 5, NULL, NULL, '{}'),
  ('44.4.6', 'Spole SA II  OVALI mm 4x6', 'spole', '44', 'spola-ovale', 'II', '', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('44.5.7', 'Spole SA II  OVALI mm 5x7', 'spole', '44', 'spola-ovale', 'II', '', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{}'),
  ('44.5.10', 'Spole SA II  OVALI mm 5x10', 'spole', '44', 'spola-ovale', 'II', '', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('44.5.15', 'Spole SA II  OVALI mm 5x15', 'spole', '44', 'spola-ovale', 'II', '', '5x15 mm', NULL, NULL, 5, 15, NULL, NULL, '{}'),
  ('44.6.8', 'Spole SA II  OVALI mm 6x8', 'spole', '44', 'spola-ovale', 'II', '', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{}'),
  ('44.6.10', 'Spole SA II  OVALI mm 6x10', 'spole', '44', 'spola-ovale', 'II', '', '6x10 mm', NULL, NULL, 6, 10, NULL, NULL, '{}'),
  ('44.6.12', 'Spole SA II  OVALI mm 6x12', 'spole', '44', 'spola-ovale', 'II', '', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('44.6.13', 'Spole SA II  OVALI mm 6x13', 'spole', '44', 'spola-ovale', 'II', '', '6x13 mm', NULL, NULL, 6, 13, NULL, NULL, '{}'),
  ('44.6.14', 'Spole SA II  OVALI mm 6x14', 'spole', '44', 'spola-ovale', 'II', '', '6x14 mm', NULL, NULL, 6, 14, NULL, NULL, '{}'),
  ('44.6.18', 'Spole SA II  OVALI mm 6x18', 'spole', '44', 'spola-ovale', 'II', '', '6x18 mm', NULL, NULL, 6, 18, NULL, NULL, '{}'),
  ('44.7.9', 'Spole SA II  OVALI mm 7x9', 'spole', '44', 'spola-ovale', 'II', '', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{}'),
  ('44.7.10', 'Spole SA II  OVALI mm 7x10', 'spole', '44', 'spola-ovale', 'II', '', '7x10 mm', NULL, NULL, 7, 10, NULL, NULL, '{}'),
  ('44.7.11', 'Spole SA II  OVALI mm 7x11', 'spole', '44', 'spola-ovale', 'II', '', '7x11 mm', NULL, NULL, 7, 11, NULL, NULL, '{}'),
  ('44.7.12', 'Spole SA II  OVALI mm 7x12', 'spole', '44', 'spola-ovale', 'II', '', '7x12 mm', NULL, NULL, 7, 12, NULL, NULL, '{}'),
  ('44.7.14', 'Spole SA II  OVALI mm 7x14', 'spole', '44', 'spola-ovale', 'II', '', '7x14 mm', NULL, NULL, 7, 14, NULL, NULL, '{}'),
  ('44.7.16', 'Spole SA II  OVALI mm 7x16', 'spole', '44', 'spola-ovale', 'II', '', '7x16 mm', NULL, NULL, 7, 16, NULL, NULL, '{}'),
  ('44.7.20', 'Spole SA II  OVALI mm 7x20', 'spole', '44', 'spola-ovale', 'II', '', '7x20 mm', NULL, NULL, 7, 20, NULL, NULL, '{}'),
  ('44.8.10', 'Spole SA II  OVALI mm 8x10', 'spole', '44', 'spola-ovale', 'II', '', '8x10 mm', NULL, NULL, 8, 10, NULL, NULL, '{}'),
  ('44.8.11', 'Spole SA II  OVALI mm 8x11', 'spole', '44', 'spola-ovale', 'II', '', '8x11 mm', NULL, NULL, 8, 11, NULL, NULL, '{}'),
  ('44.8.12', 'Spole SA II  OVALI mm 8x12', 'spole', '44', 'spola-ovale', 'II', '', '8x12 mm', NULL, NULL, 8, 12, NULL, NULL, '{}'),
  ('44.8.14', 'Spole SA II  OVALI mm 8x14', 'spole', '44', 'spola-ovale', 'II', '', '8x14 mm', NULL, NULL, 8, 14, NULL, NULL, '{}'),
  ('44.8.16', 'Spole SA II  OVALI mm 8x16', 'spole', '44', 'spola-ovale', 'II', '', '8x16 mm', NULL, NULL, 8, 16, NULL, NULL, '{}'),
  ('44.8.18', 'Spole SA II  OVALI mm 8x18', 'spole', '44', 'spola-ovale', 'II', '', '8x18 mm', NULL, NULL, 8, 18, NULL, NULL, '{}'),
  ('44.9.11', 'Spole SA II OVALI mm 9x11', 'spole', '44', 'spola-ovale', 'II', '', '9x11 mm', NULL, NULL, 9, 11, NULL, NULL, '{}'),
  ('44.9.12', 'Spole SA II  OVALI mm 9x12', 'spole', '44', 'spola-ovale', 'II', '', '9x12 mm', NULL, NULL, 9, 12, NULL, NULL, '{}'),
  ('44.9.13', 'Spole SA II  OVALI mm 9x13', 'spole', '44', 'spola-ovale', 'II', '', '9x13 mm', NULL, NULL, 9, 13, NULL, NULL, '{}'),
  ('44.9.14', 'Spole SA II  OVALI mm 9x14', 'spole', '44', 'spola-ovale', 'II', '', '9x14 mm', NULL, NULL, 9, 14, NULL, NULL, '{}'),
  ('44.9.15', 'Spole SA II  OVALI mm 9x15', 'spole', '44', 'spola-ovale', 'II', '', '9x15 mm', NULL, NULL, 9, 15, NULL, NULL, '{}'),
  ('44.10.12', 'Spole SA II OVALI mm 10x12', 'spole', '44', 'spola-ovale', 'II', '', '10x12 mm', NULL, NULL, 10, 12, NULL, NULL, '{}'),
  ('44.10.14', 'Spole SA II OVALI mm 10x14', 'spole', '44', 'spola-ovale', 'II', '', '10x14 mm', NULL, NULL, 10, 14, NULL, NULL, '{}'),
  ('44.10.16', 'Spole SA II OVALI mm 10x16', 'spole', '44', 'spola-ovale', 'II', '', '10x16 mm', NULL, NULL, 10, 16, NULL, NULL, '{}'),
  ('44.11.15', 'Spole SA II OVALI mm 11x15', 'spole', '44', 'spola-ovale', 'II', '', '11x15 mm', NULL, NULL, 11, 15, NULL, NULL, '{}'),
  ('44.12.14', 'Spole SA II OVALI mm 12x14', 'spole', '44', 'spola-ovale', 'II', '', '12x14 mm', NULL, NULL, 12, 14, NULL, NULL, '{}'),
  ('44.12.16', 'Spole SA II OVALI mm 12x16', 'spole', '44', 'spola-ovale', 'II', '', '12x16 mm', NULL, NULL, 12, 16, NULL, NULL, '{}'),
  ('44.13.18', 'Spole SA II OVALI mm 13x18', 'spole', '44', 'spola-ovale', 'II', '', '13x18 mm', NULL, NULL, 13, 18, NULL, NULL, '{}'),
  ('44.15.20', 'Spole SA II OVALI mm 15x20', 'spole', '44', 'spola-ovale', 'II', '', '15x20 mm', NULL, NULL, 15, 20, NULL, NULL, '{}'),
  ('44.16.22', 'Spole SA II OVALI mm 16x22', 'spole', '44', 'spola-ovale', 'II', '', '16x22 mm', NULL, NULL, 16, 22, NULL, NULL, '{}'),
  ('44.5.6.7fm', 'Spole SA II OVALI mm 5/6/7 FM', 'spole', '44', 'spola-ovale', 'II', '', '5/6/7 mm f.m.', 5, 7, NULL, NULL, NULL, NULL, '{FM}'),
  ('44.8.10FM', 'Spole SA II OVALI mm 8/10 FM', 'spole', '44', 'spola-ovale', 'II', '', '8/10 mm f.m.', 8, 10, NULL, NULL, NULL, NULL, '{FM}'),
  ('44.11.16 FM', 'Spole SA II OVALI f.misura mm 11-16', 'spole', '44', 'spola-ovale', 'II', '', '11/16 mm f.m.', 11, 16, NULL, NULL, NULL, NULL, '{FM}'),
  ('44.NINO.68', 'Spole SA II  OVALI mm 6x8', 'spole', '44', 'spola-ovale', 'II', '', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{NINO}'),
  ('44.NINO.79', 'Spole SA II  OVALI mm 7x9', 'spole', '44', 'spola-ovale', 'II', '', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{NINO}'),
  ('44.20.28', 'Spole SA II  OVALI mm 20x28', 'spole', '44', 'spola-ovale', 'II', '', '20x28 mm', NULL, NULL, 20, 28, NULL, NULL, '{}'),
  ('45.4.6', 'Spole SA II EXTRA OVALI mm 4x6', 'spole', '45', 'spola-ovale', 'II', 'EX', '4x6 mm', NULL, NULL, 4, 6, NULL, NULL, '{}'),
  ('45.5.7', 'Spole SA II EXTRA OVALI mm 5x7', 'spole', '45', 'spola-ovale', 'II', 'EX', '5x7 mm', NULL, NULL, 5, 7, NULL, NULL, '{}'),
  ('45.5.10', 'Spole SA II EXTRA OVALI mm 5x10', 'spole', '45', 'spola-ovale', 'II', 'EX', '5x10 mm', NULL, NULL, 5, 10, NULL, NULL, '{}'),
  ('45.5.15', 'Spole SA II EXTRA OVALI mm 5x15', 'spole', '45', 'spola-ovale', 'II', 'EX', '5x15 mm', NULL, NULL, 5, 15, NULL, NULL, '{}'),
  ('45.6.8', 'Spole SA II EXTRA OVALI mm 6x8', 'spole', '45', 'spola-ovale', 'II', 'EX', '6x8 mm', NULL, NULL, 6, 8, NULL, NULL, '{}'),
  ('45.6.10', 'Spole SA II EXTRA OVALI mm 6x10', 'spole', '45', 'spola-ovale', 'II', 'EX', '6x10 mm', NULL, NULL, 6, 10, NULL, NULL, '{}'),
  ('45.6.12', 'Spole SA II EXTRA OVALI mm 6x12', 'spole', '45', 'spola-ovale', 'II', 'EX', '6x12 mm', NULL, NULL, 6, 12, NULL, NULL, '{}'),
  ('45.6.13', 'Spole SA II EXTRA OVALI mm 6x13', 'spole', '45', 'spola-ovale', 'II', 'EX', '6x13 mm', NULL, NULL, 6, 13, NULL, NULL, '{}'),
  ('45.6.14', 'Spole SA II EXTRA OVALI mm 6x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '6x14 mm', NULL, NULL, 6, 14, NULL, NULL, '{}'),
  ('45.7.9', 'Spole SA II EXTRA OVALI mm 7x9', 'spole', '45', 'spola-ovale', 'II', 'EX', '7x9 mm', NULL, NULL, 7, 9, NULL, NULL, '{}'),
  ('45.7.10', 'Spole SA II EXTRA OVALI mm 7x10', 'spole', '45', 'spola-ovale', 'II', 'EX', '7x10 mm', NULL, NULL, 7, 10, NULL, NULL, '{}'),
  ('45.7.11', 'Spole SA II EXTRA OVALI mm 7x11', 'spole', '45', 'spola-ovale', 'II', 'EX', '7x11 mm', NULL, NULL, 7, 11, NULL, NULL, '{}'),
  ('45.7.12', 'Spole SA II EXTRA OVALI mm 7x12', 'spole', '45', 'spola-ovale', 'II', 'EX', '7x12 mm', NULL, NULL, 7, 12, NULL, NULL, '{}'),
  ('45.7.14', 'Spole SA II EXTRA OVALI mm 7x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '7x14 mm', NULL, NULL, 7, 14, NULL, NULL, '{}'),
  ('45.8.10', 'Spole SA II EXTRA OVALI mm 8x10', 'spole', '45', 'spola-ovale', 'II', 'EX', '8x10 mm', NULL, NULL, 8, 10, NULL, NULL, '{}'),
  ('45.8.12', 'Spole SA II EXTRA OVALI mm 8x12', 'spole', '45', 'spola-ovale', 'II', 'EX', '8x12 mm', NULL, NULL, 8, 12, NULL, NULL, '{}'),
  ('45.8.14', 'Spole SA II EXTRA OVALI mm 8x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '8x14 mm', NULL, NULL, 8, 14, NULL, NULL, '{}'),
  ('45.8.16', 'Spole SA II EXTRA OVALI mm 8x16', 'spole', '45', 'spola-ovale', 'II', 'EX', '8x16 mm', NULL, NULL, 8, 16, NULL, NULL, '{}'),
  ('45.9.11', 'Spole SA II EXTRA OVALI mm 9x11', 'spole', '45', 'spola-ovale', 'II', 'EX', '9x11 mm', NULL, NULL, 9, 11, NULL, NULL, '{}'),
  ('45.9.12', 'Spole SA II EXTRA OVALI mm 9x12', 'spole', '45', 'spola-ovale', 'II', 'EX', '9x12 mm', NULL, NULL, 9, 12, NULL, NULL, '{}'),
  ('45.9.13', 'Spole SA II EXTRA OVALI mm 9x13', 'spole', '45', 'spola-ovale', 'II', 'EX', '9x13 mm', NULL, NULL, 9, 13, NULL, NULL, '{}'),
  ('45.9.14', 'Spole SA II EXTRA OVALI mm 9x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '9x14 mm', NULL, NULL, 9, 14, NULL, NULL, '{}'),
  ('45.9.15', 'Spole SA II EXTRA OVALI mm 9x15', 'spole', '45', 'spola-ovale', 'II', 'EX', '9x15 mm', NULL, NULL, 9, 15, NULL, NULL, '{}'),
  ('45.10.12', 'Spole SA II EXTRA OVALI mm 10x12', 'spole', '45', 'spola-ovale', 'II', 'EX', '10x12 mm', NULL, NULL, 10, 12, NULL, NULL, '{}'),
  ('45.10.14', 'Spole SA II EXTRA OVALI mm 10x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '10x14 mm', NULL, NULL, 10, 14, NULL, NULL, '{}'),
  ('45.11.15', 'Spole SA II EXTRA OVALI mm11x15', 'spole', '45', 'spola-ovale', 'II', 'EX', '11x15 mm', NULL, NULL, 11, 15, NULL, NULL, '{}'),
  ('45.12.14', 'Spole SA II EXTRA OVALI  mm 12x14', 'spole', '45', 'spola-ovale', 'II', 'EX', '12x14 mm', NULL, NULL, 12, 14, NULL, NULL, '{}'),
  ('45.12.16', 'Spole SA II EXTRA OVALI  mm 12x16', 'spole', '45', 'spola-ovale', 'II', 'EX', '12x16 mm', NULL, NULL, 12, 16, NULL, NULL, '{}'),
  ('45.13.18', 'Spole SA II EXTRA OVALI  mm 13x18', 'spole', '45', 'spola-ovale', 'II', 'EX', '13x18 mm', NULL, NULL, 13, 18, NULL, NULL, '{}'),
  ('45.15.20', 'Spole SA II EXTRA OVALI  mm 15x20', 'spole', '45', 'spola-ovale', 'II', 'EX', '15x20 mm', NULL, NULL, 15, 20, NULL, NULL, '{}'),
  ('45/FM8-10', 'Spole SA II EXTRA OVALI fuori misura mm 8-10', 'spole', '45', 'spola-ovale', 'II', 'EX', '8/10 mm f.m.', 8, 10, NULL, NULL, NULL, NULL, '{FM}'),
  ('45/FM 11.UP', 'Spole SA II EXTRA OVALI fuori misura mm 11 UP', 'spole', '45', 'spola-ovale', 'II', 'EX', '11 mm f.m. e oltre', 11, 11, NULL, NULL, NULL, NULL, '{FM,UP}'),
  ('46.3', 'Spole tonde SA I mm3', 'spole', '46', 'spola-tonda', 'I', '', '3 mm', 3, 3, NULL, NULL, NULL, NULL, '{}'),
  ('46.4', 'Spole tonde SA I mm 4', 'spole', '46', 'spola-tonda', 'I', '', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('46.4.5', 'Spole tonde SA I mm 4,5', 'spole', '46', 'spola-tonda', 'I', '', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.5', 'Spole tonde SA I mm5', 'spole', '46', 'spola-tonda', 'I', '', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('46.5.5', 'Spole tonde SA I mm5,5', 'spole', '46', 'spola-tonda', 'I', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.6', 'Spole tonde SA I mm6', 'spole', '46', 'spola-tonda', 'I', '', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('46.6.50', 'Spole tonde SA I mm6,5', 'spole', '46', 'spola-tonda', 'I', '', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.7', 'Spole tonde SA I mm7', 'spole', '46', 'spola-tonda', 'I', '', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('46.7.5', 'Spole tonde SA I mm 7,5', 'spole', '46', 'spola-tonda', 'I', '', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.8', 'Spole tonde SA I mm8', 'spole', '46', 'spola-tonda', 'I', '', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('46.8.5', 'Spole tonde SA I mm8,5', 'spole', '46', 'spola-tonda', 'I', '', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.9', 'Spole tonde SA I mm9', 'spole', '46', 'spola-tonda', 'I', '', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('46.9.5', 'Spole tonde SA I mm9,5', 'spole', '46', 'spola-tonda', 'I', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.10', 'Spole tonde SA I mm10', 'spole', '46', 'spola-tonda', 'I', '', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('46.10.5', 'Spole tonde SA I mm10,5', 'spole', '46', 'spola-tonda', 'I', '', '10,5 mm', 10.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.11', 'Spole tonde SA I mm11', 'spole', '46', 'spola-tonda', 'I', '', '11 mm', 11, 11, NULL, NULL, NULL, NULL, '{}'),
  ('46.11.5', 'Spole tonde SA I mm11,5', 'spole', '46', 'spola-tonda', 'I', '', '11,5 mm', 11.5, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.12', 'Spole tonde SA I mm12', 'spole', '46', 'spola-tonda', 'I', '', '12 mm', 12, 12, NULL, NULL, NULL, NULL, '{}'),
  ('46.12.5', 'Spole tonde SA I mm12,5', 'spole', '46', 'spola-tonda', 'I', '', '12,5 mm', 12.5, 12.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.13', 'Spole tonde SA I mm13', 'spole', '46', 'spola-tonda', 'I', '', '13 mm', 13, 13, NULL, NULL, NULL, NULL, '{}'),
  ('46.13.5', 'Spole tonde SA I mm13,5', 'spole', '46', 'spola-tonda', 'I', '', '13,5 mm', 13.5, 13.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.14', 'Spole tonde SA I mm14', 'spole', '46', 'spola-tonda', 'I', '', '14 mm', 14, 14, NULL, NULL, NULL, NULL, '{}'),
  ('46.14.50', 'Spole tonde SA I mm14,5', 'spole', '46', 'spola-tonda', 'I', '', '14,5 mm', 14.5, 14.5, NULL, NULL, NULL, NULL, '{}'),
  ('46.15.19', 'Spole tonde SA I mm15 / 19', 'spole', '46', 'spola-tonda', 'I', '', '15/19 mm', 15, 19, NULL, NULL, NULL, NULL, '{}'),
  ('46.PERLè.10', 'Spole Perlè mm 10', 'spole', '46', 'spola-perle', 'I', '', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('47.4', 'Spole tonde SA I EX mm 4', 'spole', '47', 'spola-tonda', 'I', 'EX', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('47.4.5', 'Spole tonde SA I EX mm 4,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '4,5 mm', 4.5, 4.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.5', 'Spole tonde SA I EX mm 5', 'spole', '47', 'spola-tonda', 'I', 'EX', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('47.6', 'Spole tonde SA I EX mm 6', 'spole', '47', 'spola-tonda', 'I', 'EX', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('47.6.5', 'Spole tonde SA I EX mm 6,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.7', 'Spole tonde SA I EX mm 7', 'spole', '47', 'spola-tonda', 'I', 'EX', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('47.7.5', 'Spole tonde SA I EX mm 7,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.8', 'Spole tonde SA I EX mm 8', 'spole', '47', 'spola-tonda', 'I', 'EX', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('47.8.50', 'Spole tonde SA I EX mm 8,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.9', 'Spole tonde SA I EX mm 9', 'spole', '47', 'spola-tonda', 'I', 'EX', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('47.10', 'Spole tonde SA I EX mm 10', 'spole', '47', 'spola-tonda', 'I', 'EX', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('47.10.50', 'Spole tonde SA I EX mm 10,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '10,5 mm', 10.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.11', 'Spole tonde SA I EX mm 11', 'spole', '47', 'spola-tonda', 'I', 'EX', '11 mm', 11, 11, NULL, NULL, NULL, NULL, '{}'),
  ('47.11.50', 'Spole tonde SA I EX mm 11,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '11,5 mm', 11.5, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.12', 'Spole tonde SA I EX mm 12', 'spole', '47', 'spola-tonda', 'I', 'EX', '12 mm', 12, 12, NULL, NULL, NULL, NULL, '{}'),
  ('47.12.50', 'Spole tonde SA I EX mm 12,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '12,5 mm', 12.5, 12.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.13', 'Spole tonde SA I EX mm 13', 'spole', '47', 'spola-tonda', 'I', 'EX', '13 mm', 13, 13, NULL, NULL, NULL, NULL, '{}'),
  ('47.13.50', 'Spole tonde SA I EX mm 13,5', 'spole', '47', 'spola-tonda', 'I', 'EX', '13,5 mm', 13.5, 13.5, NULL, NULL, NULL, NULL, '{}'),
  ('47.14.up', 'Spole tonde SA I EX mm 14/15/16(1)', 'spole', '47', 'spola-tonda', 'I', 'EX', '14/15/16 mm e oltre', 14, 16, NULL, NULL, NULL, NULL, '{UP}'),
  ('48.3.50', 'spole tonde SA II mm 3,50', 'spole', '48', 'spola-tonda', 'II', '', '3,5 mm', 3.5, 3.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.4', 'spole tonde SA II mm 4', 'spole', '48', 'spola-tonda', 'II', '', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('48.5', 'spole tonde SA II mm 5', 'spole', '48', 'spola-tonda', 'II', '', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('48.5.50', 'spole tonde SA II mm 5,5', 'spole', '48', 'spola-tonda', 'II', '', '5,5 mm', 5.5, 5.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.6', 'spole tonde SA II mm 6', 'spole', '48', 'spola-tonda', 'II', '', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('48.6.50', 'spole tonde SA II mm 6,5', 'spole', '48', 'spola-tonda', 'II', '', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.7', 'spole tonde SA II mm 7', 'spole', '48', 'spola-tonda', 'II', '', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('48.7.50', 'spole tonde SA II mm 7,5', 'spole', '48', 'spola-tonda', 'II', '', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.8', 'spole tonde SA II mm 8', 'spole', '48', 'spola-tonda', 'II', '', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('48.8.50', 'spole tonde SA II mm 8,5', 'spole', '48', 'spola-tonda', 'II', '', '8,5 mm', 8.5, 8.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.9', 'spole tonde SA II mm 9', 'spole', '48', 'spola-tonda', 'II', '', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('48.9.50', 'spole tonde SA II mm 9,5', 'spole', '48', 'spola-tonda', 'II', '', '9,5 mm', 9.5, 9.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.10', 'spole tonde SA II mm 10', 'spole', '48', 'spola-tonda', 'II', '', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('48.10.50', 'spole tonde SA II mm 10,5', 'spole', '48', 'spola-tonda', 'II', '', '10,5 mm', 10.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.11', 'spole tonde SA II mm 11', 'spole', '48', 'spola-tonda', 'II', '', '11 mm', 11, 11, NULL, NULL, NULL, NULL, '{}'),
  ('48.11.5', 'spole tonde SA II mm 11,5', 'spole', '48', 'spola-tonda', 'II', '', '11,5 mm', 11.5, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.12', 'spole tonde SA II mm 12', 'spole', '48', 'spola-tonda', 'II', '', '12 mm', 12, 12, NULL, NULL, NULL, NULL, '{}'),
  ('48.12.5', 'spole tonde SA II mm 12,5', 'spole', '48', 'spola-tonda', 'II', '', '12,5 mm', 12.5, 12.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.13', 'spole tonde SA II mm 13', 'spole', '48', 'spola-tonda', 'II', '', '13 mm', 13, 13, NULL, NULL, NULL, NULL, '{}'),
  ('48.13.50', 'spole tonde SA II mm 13,5', 'spole', '48', 'spola-tonda', 'II', '', '13,5 mm', 13.5, 13.5, NULL, NULL, NULL, NULL, '{}'),
  ('48.14Up', 'spole tonde SA II mm 14Up', 'spole', '48', 'spola-tonda', 'II', '', '14 mm e oltre', 14, 14, NULL, NULL, NULL, NULL, '{UP}'),
  ('49.4', 'Spole tonde SA II Extra mm 4', 'spole', '49', 'spola-tonda', 'II', 'EX', '4 mm', 4, 4, NULL, NULL, NULL, NULL, '{}'),
  ('49.5', 'Spole tonde SA II Extra mm 5', 'spole', '49', 'spola-tonda', 'II', 'EX', '5 mm', 5, 5, NULL, NULL, NULL, NULL, '{}'),
  ('49.6', 'Spole tonde SA II Extra mm 6', 'spole', '49', 'spola-tonda', 'II', 'EX', '6 mm', 6, 6, NULL, NULL, NULL, NULL, '{}'),
  ('49.6.50', 'Spole tonde SA II Extra mm 6,5', 'spole', '49', 'spola-tonda', 'II', 'EX', '6,5 mm', 6.5, 6.5, NULL, NULL, NULL, NULL, '{}'),
  ('49.7', 'Spole tonde SA II Extra mm 7', 'spole', '49', 'spola-tonda', 'II', 'EX', '7 mm', 7, 7, NULL, NULL, NULL, NULL, '{}'),
  ('49.7.50', 'Spole tonde SA II Extra mm 7,5', 'spole', '49', 'spola-tonda', 'II', 'EX', '7,5 mm', 7.5, 7.5, NULL, NULL, NULL, NULL, '{}'),
  ('49.8', 'Spole tonde SA II Extra mm 8', 'spole', '49', 'spola-tonda', 'II', 'EX', '8 mm', 8, 8, NULL, NULL, NULL, NULL, '{}'),
  ('49.9', 'Spole tonde SA II Extra mm 9', 'spole', '49', 'spola-tonda', 'II', 'EX', '9 mm', 9, 9, NULL, NULL, NULL, NULL, '{}'),
  ('49.10', 'Spole tonde SA II Extra mm 10', 'spole', '49', 'spola-tonda', 'II', 'EX', '10 mm', 10, 10, NULL, NULL, NULL, NULL, '{}'),
  ('49.10.50', 'Spole tonde SA II Extra mm 10,5', 'spole', '49', 'spola-tonda', 'II', 'EX', '10,5 mm', 10.5, 10.5, NULL, NULL, NULL, NULL, '{}'),
  ('49.11', 'Spole tonde SA II Extra mm 11', 'spole', '49', 'spola-tonda', 'II', 'EX', '11 mm', 11, 11, NULL, NULL, NULL, NULL, '{}'),
  ('49.11.50', 'Spole tonde SA II Extra mm 11,5', 'spole', '49', 'spola-tonda', 'II', 'EX', '11,5 mm', 11.5, 11.5, NULL, NULL, NULL, NULL, '{}'),
  ('49.12', 'Spole tonde SA II Extra mm 12', 'spole', '49', 'spola-tonda', 'II', 'EX', '12 mm', 12, 12, NULL, NULL, NULL, NULL, '{}'),
  ('49.13', 'Spole tonde SA II Extra mm 13', 'spole', '49', 'spola-tonda', 'II', 'EX', '13 mm', 13, 13, NULL, NULL, NULL, NULL, '{}'),
  ('49.13.50', 'Spole tonde SA II Extra mm 13,5', 'spole', '49', 'spola-tonda', 'II', 'EX', '13,5 mm', 13.5, 13.5, NULL, NULL, NULL, NULL, '{}'),
  ('49.14Up', 'Spole tonde SA II Extra mm 14 Up', 'spole', '49', 'spola-tonda', 'II', 'EX', '14 mm e oltre', 14, 14, NULL, NULL, NULL, NULL, '{UP}')
) AS v(sku, description, cat_slug, group_code, shape_slug, quality, finish, size,
       size_from_mm, size_to_mm, width_mm, length_mm, height_mm, length_cm, variants)
JOIN raw_categories c ON c.slug = v.cat_slug
JOIN raw_shapes s ON s.slug = v.shape_slug
WHERE NOT EXISTS (SELECT 1 FROM raw_items r WHERE r.sku = v.sku);

COMMIT;

-- ------------------------------------------------------------
-- 021_spole_base_altezza.sql
-- ------------------------------------------------------------
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
