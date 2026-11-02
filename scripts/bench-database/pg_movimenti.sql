-- Porta i movimenti a 100 per articolo (pg_gen.sql ne crea 3): anni di uso al volume reale.
-- uso: psql -d a10k -f pg_movimenti.sql   (dopo pg_gen.sql con N=10000 → 1 milione di movimenti)
INSERT INTO stock_movements(article_id, channel, delta, reason, created_at)
SELECT a.id, 'negozio', -1, 'vendita', a.created_at + k * interval '7 days'
FROM articles a, generate_series(4, 100) k;
VACUUM ANALYZE;
SELECT count(*) AS movimenti, pg_size_pretty(pg_database_size(current_database())) AS dimensione FROM stock_movements;
