-- ============================================================
-- supabase_stub.sql — Il minimo di Supabase che serve alle migrazioni 001–021 su un PostgreSQL vuoto.
-- Solo per le prove: ruoli di PostgREST, schema auth (utenti e utente dal token), storage.objects,
-- pubblicazione realtime, e i permessi predefiniti che Supabase dà ai suoi ruoli.
-- La 022 non ne ha bisogno: gira così com'è anche sul PC server (D-1).
-- ============================================================

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Come Supabase: tutto ciò che nasce in public è dei suoi ruoli, poi lo filtrano i permessi per riga
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_app_meta_data  jsonb NOT NULL DEFAULT '{}',
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'
);
CREATE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$ LANGUAGE sql STABLE;
CREATE FUNCTION auth.role() RETURNS text AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$ LANGUAGE sql STABLE;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  public boolean NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name      text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE PUBLICATION supabase_realtime;
