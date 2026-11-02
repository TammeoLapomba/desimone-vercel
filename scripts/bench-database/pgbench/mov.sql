\set i random(1, :N)
SELECT m.* FROM stock_movements m JOIN articles a ON a.id = m.article_id WHERE a.sku = 'DS'||lpad(:i::text,12,'0') ORDER BY m.created_at DESC LIMIT 20;
