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
