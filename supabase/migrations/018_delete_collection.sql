-- ============================================================
-- 018_delete_collection.sql — Eliminazione definitiva di una collezione (solo admin)
-- Prima si eliminano tutti i suoi articoli (con foto, materiali e movimenti),
-- poi la collezione. Lo storico (audit_log) conserva i dati degli articoli eliminati.
-- ============================================================

BEGIN;

-- SECURITY DEFINER: elimina anche eventuali articoli nascosti (deleted_at), che le
-- regole di lettura non mostrano e che altrimenti bloccherebbero la cancellazione.
-- Per questo il controllo del ruolo è fatto qui dentro.
CREATE FUNCTION delete_collection(p_collection_id uuid)
RETURNS text[] AS $$
DECLARE
  v_paths text[];
BEGIN
  -- get_user_role() è NULL senza utente: IS DISTINCT FROM blocca anche quel caso
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un amministratore può eliminare una collezione';
  END IF;

  WITH deleted AS (
    DELETE FROM photos
    WHERE article_id IN (SELECT id FROM articles WHERE collection_id = p_collection_id)
    RETURNING storage_path
  )
  SELECT array_agg(storage_path) INTO v_paths FROM deleted;

  DELETE FROM stock_movements
  WHERE article_id IN (SELECT id FROM articles WHERE collection_id = p_collection_id);

  -- I materiali (article_materials) si cancellano in cascata
  DELETE FROM articles WHERE collection_id = p_collection_id;

  DELETE FROM collections WHERE id = p_collection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collezione non trovata';
  END IF;

  RETURN COALESCE(v_paths, '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
