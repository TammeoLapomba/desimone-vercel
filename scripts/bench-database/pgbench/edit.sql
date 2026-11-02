\set i random(1, :N)
UPDATE articles SET name = name, description_it = 'Descrizione corretta ' || :i, price_retail = price_retail + 1, updated_at = now() WHERE sku = 'DS'||lpad(:i::text,12,'0');
