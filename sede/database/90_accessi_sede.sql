-- ============================================================
-- 90_accessi_sede.sql — Accessi della sede (L-05 realizzato da P-05 e P-07, WBA v0.5)
--
-- Dopo le migrazioni di supabase/migrations. Il servizio della sede (P-07) verifica email e password con
-- sede_login, chiamata tramite PostgREST col proprio token di servizio, e firma il token dell'operatore.
-- Gli account si creano dal PC server con sede/installa.js (auth.crea_utente), mai dalle API.
-- Il PIN per entrare senza collegamento sui tablet (REQ-E-06) arriverà con l'APK (D-2, P-02).
-- ============================================================

BEGIN;

-- Verifica delle credenziali: risponde l'account (senza password) oppure NULL. Solo per il servizio.
CREATE FUNCTION public.sede_login(p_email text, p_password text)
RETURNS jsonb AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user FROM auth.users
  WHERE email = lower(trim(p_email)) AND disabled_at IS NULL;
  IF NOT FOUND OR v_user.encrypted_password <> crypt(p_password, v_user.encrypted_password) THEN
    RETURN NULL;
  END IF;
  UPDATE auth.users SET last_sign_in_at = now() WHERE id = v_user.id;
  RETURN jsonb_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'app_metadata', v_user.raw_app_meta_data,
    'user_metadata', v_user.raw_user_meta_data);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, extensions;

REVOKE EXECUTE ON FUNCTION public.sede_login(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sede_login(text, text) TO service_role;

-- Nuovo account con il suo operatore: ruolo dell'app (admin o staff, migrazioni 004 e 013) e ruolo
-- dei movimenti (BBA Step 2: admin, laboratorio, negozio, fiere). Si esegue dal PC server.
CREATE FUNCTION auth.crea_utente(p_email text, p_password text, p_nome text, p_ruolo operator_role)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  VALUES (lower(trim(p_email)), crypt(p_password, gen_salt('bf')),
          jsonb_build_object('role', CASE WHEN p_ruolo = 'admin' THEN 'admin' ELSE 'staff' END),
          jsonb_build_object('name', p_nome))
  RETURNING id INTO v_id;
  INSERT INTO public.operators (id, name, role) VALUES (v_id, p_nome, p_ruolo);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

CREATE FUNCTION auth.cambia_password(p_email text, p_password text)
RETURNS void AS $$
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  UPDATE auth.users SET encrypted_password = crypt(p_password, gen_salt('bf'))
  WHERE email = lower(trim(p_email));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nessun account con email %', p_email;
  END IF;
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

REVOKE EXECUTE ON FUNCTION auth.crea_utente(text, text, text, operator_role), auth.cambia_password(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
