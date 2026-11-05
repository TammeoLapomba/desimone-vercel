-- ============================================================
-- 92_foto_indirizzo_relativo.sql — Le foto della sede si vedono da tutti i dispositivi
--
-- Solo nella sede (dopo le migrazioni di supabase/migrations). L'app salvava l'indirizzo pieno della foto, con il
-- dispositivo che l'aveva caricata: "http://localhost:8080/foto/…" dal PC server. Sul tablet "localhost" è il tablet
-- stesso, e la foto non si vedeva. Da questa versione js/sede-client.js salva "/foto/…"; qui si correggono le foto
-- già caricate, da qualunque indirizzo (localhost, 192.168.…, http o https).
-- Cambia solo l'indirizzo, non la foto: i trigger (storico, updated_at) non scattano.
-- ============================================================

BEGIN;

SET LOCAL session_replication_role = replica;

UPDATE photos SET public_url = regexp_replace(public_url, '^https?://[^/]+(/foto/)', '\1')
  WHERE public_url ~ '^https?://[^/]+/foto/';
UPDATE raw_photos SET public_url = regexp_replace(public_url, '^https?://[^/]+(/foto/)', '\1')
  WHERE public_url ~ '^https?://[^/]+/foto/';
UPDATE raw_items SET cover_url = regexp_replace(cover_url, '^https?://[^/]+(/foto/)', '\1')
  WHERE cover_url ~ '^https?://[^/]+/foto/';

COMMIT;
