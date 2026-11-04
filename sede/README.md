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

Chi lavora in Dedalo ha un account dev personale. Gestisce tipi, materiali e metalli nella pagina Anagrafiche e non è un
operatore: non registra movimenti. Le credenziali stanno nel gestore di password di Dedalo, mai nel repository.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d desimone -c "SELECT auth.crea_utente_dev('nome@dedalo.it', 'una-password', 'Nome')"
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

Prima di un aggiornamento conviene fare una copia di sicurezza: Giacenze → **Copia di sicurezza** → **Copia adesso**.

## Copia di sicurezza (7.2, REQ-I-02)

Ogni notte alle 2 il servizio della sede copia database e foto in una cartella a parte, e controlla che la copia
si legga. Tiene le copie degli ultimi 30 giorni e la prima di ogni mese per un anno; le altre le cancella da sola.
Lo stato, con gli avvisi (copia non riuscita, disco non collegato, copia sullo stesso disco dei dati), lo vede
l'amministrazione in Giacenze → **Copia di sicurezza**, dove c'è anche **Copia adesso**. Se il PC era spento alle 2,
la copia parte 5 minuti dopo l'accensione.

**Dove va la copia.** Su un disco dedicato, diverso da quello dei dati (decisione del 04/11/2026, piano 7.2). Si
sceglie una volta, rilanciando `installa.js`, e resta per gli aggiornamenti successivi:

```powershell
node sede\installa.js --dati C:\DeSimone\dati --copia E:\CopieDeSimone
Restart-Service desimone-sede
```

Senza `--copia` la copia va in `C:\DeSimone\dati\copie`, sullo stesso disco: protegge dagli errori, non da un guasto,
e la pagina lo segnala. Nella cartella ci sono i file `desimone-AAAAMMGG-HHMMSS.dump` (il database) e la cartella
`foto`, a cui si aggiungono le foto nuove: non se ne cancella nessuna, perché le copie vecchie le citano. Una copia si
fa anche a mano: `node sede\servizio\copia.js C:\DeSimone\dati\sede.json adesso`.

**Rimettere una copia** (il database torna al momento della copia; ciò che è stato fatto dopo resta solo nel
salvataggio `prima-del-ripristino-….dump`, vedi sotto):

```powershell
Stop-Service desimone-sede, desimone-postgrest
$env:PGPASSWORD = "la password di postgres"
node sede\ripristina.js --dati C:\DeSimone\dati E:\CopieDeSimone\desimone-20261104-020000.dump
Start-Service desimone-postgrest, desimone-sede
```

Lo script si ferma se i servizi sono ancora collegati al database, fa tutto in una sola transazione (se qualcosa va
storto il database non cambia) e rimette le foto che mancano. Su un PC nuovo: prima l'installazione dei passi 2 e 3,
poi `ripristina.js`. Se la copia è di una versione più vecchia, dopo si rilancia `installa.js`.

Prima di sovrascrivere, lo script salva il database com'è in quel momento in `prima-del-ripristino-AAAAMMGG-HHMMSS.dump`,
nella cartella della copia. Se la copia rimessa era quella sbagliata, o il lavoro fatto dopo serviva, si torna indietro
rimettendo quel file con lo stesso comando. Questi file non li cancella nessuno: quando non servono più si tolgono a mano.
Se il salvataggio non riesce lo script si ferma senza toccare niente. Solo se il database è così rovinato da non potersi
salvare si va avanti con `--senza-copia si`.

## Provare una PR sul PC

Per provare una modifica non serve il mini PC: `sede/prove/sede-locale.ps1` installa la sede sul PC di chi prova,
con gli stessi programmi (PostgreSQL 17, PostgREST, il servizio della sede e `installa.js`), presi da questo
repository. Non installa servizi di Windows e non tocca un PostgreSQL già installato: tiene tutto in
`%USERPROFILE%\DeSimoneSede`. PostgreSQL ascolta sulla porta 5432, l'app su `http://localhost:8080`.

Serve, una volta sola:

1. **Node.js 22** installato, e nella cartella `%USERPROFILE%\DeSimoneSandbox\installer` (o un'altra, con
   `-Installer`) l'installer di **PostgreSQL 17** e lo ZIP di **PostgREST** del passo 0.
2. Il file `%USERPROFILE%\DeSimoneSede\credenziali.txt`, **mai nel repository**, con quattro righe:
   ```
   PostgresPassword=una password per postgres
   AdminNome=Nome dell'amministratore
   AdminEmail=email dell'amministratore
   AdminPassword=la sua password, almeno 8 caratteri
   ```

Poi, dalla cartella del repository (Windows blocca gli script: va lanciato con `-ExecutionPolicy Bypass`):

```powershell
git switch <branch di partenza>
# sede nuova da questo branch (la prima volta basta "installa")
powershell -ExecutionPolicy Bypass -File sede\prove\sede-locale.ps1 installa -Azzera
# dati di prova (con -Pallino anche un semilavorato con 2 pezzi)
powershell -ExecutionPolicy Bypass -File sede\prove\sede-locale.ps1 dati
git switch <branch della PR>
# come L-14: solo le migrazioni nuove, poi riavvio del servizio della sede
powershell -ExecutionPolicy Bypass -File sede\prove\sede-locale.ps1 aggiorna
```

Poi in Edge si ricarica con Ctrl + Shift + R. Gli altri comandi: `stato`, `ferma`, `avvia` (dopo un riavvio del
PC). `dati` scrive i codici da annotare anche in `%USERPROFILE%\DeSimoneSede\esito\dati-prova.txt`. Le prove SQL:

```powershell
$env:PGPASSWORD = (Get-Content $env:USERPROFILE\DeSimoneSede\credenziali.txt | ConvertFrom-StringData).PostgresPassword
powershell -ExecutionPolicy Bypass -File supabase\tests\run.ps1 -PgBin $env:USERPROFILE\DeSimoneSede\pg\bin
```

Rispetto al mini PC mancano i servizi di Windows (WinSW), il limite di 4 GB e l'assenza di internet: una modifica
che tocca uno di questi va provata sul mini PC. Al posto di `Restart-Service desimone-sede` c'è `aggiorna`.
La Windows Sandbox non si usa più: dal 03/11/2026 va in crash (schermata blu 0x3B) a ogni prova.

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
- **"Copia di sicurezza non riuscita"**: il motivo è nella pagina e in `C:\DeSimone\dati\log\` (cerca "copia di
  sicurezza"). "Il disco … non è collegato": collega il disco e premi **Copia adesso**. "Manca la password
  del ruolo copia": rilancia `installa.js`.
- Per ricominciare da zero sul mini PC: ferma i servizi, poi
  `psql -U postgres -c "DROP DATABASE desimone"`, cancella `C:\DeSimone\dati\segreti` e rilancia l'installazione.

## Cosa non c'è ancora (WBA v0.5, Step 6 "da scrivere")

- **HTTPS col certificato di casa** per i tablet (`gestionale.desimone.lan`, architettura-locale §4). Oggi il
  servizio ascolta solo su `127.0.0.1`. `sede.json` ha già il campo `https` per certificato e chiave.
- **Programma per Windows** (P-04, Electron) e **APK** (P-03, Capacitor), in attesa del parere di Lorenzo e
  Giorgio. Per ora l'app si apre nel browser.
- **Bilancia della sede letta dal servizio** sulla porta COM (L-09). Per ora si legge via cavo dal browser.
- Etichette sulla QL-800, import da STEP (P-11), sincronizzazione dei tablet (L-08), PIN per entrare senza
  collegamento (REQ-E-06). La copia notturna c'è (sopra).
- I dati di Supabase non vengono copiati: la sede parte con il database vuoto, a parte i semilavorati della
  migrazione 020. Gli articoli del sito si caricano con `importa-catalogo.js` (sopra); le **foto** non ancora.
