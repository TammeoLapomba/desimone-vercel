-- Una pagina da 1000 righe della giacenza di tutti gli articoli in tutti i luoghi (getStockOverview, schermata
-- Giacenze): ogni pagina ricalcola la vista stock_levels, che somma tutto il registro
\set p random(0, :PAGINE - 1)
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT article_id, raw_item_id, location_id, pieces, grams FROM stock_levels
  ORDER BY article_id, raw_item_id, location_id LIMIT 1000 OFFSET :p * 1000) t;
END;
