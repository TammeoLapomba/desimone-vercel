\set i random(1, :N)
SELECT id, sku, name, price_retail, stock_retail FROM articles WHERE sku = 'DS'||lpad(:i::text,12,'0');
