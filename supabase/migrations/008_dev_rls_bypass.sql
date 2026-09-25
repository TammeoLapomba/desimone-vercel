-- ============================================================
-- 008_dev_rls_bypass.sql — SOLO SVILUPPO
-- Disabilita RLS per permettere operazioni senza autenticazione
-- ============================================================
-- ⚠️ NON eseguire in produzione.
-- Per riabilitare la sicurezza in produzione, eseguire:
--   ALTER TABLE collections      ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE materials        ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE articles         ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE photos           ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE stock_movements  ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE raw_categories   ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE raw_items        ENABLE ROW LEVEL SECURITY;
-- ============================================================

ALTER TABLE collections      DISABLE ROW LEVEL SECURITY;
ALTER TABLE materials        DISABLE ROW LEVEL SECURITY;
ALTER TABLE articles         DISABLE ROW LEVEL SECURITY;
ALTER TABLE photos           DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        DISABLE ROW LEVEL SECURITY;
ALTER TABLE raw_categories   DISABLE ROW LEVEL SECURITY;
ALTER TABLE raw_items        DISABLE ROW LEVEL SECURITY;
ALTER TABLE raw_photos       DISABLE ROW LEVEL SECURITY;
