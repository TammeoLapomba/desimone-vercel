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
