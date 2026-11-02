SELECT sku, name, price_retail FROM articles WHERE name ILIKE '%corallo rosa%' AND name ILIKE '%goccia%' AND status = 'attivo' ORDER BY updated_at DESC LIMIT 50;
