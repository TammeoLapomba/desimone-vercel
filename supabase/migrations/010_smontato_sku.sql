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
