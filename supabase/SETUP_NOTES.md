# Supabase — Setup di un progetto nuovo

## 1. Database, storage e sicurezza
Dashboard → SQL Editor → New query → incolla tutto `setup_new_project.sql` → Run.

Crea tabelle, funzioni, trigger, dati iniziali (collezioni e materiali), il bucket
pubblico `photos` con le sue policy, e abilita RLS + realtime su `articles`.
Con la 022 crea anche il registro dei movimenti: luoghi, operatori, dispositivi, bilance e causali.

> Non eseguire `migrations/008_dev_rls_bypass.sql`: disattiva la sicurezza (solo sviluppo).

## 2. Chiudere le registrazioni
Dashboard → Authentication → Sign In / Providers → disattiva **Allow new users to sign up**.

Gli utenti si creano solo dalla dashboard.

## 3. Creare un utente
1. Dashboard → Authentication → Users → Add user → Create new user
   (email + password, spunta **Auto Confirm User**)
2. SQL Editor — assegna il ruolo (`admin` o `staff`):
   ```sql
   UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
   WHERE email = 'nome@esempio.it';
   ```
   Senza ruolo l'utente può solo leggere. Il ruolo va in `app_metadata`
   (non `user_metadata`) così l'utente non può cambiarselo da solo.
3. SQL Editor — rendilo operatore dei movimenti, con uno dei ruoli della BBA
   (`admin`, `laboratorio`, `negozio`, `fiere`):
   ```sql
   INSERT INTO operators (id, name, role)
   SELECT id, email, 'laboratorio'
   FROM auth.users
   WHERE email = 'nome@esempio.it'
   ON CONFLICT (id) DO UPDATE SET role = excluded.role, active = true;
   ```
   Senza questa riga l'utente non vede e non registra movimenti. Il ruolo di `operators` vale per i
   movimenti; quello in `app_metadata` (`admin` o `staff`) per il catalogo. Per provare un altro ruolo
   basta cambiare `operators.role`; per togliere l'accesso ai movimenti, `active = false`.

## 4. Chiavi per il frontend
Dashboard → Project Settings → API Keys: copia **Project URL** e la chiave
**anon / publishable** in `config.js`. Non usare mai la `service_role` / secret key nel frontend.
