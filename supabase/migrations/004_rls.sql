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
