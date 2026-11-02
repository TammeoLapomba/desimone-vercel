-- Tutti i gioielli con collezione, tipo e materiali, all'apertura di Movimenti (getMovableItems):
-- la stessa forma della richiesta che PostgREST costruisce per le risorse incorporate
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT a.id, a.sku, a.name, a.collection_id, row_to_json(c.*) AS collections, row_to_json(p.*) AS product_type,
         coalesce(am.v, '[]') AS article_materials
  FROM articles a
  LEFT JOIN LATERAL (SELECT name FROM collections WHERE id = a.collection_id) c ON true
  LEFT JOIN LATERAL (SELECT name FROM product_types WHERE id = a.product_type_id) p ON true
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('material', row_to_json(m.*))) AS v
                     FROM article_materials x LEFT JOIN LATERAL (SELECT name FROM materials WHERE id = x.material_id) m ON true
                     WHERE x.article_id = a.id) am ON true
  WHERE a.deleted_at IS NULL) t;
END;
