-- Utenti di Supabase che esistono già quando si esegue la 022: la 022 deve farne degli operatori
-- (admin resta admin, staff diventa laboratorio, chi non ha ruolo resta fuori).
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prova.it',  '{"role": "admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@prova.it',  '{"role": "staff"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'ospite@prova.it', '{}');
