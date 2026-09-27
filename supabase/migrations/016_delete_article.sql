-- ============================================================
-- 016_delete_article.sql — Eliminazione definitiva di un articolo (solo admin)
-- Si cancellano articolo, foto, materiali e movimenti di magazzino.
-- Lo storico (audit_log) conserva i dati dell'articolo eliminato.
-- ============================================================

BEGIN;

CREATE POLICY "articles_hard_delete" ON articles FOR DELETE USING (get_user_role() = 'admin');
CREATE POLICY "photos_delete" ON photos FOR DELETE USING (get_user_role() = 'admin');
CREATE POLICY "stock_delete" ON stock_movements FOR DELETE USING (get_user_role() = 'admin');

-- File delle foto nello Storage
CREATE POLICY "photos_admin_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'photos' AND
  public.get_user_role() = 'admin'
);

-- Lo storico registra anche l'eliminazione, con i dati che l'articolo aveva
DROP TRIGGER articles_audit ON articles;
CREATE TRIGGER articles_audit
  AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION log_audit();

-- Tutto in un'unica operazione: se qualcosa fallisce non si cancella nulla.
-- Restituisce i percorsi dei file foto, che il frontend toglie dallo Storage.
CREATE FUNCTION delete_article(p_article_id uuid)
RETURNS text[] AS $$
DECLARE
  v_paths text[];
BEGIN
  -- get_user_role() è NULL senza utente: IS DISTINCT FROM blocca anche quel caso
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un amministratore può eliminare un articolo';
  END IF;

  WITH deleted AS (
    DELETE FROM photos WHERE article_id = p_article_id RETURNING storage_path
  )
  SELECT array_agg(storage_path) INTO v_paths FROM deleted;

  DELETE FROM stock_movements WHERE article_id = p_article_id;

  -- I materiali (article_materials) si cancellano in cascata
  DELETE FROM articles WHERE id = p_article_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Articolo non trovato';
  END IF;

  RETURN COALESCE(v_paths, '{}');
END;
$$ LANGUAGE plpgsql;

COMMIT;
