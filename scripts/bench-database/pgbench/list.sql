\set o random(0, 20)
SELECT sku, name, price_retail, stock_retail FROM articles WHERE status = 'attivo' AND product_type = 'Anello' ORDER BY updated_at DESC LIMIT 50 OFFSET :o * 50;
