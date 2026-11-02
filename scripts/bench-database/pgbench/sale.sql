\set i random(1, :N)
BEGIN;
UPDATE articles SET stock_retail = stock_retail - 1, updated_at = now() WHERE sku = 'DS'||lpad(:i::text,12,'0');
INSERT INTO stock_movements(article_id, channel, delta, reason) SELECT id, 'negozio', -1, 'vendita' FROM articles WHERE sku = 'DS'||lpad(:i::text,12,'0');
END;
