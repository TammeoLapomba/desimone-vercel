SELECT collection_id, sum(stock_retail * price_retail) FROM articles WHERE status = 'attivo' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
