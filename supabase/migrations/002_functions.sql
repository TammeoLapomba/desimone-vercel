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
