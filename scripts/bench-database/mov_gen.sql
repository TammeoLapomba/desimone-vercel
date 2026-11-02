-- mov_gen.sql — Dati per il banco del registro dei movimenti, sullo schema vero (migrazioni 022 e seguenti).
-- :N gioielli, ognuno con :M movimenti: il primo è il carico di 1000 pezzi in laboratorio, il secondo porta 500
-- pezzi in negozio (così le vendite delle prove non lo svuotano), poi si alternano una vendita di 1 pezzo e un
-- trasferimento di 2 pezzi verso il negozio. Più un operatore e un dispositivo.
-- La giacenza è la somma dei movimenti, come nel gestionale: nessun numero da scalare.
-- Lo lancia mov_run.sh (o mov_run.ps1) come utente postgres, su un database creato apposta e mai su quello della sede.
\set ON_ERROR_STOP 1
\timing on
SELECT setseed(0.42);

DO $$
BEGIN
  IF current_database() = 'desimone' THEN
    RAISE EXCEPTION 'Questo è il database della sede: le prove vanno su un database a parte';
  END IF;
END $$;

-- Configurazione delle prove: luoghi proposti ai ruoli (REQ-B-05), causali, operatore, dispositivo e token
CREATE SCHEMA bench;
CREATE TABLE bench.conf AS
SELECT :N::integer AS n, :M::integer AS m,
       (SELECT location_id FROM role_locations WHERE role = 'laboratorio') AS lab,
       (SELECT location_id FROM role_locations WHERE role = 'negozio') AS shop,
       (SELECT id FROM movement_reasons WHERE code = 'nuova_produzione') AS carico,
       (SELECT id FROM movement_reasons WHERE code = 'trasferimento') AS trasf,
       (SELECT id FROM movement_reasons WHERE code IN ('vendita_showroom', 'vendita_banco') AND active LIMIT 1) AS vendita,
       auth.crea_utente('bench@prova.local', 'password-bench', 'Prove di carico', 'admin') AS operatore;
ALTER TABLE bench.conf ADD COLUMN dispositivo uuid, ADD COLUMN claims text,
  ADD COLUMN vendita_con_prezzo boolean;   -- dalla 026 la vendita chiede il prezzo
INSERT INTO devices (code, name) VALUES ('BENCH', 'Prove di carico');
UPDATE bench.conf SET
  dispositivo = (SELECT id FROM devices WHERE code = 'BENCH'),
  claims = json_build_object('sub', operatore, 'role', 'authenticated')::text,
  vendita_con_prezzo = EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'register_movement' AND 'p_sale_price' = ANY (proargnames));

-- Gioielli con collezione, tipo, metallo e uno o due materiali, come quelli dell'app
SET session_replication_role = replica;   -- niente registro delle modifiche: dati coerenti per costruzione
CREATE TABLE bench.articoli (i integer PRIMARY KEY, id uuid NOT NULL);
WITH c AS (SELECT array_agg(id ORDER BY name) AS v FROM collections),
     t AS (SELECT array_agg(id ORDER BY name) AS v FROM product_types),
     me AS (SELECT array_agg(id ORDER BY name) AS v FROM metals),
     nuovi AS (
       INSERT INTO articles (collection_id, name, product_type_id, metal_id, sku, price_retail, price_wholesale,
                             status, description_it, created_at, updated_at)
       SELECT c.v[1 + g % array_length(c.v, 1)],
              (array['Anello','Bracciale','Collana','Orecchini','Ciondolo','Spilla'])[1 + g % 6] || ' corallo ' ||
              (array['rosso','rosa','bianco','arancio'])[1 + (g / 6) % 4] || ' mod. ' || upper(substr(md5(g::text), 1, 6)),
              t.v[1 + g % array_length(t.v, 1)],
              me.v[1 + (g / 7) % array_length(me.v, 1)],
              'BENCH' || lpad(g::text, 6, '0'),
              round((50 + random() * 3000)::numeric, 2), round((25 + random() * 1500)::numeric, 2),
              'published', 'Gioiello artigianale realizzato a mano a Torre del Greco.',
              now() - interval '3 years', now() - random() * interval '1 year'
       FROM generate_series(1, :N) g, c, t, me
       RETURNING id, sku)
INSERT INTO bench.articoli SELECT substr(sku, 6)::integer, id FROM nuovi;
INSERT INTO article_materials (article_id, material_id, sort_order)
SELECT a.id, m.v[1 + (a.i + k) % array_length(m.v, 1)], k
FROM bench.articoli a, (SELECT array_agg(id ORDER BY name) AS v FROM materials) m, generate_series(0, 1) k
WHERE k = 0 OR a.i % 3 = 0;

-- Storico: :M movimenti per gioiello, uno ogni 10 giorni; le vendite hanno il prezzo se la 026 c'è
DO $$
DECLARE
  c bench.conf;
BEGIN
  SELECT * INTO c FROM bench.conf;
  EXECUTE format($q$
    INSERT INTO movements (code, movement_type, article_id, from_location_id, to_location_id, pieces, grams,
                           weight_source, reason_id, operator_id, device_id, occurred_at, recorded_at %s)
    SELECT 'G-' || a.i || '-' || k,
           CASE WHEN k = 1 THEN 'C' WHEN k %% 2 = 0 THEN 'T' ELSE 'S' END::movement_type,
           a.id,
           CASE WHEN k = 1 THEN NULL WHEN k %% 2 = 0 THEN %L::uuid ELSE %L::uuid END,
           CASE WHEN k = 1 THEN %L::uuid WHEN k %% 2 = 0 THEN %L::uuid END,
           CASE WHEN k = 1 THEN 1000 WHEN k = 2 THEN 500 WHEN k %% 2 = 0 THEN 2 ELSE 1 END,
           CASE WHEN k = 1 THEN 12.5 END,
           CASE WHEN k = 1 THEN 'mano'::weight_source END,
           CASE WHEN k = 1 THEN %L::uuid WHEN k %% 2 = 0 THEN %L::uuid ELSE %L::uuid END,
           %L, %L, ts, ts %s
    FROM bench.articoli a, generate_series(1, %s) k,
         LATERAL (SELECT now() - interval '3 years' + k * interval '10 days' + a.i * interval '1 second' AS ts) x$q$,
    CASE WHEN c.vendita_con_prezzo THEN ', sale_price' ELSE '' END,
    c.lab, c.shop, c.lab, c.shop, c.carico, c.trasf, c.vendita, c.operatore, c.dispositivo,
    CASE WHEN c.vendita_con_prezzo THEN ', CASE WHEN k > 1 AND k % 2 = 1 THEN 120.00 END' ELSE '' END,
    c.m);
END $$;
RESET session_replication_role;

GRANT USAGE ON SCHEMA bench TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA bench TO authenticated;
VACUUM ANALYZE;

SELECT (SELECT count(*) FROM articles) AS gioielli, (SELECT count(*) FROM movements) AS movimenti,
       pg_size_pretty(pg_total_relation_size('movements')) AS registro,
       pg_size_pretty(pg_database_size(current_database())) AS database;
