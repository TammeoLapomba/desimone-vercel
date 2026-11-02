-- Trasferimento di un pezzo dal laboratorio al negozio con register_movement
\set i random(1, :N)
SELECT id AS art FROM bench.articoli WHERE i = :i \gset
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT register_movement(p_code => 'B-' || gen_random_uuid(), p_movement_type => 'T', p_reason_id => c.trasf,
  p_device_id => c.dispositivo, p_occurred_at => now(), p_article_id => :art, p_from_location_id => c.lab,
  p_to_location_id => c.shop, p_pieces => 1,
  p_shown_stock => '{"from": {"pieces_before": 900, "pieces_after": 899}, "to": {"pieces_before": 50, "pieces_after": 51}}')
FROM bench.conf c;
END;
