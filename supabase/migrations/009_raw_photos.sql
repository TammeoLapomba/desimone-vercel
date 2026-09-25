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
