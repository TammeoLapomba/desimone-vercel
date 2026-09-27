-- ============================================================
-- 017_article_status_empty.sql — Stato articolo vuoto per ora
-- Il campo status resta (con i suoi valori possibili) ma è facoltativo,
-- senza valore predefinito e vuoto per tutti: il suo uso si deciderà più avanti.
-- ============================================================

BEGIN;

ALTER TABLE articles ALTER COLUMN status DROP NOT NULL;
ALTER TABLE articles ALTER COLUMN status DROP DEFAULT;
UPDATE articles SET status = NULL WHERE status IS NOT NULL;

COMMIT;
