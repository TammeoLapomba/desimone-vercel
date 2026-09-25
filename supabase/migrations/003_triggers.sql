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
