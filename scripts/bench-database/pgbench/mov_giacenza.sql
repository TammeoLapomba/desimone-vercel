-- Giacenza di un gioiello in ogni luogo (getItemStock), con ruolo e token come in PostgREST
\set i random(1, :N)
SELECT id AS art FROM bench.articoli WHERE i = :i \gset
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT coalesce(json_agg(t), '[]') FROM (SELECT location_id, pieces, grams FROM stock_levels WHERE article_id = :art) t;
END;
