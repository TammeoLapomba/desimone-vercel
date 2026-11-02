-- Storico di un gioiello con la giacenza dopo ogni movimento, più i dati dei movimenti (getItemHistory)
\set i random(1, :N)
SELECT id AS art FROM bench.articoli WHERE i = :i \gset
BEGIN;
SELECT set_config('request.jwt.claims', claims, true), set_config('role', 'authenticated', true) FROM bench.conf;
SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT movement_id, code, movement_type, location_id, pieces, grams, occurred_at, cancelled, pieces_after, grams_after
  FROM movement_history WHERE article_id = :art ORDER BY occurred_at DESC, recorded_at DESC) t;
SELECT coalesce(json_agg(t), '[]') FROM (
  SELECT id, reason_id, operator_id, device_id, note, document_ref, weight_source, scale_id, parent_id, cancelled_at, cancel_reason
  FROM movements WHERE article_id = :art) t;
END;
