-- ============================================================
-- 93_utenti_sede.sql — Account e password nella sede (scheda 1.4, CR15: REQ-P-08)
--
-- Dopo la 037. Su Supabase queste cose si fanno dal suo pannello; qui gli account sono nostri (00_base_sede.sql).
--   - Si entra con un nome utente, come in STEP: "gioia" è gioia@desimone.local. Chi ha un'email intera entra ancora.
--   - Una password assegnata da altri è provvisoria: con quella non si ottiene un token, si può solo cambiarla.
--     Il segno sta in raw_app_meta_data, così la 037 lo legge per l'elenco anche senza colonne solo della sede.
--   - Le password non restano mai nello storico: solo il fatto che sono cambiate.
-- Prove: supabase/tests/sede_93_utenti_test.sql.
-- ============================================================

BEGIN;

-- Nome utente o email intera → l'email con cui è registrato l'account
CREATE FUNCTION public.sede_email(p_login text)
RETURNS text AS $$
  SELECT CASE WHEN position('@' IN v) > 0 THEN v ELSE v || '@desimone.local' END
  FROM (SELECT lower(btrim(p_login)) AS v) s
$$ LANGUAGE sql IMMUTABLE;

REVOKE EXECUTE ON FUNCTION public.sede_email(text) FROM PUBLIC, anon, authenticated, service_role;

-- Chi aveva scritto solo un nome al posto dell'email, nell'installazione, entra ancora con quello
UPDATE auth.users SET email = public.sede_email(email) WHERE position('@' IN email) = 0;

-- ------------------------------------------------------------
-- Accesso: oltre a NULL e all'account, due risposte solo per chi ha la password giusta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sede_login(p_email text, p_password text)
RETURNS jsonb AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user FROM auth.users
  WHERE email = public.sede_email(p_email) AND disabled_at IS NULL;
  IF NOT FOUND OR v_user.encrypted_password <> crypt(p_password, v_user.encrypted_password) THEN
    RETURN NULL;
  END IF;
  IF public.account_is_disabled(v_user.id) THEN
    RETURN jsonb_build_object('disabled', true);
  END IF;
  IF coalesce((v_user.raw_app_meta_data ->> 'password_provvisoria')::boolean, false) THEN
    RETURN jsonb_build_object('must_change_password', true);
  END IF;
  UPDATE auth.users SET last_sign_in_at = now() WHERE id = v_user.id;
  RETURN jsonb_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'app_metadata', v_user.raw_app_meta_data,
    'user_metadata', v_user.raw_user_meta_data);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, extensions;

-- ------------------------------------------------------------
-- Ognuno cambia la propria, conoscendo quella di adesso (UT-03, UT-04). Solo per il servizio, come sede_login:
-- serve anche a chi ha la provvisoria, che un token non ce l'ha. false se la password di adesso è sbagliata.
-- ------------------------------------------------------------
CREATE FUNCTION public.sede_cambia_password(p_email text, p_attuale text, p_nuova text)
RETURNS boolean AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user FROM auth.users
  WHERE email = public.sede_email(p_email) AND disabled_at IS NULL;
  IF NOT FOUND OR v_user.encrypted_password <> crypt(p_attuale, v_user.encrypted_password) THEN
    RETURN false;
  END IF;
  IF public.account_is_disabled(v_user.id) THEN
    RAISE EXCEPTION 'Account disattivato: chiedi all''amministrazione';
  END IF;
  IF length(coalesce(p_nuova, '')) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  IF p_nuova = p_attuale THEN
    RAISE EXCEPTION 'La password nuova deve essere diversa da quella di adesso';
  END IF;
  UPDATE auth.users
  SET encrypted_password = crypt(p_nuova, gen_salt('bf')),
      raw_app_meta_data = raw_app_meta_data - 'password_provvisoria'
  WHERE id = v_user.id;
  INSERT INTO public.audit_log (table_name, record_id, action, new_values, changed_by)
  VALUES ('auth.users', v_user.id, 'update', '{"password": "cambiata da chi la usa"}', v_user.id);
  RETURN true;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, extensions;

REVOKE EXECUTE ON FUNCTION public.sede_cambia_password(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sede_cambia_password(text, text, text) TO service_role;

-- ------------------------------------------------------------
-- Per l'amministrazione: un account nuovo e una password dimenticata (REQ-P-08, UT-01, UT-02, UT-05)
-- ------------------------------------------------------------
CREATE FUNCTION public.account_create(p_name text, p_username text, p_role operator_role, p_password text)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_username text := lower(btrim(coalesce(p_username, '')));
BEGIN
  PERFORM public.account_require_admin();
  IF v_name = '' THEN
    RAISE EXCEPTION 'Scrivi il nome';
  END IF;
  IF v_username !~ '^[a-z0-9][a-z0-9._-]{1,39}$' THEN
    RAISE EXCEPTION 'Il nome utente può avere lettere, numeri, punti e trattini, senza spazi: da 2 a 40 caratteri';
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = public.sede_email(v_username)) THEN
    RAISE EXCEPTION 'Il nome utente "%" esiste già', v_username;
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  VALUES (public.sede_email(v_username), crypt(p_password, gen_salt('bf')),
          '{"password_provvisoria": true}', jsonb_build_object('name', v_name))
  RETURNING id INTO v_id;
  INSERT INTO public.operators (id, name, role) VALUES (v_id, v_name, p_role);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE FUNCTION public.account_reset_password(p_id uuid, p_password text)
RETURNS void AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public.account_require_admin();
  IF p_id = public.current_operator_id() THEN
    RAISE EXCEPTION 'La tua password la cambi da "Esci", dove chiede quella di adesso';
  END IF;
  SELECT raw_app_meta_data ->> 'role' INTO v_role FROM auth.users WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account non trovato';
  END IF;
  IF v_role = 'dev' THEN
    RAISE EXCEPTION 'Gli account di Dedalo non si cambiano da qui';
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      raw_app_meta_data = raw_app_meta_data || '{"password_provvisoria": true}'
  WHERE id = p_id;
  INSERT INTO public.audit_log (table_name, record_id, action, new_values, changed_by)
  VALUES ('auth.users', p_id, 'update', '{"password": "reimpostata dall''amministrazione"}', auth.uid());
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, extensions;

REVOKE EXECUTE ON FUNCTION public.account_create(text, text, operator_role, text), public.account_reset_password(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.account_create(text, text, operator_role, text), public.account_reset_password(uuid, text)
  TO authenticated;

-- ------------------------------------------------------------
-- Dal PC server (psql e installa.js): stessi nomi, un nome utente vale come un'email.
-- La password che sceglie Dedalo per chi l'ha dimenticata è provvisoria: la conosce qualcun altro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.crea_utente(p_email text, p_password text, p_nome text, p_ruolo operator_role)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
  VALUES (public.sede_email(p_email), crypt(p_password, gen_salt('bf')), jsonb_build_object('name', p_nome))
  RETURNING id INTO v_id;
  INSERT INTO public.operators (id, name, role) VALUES (v_id, p_nome, p_ruolo);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

CREATE OR REPLACE FUNCTION auth.crea_utente_dev(p_email text, p_password text, p_nome text)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  VALUES (public.sede_email(p_email), crypt(p_password, gen_salt('bf')),
          jsonb_build_object('role', 'dev'),
          jsonb_build_object('name', p_nome))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

CREATE OR REPLACE FUNCTION auth.cambia_password(p_email text, p_password text)
RETURNS void AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      raw_app_meta_data = raw_app_meta_data || '{"password_provvisoria": true}'
  WHERE email = public.sede_email(p_email)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Nessun account con email %', p_email;
  END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, new_values)
  VALUES ('auth.users', v_id, 'update', '{"password": "reimpostata dal PC server"}');
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

NOTIFY pgrst, 'reload schema';

COMMIT;
