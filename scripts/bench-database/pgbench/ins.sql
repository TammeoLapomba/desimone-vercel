\set i random(1, 2000000000)
INSERT INTO articles(sku, name, product_type, collection_id, status, price_retail, description_it) VALUES ('NW' || :client_id || '-' || :i || '-' || substr(md5(random()::text),1,8), 'Anello corallo rosso goccia oro giallo 18kt mod. N' || :i, 'Anello', 7, 'bozza', 250, 'Nuovo articolo');
