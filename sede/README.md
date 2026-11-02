# Il gestionale sul PC della sede (e sul mini PC di prova)

Come la **WBA v0.5** (D-1, Step 5 e 6): niente Supabase, tutto sul PC Windows.

| Pezzo | Cosa è | Dove |
|---|---|---|
| P-05 | PostgreSQL 17, servizio di Windows | installer EDB |
| P-06 | PostgREST, le API dei dati, solo su `127.0.0.1:3000` | `C:\DeSimone\dati\bin\postgrest.exe` |
| P-07 | Servizio della sede (Node.js): accesso e token, inoltro a PostgREST, foto, pagine dell'app | `sede/servizio/servizio.js` |
| P-09 | WinSW: avvia P-06 e P-07 all'accensione e li riavvia se si fermano | `C:\DeSimone\dati\servizio-*.exe` |
| P-01 | L'app, la stessa di Vercel: dal servizio sa di essere nella sede | `http://localhost:8080` |

Il mini PC è il **banco di prova** della WBA: Windows 10 con la RAM limitata a **4 GB**, come il PC server (i5-2400).
Qui si misura se ci stiamo con la memoria.

## 0. Cosa scaricare (su una chiavetta, se il PC non ha internet: REQ-003)

1. **PostgreSQL 17** per Windows x64, installer di EDB (enterprisedb.com → Download PostgreSQL).
2. **Node.js 22 LTS** per Windows x64, file `.msi` (nodejs.org).
3. **PostgREST** 12.2 o successivo per Windows: `postgrest-v12.2.x-windows-x64.zip` da github.com/PostgREST/postgrest/releases.
4. **WinSW 2.12.0**: `WinSW-x64.exe` da github.com/winsw/winsw/releases (tag v2.12.0).
5. **Git per Windows** (git-scm.com), oppure lo ZIP del repository privato, branch `main`.

## 1. Preparare il mini PC

1. **Limitare la RAM a 4 GB** per la prova: `Win + R` → `msconfig` → Opzioni di avvio → Opzioni avanzate →
   ✓ Memoria massima `4096` → OK → riavvia. Lo toglierai alla fine delle prove.
2. Crea le cartelle `C:\DeSimone` e `C:\DeSimone\dati\bin`.
3. Copia il repository in `C:\DeSimone\desimone-os`:
   ```powershell
   cd C:\DeSimone
   git clone https://github.com/DedaloTeam/desimone-os.git
   cd desimone-os
   git checkout main
   ```

## 2. Installare i programmi

1. **PostgreSQL 17**: installer EDB con le scelte proposte (porta 5432). Togli solo *Stack Builder*.
   Annota la **password dell'utente `postgres`**: serve al passo 3.
2. **Node.js 22**: installer `.msi` con le scelte proposte.
3. **PostgREST**: dallo ZIP copia `postgrest.exe` in `C:\DeSimone\dati\bin\`.
4. **WinSW**: copia `WinSW-x64.exe` **due volte** in `C:\DeSimone\dati\`, con questi nomi:
   `servizio-postgrest.exe` e `servizio-sede.exe`.

## 3. Installare il gestionale

Apri **PowerShell come amministratore**:

```powershell
cd C:\DeSimone\desimone-os
$env:PGPASSWORD = "la password di postgres del passo 2"
node sede\installa.js --dati C:\DeSimone\dati
```

Lo script crea il database `desimone`, applica tutte le migrazioni (le stesse di Supabase, più le due di
`sede/database/`), imposta PostgreSQL per 4 GB, genera password e segreti in `C:\DeSimone\dati\segreti\` e scrive
le configurazioni. Alla fine chiede **nome, email e password del primo amministratore**.

Poi riavvia PostgreSQL, così prende le impostazioni per 4 GB, e installa i due servizi:

```powershell
Restart-Service postgresql-x64-17
cd C:\DeSimone\dati
.\servizio-postgrest.exe install
.\servizio-sede.exe install
Start-Service desimone-postgrest
Start-Service desimone-sede
```

## 4. Provare

1. Apri **Edge o Chrome** su `http://localhost:8080` ed entra con l'amministratore.
2. Controlla che il servizio risponda: `http://localhost:8080/salute`.
3. In **Movimenti** registra il dispositivo, ad esempio `PC1`, poi fai un carico. Con la SB16001 collegata via cavo,
   usa "via cavo" (Web Serial funziona su `localhost`).
4. In **Giacenze** controlla la giacenza, i luoghi e i dispositivi.
5. **Memoria**: con l'app aperta, apri Gestione attività → Dettagli e annota la RAM di `postgres.exe` (somma),
   `postgrest.exe`, `node.exe` e del browser. La WBA (par 6a) prevede circa 0,5 GB per i servizi e
   1,2–1,8 GB liberi su 4.
6. **Riavvio**: riavvia il PC e controlla che `http://localhost:8080` torni da solo, senza fare niente (D-4).

## Altri account

Si creano dal PC, non dall'app. Il ruolo dei movimenti è uno tra `admin`, `laboratorio`, `negozio` e `fiere`:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d desimone -c "SELECT auth.crea_utente('negozio@desimone.it', 'una-password', 'Negozio', 'negozio')"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d desimone -c "SELECT auth.cambia_password('negozio@desimone.it', 'nuova-password')"
```

## Aggiornare a una nuova versione (L-14)

```powershell
cd C:\DeSimone\desimone-os
git pull
$env:PGPASSWORD = "..."
node sede\installa.js --dati C:\DeSimone\dati
Restart-Service desimone-sede
```

Lo script applica solo le migrazioni nuove (sono elencate in `sede.migrazioni`) e non tocca dati, segreti e account.
Nel browser, se vedi ancora la versione vecchia, ricarica forzando con `Ctrl + F5`.

Con la migrazione 032, una volta sola, l'app chiede a tutti di rifare l'accesso: serve per vedere le foto.

## Catalogo del sito

La sede non ha internet: il catalogo di antoninodesimone.it si scarica su un PC che ce l'ha e si porta in un file.

```powershell
# Sul PC con internet, dalla cartella del repository (non scrive niente, nemmeno su Supabase)
node scripts\import-sito.mjs --preview catalogo.json
# Sul PC server, dopo installa.js (serve la migrazione 028)
$env:PGPASSWORD = "..."
node sede\importa-catalogo.js catalogo.json
```

Crea le collezioni e gli articoli che mancano, con materiali, metallo, prezzo, descrizioni e il peso di un pezzo letto
dalla descrizione del sito. Si può rilanciare con un catalogo più nuovo: gli articoli che ci sono già non cambiano,
tranne il peso se manca (uno scritto nella scheda resta). Alla fine elenca gli articoli senza peso: finché il peso non
è nella scheda non si possono caricare. Le giacenze non si importano, nascono dai carichi in Movimenti.

## Se qualcosa non va

- **Log** dei servizi: `C:\DeSimone\dati\log\`.
- **La pagina non si apre**: `Get-Service desimone-*`. Se è fermo, guarda il suo log.
- **`desimone-postgrest` non parte** ("Failed to start service"): `postgrest.exe` cerca `LIBPQ.dll` nella cartella
  `bin` di PostgreSQL, che `servizio-postgrest.xml` aggiunge al `PATH`. Rilancia `installa.js`, che riscrive il file.
- **"Il database della sede non risponde"**: PostgREST è fermo, oppure la password in `postgrest.conf` non è quella
  del ruolo `authenticator`. Rilancia `installa.js`, che la reimposta.
- **Le foto non si vedono**: senza accesso il servizio non le dà (401). Esci e rientra: l'accesso le riabilita.
- Per ricominciare da zero sul mini PC: ferma i servizi, poi
  `psql -U postgres -c "DROP DATABASE desimone"`, cancella `C:\DeSimone\dati\segreti` e rilancia l'installazione.

## Cosa non c'è ancora (WBA v0.5, Step 6 "da scrivere")

- **HTTPS col certificato di casa** per i tablet (`gestionale.desimone.lan`, architettura-locale §4). Oggi il
  servizio ascolta solo su `127.0.0.1`. `sede.json` ha già il campo `https` per certificato e chiave.
- **Programma per Windows** (P-04, Electron) e **APK** (P-03, Capacitor), in attesa del parere di Lorenzo e
  Giorgio. Per ora l'app si apre nel browser.
- **Bilancia della sede letta dal servizio** sulla porta COM (L-09). Per ora si legge via cavo dal browser.
- Etichette sulla QL-800, copia notturna sul NAS (L-12), import da STEP (P-11), sincronizzazione dei tablet (L-08),
  PIN per entrare senza collegamento (REQ-E-06).
- I dati di Supabase non vengono copiati: la sede parte con il database vuoto, a parte i semilavorati della
  migrazione 020. Gli articoli del sito si caricano con `importa-catalogo.js` (sopra); le **foto** non ancora.
