-- Tutta la giacenza in una sola richiesta, invece di getStockOverview a pagine: l'alternativa da confrontare
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT article_id, raw_item_id, location_id, pieces, grams FROM stock_levels
  ORDER BY article_id, raw_item_id, location_id) t;
END;
