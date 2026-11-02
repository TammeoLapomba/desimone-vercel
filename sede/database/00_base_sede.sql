-- ============================================================
-- 00_base_sede.sql — Base del database della sede (P-05, WBA v0.5, D-1: PostgreSQL 17 su Windows)
--
-- Prima delle migrazioni di supabase/migrations: crea quello che su Supabase c'è già e che le migrazioni
-- 001–021 usano, senza Supabase.
--   - ruoli di PostgREST (P-06): anon, authenticated, service_role; authenticator è il ruolo con cui
--     PostgREST si collega (la password la mette sede/installa.js)
--   - schema auth: gli account (email, password cifrata, ruolo dell'app) e l'utente dal token.
--     È nostro, lo gestisce il servizio della sede (P-07): stesso nome e stesse colonne che le migrazioni
--     001–021 leggono (auth.users, auth.uid(), auth.role()), così girano senza modifiche
--   - schema storage: solo le tabelle a cui si appoggiano le regole di 006 e 016; le foto vere sono file
--     nella cartella del servizio della sede
--   - pubblicazione supabase_realtime, che la 013 si aspetta (qui nessuno la ascolta)
--   - schema sede: l'elenco delle migrazioni applicate (L-14, aggiornare senza perdere movimenti)
-- Si esegue una volta sola, su un database vuoto.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- password cifrate (crypt, bcrypt)

-- ------------------------------------------------------------
-- Ruoli di PostgREST
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Come Supabase: tutto ciò che nasce in public è dei suoi ruoli, poi lo filtrano i permessi per riga
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Account e utente dal token
-- ------------------------------------------------------------
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE CHECK (email = lower(email) AND email <> ''),
  encrypted_password text NOT NULL,                                   -- crypt(password, gen_salt('bf'))
  raw_app_meta_data  jsonb NOT NULL DEFAULT '{}',                     -- {"role": "admin" | "staff"}
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}',                     -- {"name": "..."}
  disabled_at        timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Nessuno legge gli account tramite le API: li usano solo le funzioni qui sotto e get_user_role (004, 013)
REVOKE ALL ON auth.users FROM PUBLIC, anon, authenticated, service_role;

-- Utente e ruolo dal token che PostgREST ha già verificato
CREATE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$ LANGUAGE sql STABLE;
CREATE FUNCTION auth.role() RETURNS text AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- Appoggio per le regole sulle foto di 006 e 016
-- ------------------------------------------------------------
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
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Migrazioni applicate (L-14)
-- ------------------------------------------------------------
CREATE SCHEMA sede;
CREATE TABLE sede.migrazioni (
  nome          text PRIMARY KEY,
  applicata_il  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
