\set i random(1, :N)
SELECT sku, name FROM articles WHERE name ILIKE '%' || upper(substr(md5(:i::text),1,6)) || '%' LIMIT 50;
