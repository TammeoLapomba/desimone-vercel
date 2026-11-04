-- ============================================================
-- 91_account_dev.sql — Account dev di Dedalo nella sede (pacchetto 1.1)
--
-- Uno per persona, così lo storico dice chi ha cambiato le anagrafiche. Non è un operatore: senza una riga in operators
-- non registra movimenti (AN-13). Si crea dal PC server, come gli altri account (90_accessi_sede.sql).
-- ============================================================

BEGIN;

CREATE FUNCTION auth.crea_utente_dev(p_email text, p_password text, p_nome text)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'La password deve avere almeno 8 caratteri';
  END IF;
  INSERT INTO auth.users (email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  VALUES (lower(trim(p_email)), crypt(p_password, gen_salt('bf')),
          jsonb_build_object('role', 'dev'),
          jsonb_build_object('name', p_nome))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public, auth, extensions;

REVOKE EXECUTE ON FUNCTION auth.crea_utente_dev(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
