-- ============================================================
-- pulizia_catalogo.sql — Svuota il catalogo "montato"
-- Elimina TUTTI gli articoli e le collezioni, con le loro foto (righe), materiali,
-- movimenti di magazzino e storico modifiche degli articoli.
-- Non tocca: anagrafiche (tipi, materiali, metalli), catalogo semilavorato, utenti.
-- I file nello Storage restano: si eliminano da Dashboard → Storage → photos.
-- ============================================================

BEGIN;
DELETE FROM article_materials;
DELETE FROM photos;
DELETE FROM stock_movements;
DELETE FROM audit_log WHERE table_name IN ('articles', 'article_materials');
DELETE FROM articles;
DELETE FROM collections;
COMMIT;

SELECT
  (SELECT count(*) FROM articles)    AS articoli_rimasti,
  (SELECT count(*) FROM collections) AS collezioni_rimaste;
