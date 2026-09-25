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
