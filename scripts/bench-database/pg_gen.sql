\timing on
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT setseed(0.42);
CREATE TABLE articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL, name text NOT NULL, product_type text NOT NULL,
  collection_id int NOT NULL, coral text, metal text,
  price_retail numeric(10,2), price_wholesale numeric(10,2),
  stock_retail int NOT NULL DEFAULT 0, stock_wholesale int NOT NULL DEFAULT 0,
  status text NOT NULL, description_it text, tags text[],
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz);
INSERT INTO articles (sku,name,product_type,collection_id,coral,metal,price_retail,price_wholesale,stock_retail,stock_wholesale,status,description_it,tags,created_at,updated_at)
SELECT 'DS'||lpad(g::text,12,'0'),
  t||' '||m||' '||f||' '||me||' mod. '||upper(substr(md5(g::text),1,6)),
  t, 1+(g % 400), m, me,
  round((20+random()*4000)::numeric,2), round((10+random()*2000)::numeric,2),
  (random()*5)::int, (random()*20)::int,
  (array['attivo','attivo','attivo','bozza','venduto','archiviato'])[1+(g%6)],
  'Gioiello artigianale in '||m||' con montatura in '||me||', lavorazione '||f||', realizzato a mano a Torre del Greco.',
  array[t,f],
  ts, ts + random()*interval '400 days'
FROM generate_series(1, :N) g,
LATERAL (SELECT (array['Anello','Bracciale','Collana','Orecchini','Ciondolo','Spilla','Girocollo','Charm'])[1+(g%8)] t,
                (array['corallo rosso','corallo rosa','corallo bianco','cammeo conchiglia','perla','turchese','onice','madreperla'])[1+((g/8)%8)] m,
                (array['sfera','botte','goccia','ramo','cuore','fiore','foglia','stella','ovale','tondo'])[1+((g/64)%10)] f,
                (array['argento 925','oro giallo 18kt','oro rosa 18kt','oro bianco 18kt','argento dorato'])[1+((g/640)%5)] me,
                now() - random()*interval '10 years' ts) x;
CREATE UNIQUE INDEX articles_sku ON articles(sku);
CREATE INDEX articles_list ON articles(status, product_type, updated_at DESC);
CREATE INDEX articles_coll ON articles(collection_id);
CREATE TABLE stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES articles(id),
  channel text NOT NULL, delta int NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO stock_movements(article_id, channel, delta, reason, created_at)
SELECT a.id, 'negozio', d, 'carico', a.created_at + k*interval '30 days'
FROM articles a, LATERAL (SELECT k, (CASE WHEN k=1 THEN 3 ELSE -1 END) d FROM generate_series(1,3) k) z;
CREATE INDEX mov_article ON stock_movements(article_id, created_at DESC);
VACUUM ANALYZE;
SELECT 'size_no_trgm', pg_size_pretty(pg_database_size(current_database()));
CREATE INDEX articles_name_trgm ON articles USING gin (name gin_trgm_ops);
ANALYZE articles;
SELECT 'size_total', pg_size_pretty(pg_database_size(current_database())),
       pg_size_pretty(pg_total_relation_size('articles')) art, pg_size_pretty(pg_relation_size('articles_name_trgm')) trgm,
       pg_size_pretty(pg_total_relation_size('stock_movements')) mov;
