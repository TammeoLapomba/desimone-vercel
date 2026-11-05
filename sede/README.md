# Il gestionale sul PC della sede (e sul mini PC di prova)

Come la **WBA v0.5** (D-1, Step 5 e 6): niente Supabase, tutto sul PC Windows.

| Pezzo | Cosa è | Dove |
|---|---|---|
| P-05 | PostgreSQL 17, servizio di Windows, solo su `localhost` | installer EDB |
| P-06 | PostgREST, le API dei dati, solo su `127.0.0.1:3000` | `C:\DeSimone\dati\bin\postgrest.exe` |
| P-07 | Servizio della sede (Node.js): accesso e token, inoltro a PostgREST, foto, pagine dell'app. Gira con una copia di Node.js tutta sua, `node-sede.exe`, che il firewall riconosce | `sede/servizio/servizio.js`, `C:\DeSimone\dati\bin\node-sede.exe` |
| P-09 | WinSW: avvia P-06 e P-07 all'accensione e li riavvia se si fermano | `C:\DeSimone\dati\servizio-*.exe` |
| P-01 | L'app, la stessa di Vercel: dal servizio sa di essere nella sede | `http://localhost:8080`, e dai tablet della rete locale (sotto) |

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

Lo script crea il database `desimone`, applica tutte le migrazioni (le stesse di Supabase, più quelle di
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
4. In **Giacenze** controlla la giacenza. In **Impostazioni**, solo per l'amministrazione, i luoghi e i dispositivi.
5. **Memoria**: con l'app aperta, apri Gestione attività → Dettagli e annota la RAM di `postgres.exe` (somma),
   `postgrest.exe`, `node.exe` e del browser. La WBA (par 6a) prevede circa 0,5 GB per i servizi e
   1,2–1,8 GB liberi su 4.
6. **Riavvio**: riavvia il PC e controlla che `http://localhost:8080` torni da solo, senza fare niente (D-4).

## Tablet e altri dispositivi della rete locale

Di partenza l'app si apre solo dal PC server. Per aprirla anche dai tablet e dai PC collegati alla stessa rete (Wi-Fi o
cavo dell'azienda), in **PowerShell come amministratore**:

```powershell
cd C:\DeSimone\desimone-os
$env:PGPASSWORD = "..."
node sede\installa.js --dati C:\DeSimone\dati --rete si
powershell -ExecutionPolicy Bypass -File sede\rete.ps1 apri
Restart-Service desimone-sede
```

`rete.ps1 apri` scrive alla fine gli indirizzi da aprire sul tablet, per esempio `http://192.168.1.20:8080`. Conviene
dare al PC server un indirizzo fisso nel router, così non cambia. La scelta resta per gli aggiornamenti; per tornare
solo al PC server: `installa.js … --rete no`, `rete.ps1 chiudi`, `Restart-Service desimone-sede`.

**Solo rete locale, mai internet.** Tre barriere, ognuna basta da sola:

1. **Il servizio della sede** chiude subito ogni connessione che non arriva dal PC stesso o da un indirizzo privato
   (`10.…`, `172.16–31.…`, `192.168.…`, link-local), e non si collega a niente fuori da questo PC: solo PostgREST e il
   database su `localhost`. Se `sede.json` indicasse un altro indirizzo, il servizio non parte.
2. **Il firewall di Windows** (`rete.ps1 apri`, gruppo di regole "De Simone gestionale"): la porta 8080 è aperta solo
   per `node-sede.exe`, solo dalla sottorete del PC e solo su una rete **Privata** o di Dominio. Per `node-sede.exe`,
   `postgrest.exe`, `postgres.exe`, `pg_dump.exe` e `pg_restore.exe` tutti gli indirizzi di internet sono bloccati, in
   uscita e in entrata, anche se un'altra regola li permettesse. `rete.ps1 stato` mostra regole, reti e indirizzi.
3. **PostgreSQL e PostgREST** ascoltano solo su `localhost`: dalla rete si passa sempre dal servizio della sede.

Se la rete del PC è **Pubblica** i tablet non entrano: `rete.ps1` lo segnala. Va impostata come Privata in
Impostazioni → Rete e Internet → Wi-Fi o Ethernet → la rete → Tipo di profilo di rete: **Privato**.

**Senza HTTPS** dal tablet l'app è in `http://`: funziona tutto quello che c'è oggi, ma il browser non la installa come
app, non la tiene per lavorare senza collegamento e non dà la fotocamera; la password passa in chiaro nel Wi-Fi. Per
i tablet si accende l'HTTPS (sotto).

## HTTPS col certificato di casa (architettura-locale §4)

Il PC della sede non ha internet, quindi niente certificati pubblici: `installa.js` crea una piccola **autorità di
casa** (dura 10 anni) e con quella firma il certificato del server, per `gestionale.desimone.lan`, il nome del PC e i
suoi indirizzi della rete. Su ogni tablet si installa **una volta** il certificato dell'autorità; dopo, il tablet si
fida del server anche quando il certificato del server si rinnova. Tutto con Windows (`sede/certificato.ps1`), senza
scaricare niente. In **PowerShell come amministratore**:

```powershell
cd C:\DeSimone\desimone-os
$env:PGPASSWORD = "..."
node sede\installa.js --dati C:\DeSimone\dati --rete si --https si
powershell -ExecutionPolicy Bypass -File sede\rete.ps1 apri
Restart-Service desimone-sede
```

`installa.js` scrive l'**impronta SHA-256** dell'autorità: annotala. L'HTTPS è sulla porta **8443** (`--porta-https`
per cambiarla); `rete.ps1 apri` va rilanciato perché il firewall apra anche quella.

**Su ogni tablet, una volta sola:**

1. Apri `http://<indirizzo del PC>:8080/certificato` (gli indirizzi li scrive `rete.ps1 stato`) e tocca
   **Scarica il certificato**.
2. Impostazioni → Sicurezza → Altre impostazioni di sicurezza → Crittografia e credenziali → **Installa un
   certificato** → **Certificato CA** → Installa comunque → `ca-desimone.crt` in Download. Il tablet deve avere un
   blocco schermo (PIN). I nomi dei menu cambiano un po' da un Android all'altro: cerca "certificato" nelle Impostazioni.
3. Chiudi e riapri il browser, poi **Apri il gestionale (https)** dalla stessa pagina: `https://<indirizzo>:8443`.
   Conviene aggiungerlo alla schermata Home.

**Su iPhone e iPad, una volta sola** (la pagina `/certificato` mostra da sola le istruzioni giuste):

1. Apri `http://<indirizzo del PC>:8080/certificato` con **Safari**, tocca **Scarica il certificato** e **Consenti**.
2. Impostazioni → **Profilo scaricato** (in alto; oppure Generali → VPN e gestione dispositivi) → **Installa**.
3. Impostazioni → Generali → Info → **Impostazioni certificati attendibili** → accendi "De Simone - autorita di
   casa". Senza questo passo iOS installa il profilo ma Safari non si fida del server.
4. Apri `https://<indirizzo>:8443`. Su iOS tutti i browser usano gli stessi certificati: dopo il passo 3 vale
   anche per Chrome.

La pagina mostra anche l'impronta: deve essere la stessa scritta da `installa.js`.

**Cosa cambia.** Dalla rete in `http://` restano solo `/certificato` e `/salute`: le pagine passano da sole a
`https://`, l'accesso e i dati in `http://` si rifiutano, così la password non passa mai in chiaro. Sul PC server
`http://localhost:8080` resta com'è (per il browser `localhost` è già sicuro, e la bilancia via cavo lo vuole).

**Quando si rifà il certificato del server.** A ogni `installa.js` si controlla: si rifà se scade entro 30 giorni (dura
825 giorni, il massimo che i browser accettano) o se il PC ha un indirizzo che il certificato non contiene, per
esempio dopo aver cambiato rete. Poi `Restart-Service desimone-sede`. I tablet non devono fare niente. Se si cancella
`C:\DeSimone\dati\segreti\ca-desimone.pfx` si crea un'autorità nuova, e il certificato va reinstallato su tutti i
tablet: quel file va nella copia dei segreti, non va dato a nessuno.

Se sul tablet compare "La connessione non è privata": il certificato dell'autorità non è installato, oppure l'indirizzo
aperto non è nel certificato (rilancia `installa.js` con il PC collegato a quella rete e riavvia il servizio).

## Altri account

Li gestisce l'amministrazione, nell'app: Impostazioni → **Utenti**. Crea un account per persona con nome, nome utente, ruolo
e password provvisoria, e la persona sceglie la sua al primo accesso. Da lì si cambia il ruolo, si disattiva e si reimposta
una password. Ognuno cambia la propria da **Esci**. Si entra con il nome utente, per esempio `gioia`; chi ha un'email
intera, come il primo amministratore se ne ha scritta una in `installa.js`, entra con quella.

**Se la password la dimentica l'unico amministratore**, serve il PC. La nuova è provvisoria: al primo accesso va cambiata.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d desimone -c "SELECT auth.cambia_password('gioia', 'nuova-password')"
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

Prima di un aggiornamento conviene fare una copia di sicurezza: Impostazioni → **Copia di sicurezza** → **Copia adesso**.

## Copia di sicurezza (7.2, REQ-I-02)

Ogni notte alle 2 il servizio della sede copia database e foto in una cartella a parte, e controlla che la copia
si legga. Tiene le copie degli ultimi 30 giorni e la prima di ogni mese per un anno; le altre le cancella da sola.
Lo stato, con gli avvisi (copia non riuscita, disco non collegato, copia sullo stesso disco dei dati), lo vede
l'amministrazione in Impostazioni → **Copia di sicurezza**, dove c'è anche **Copia adesso**. Gli avvisi compaiono anche in cima a Giacenze. Se il PC era spento alle 2,
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
PC). `dati` scrive i codici da annotare anche in `%USERPROFILE%\DeSimoneSede\esito\dati-prova.txt`.

Per provare dai tablet (sezione "Tablet e altri dispositivi della rete locale"): **prima** il firewall, da PowerShell
come amministratore, poi `aggiorna -Rete si`. In quest'ordine Windows non chiede niente; al contrario potrebbe
chiedere se consentire `node-sede.exe` (se compare, scegli **Consenti**: le regole di `rete.ps1` restano più forti).

```powershell
powershell -ExecutionPolicy Bypass -File sede\rete.ps1 apri -Dati $env:USERPROFILE\DeSimoneSede\dati
powershell -ExecutionPolicy Bypass -File sede\prove\sede-locale.ps1 aggiorna -Rete si
```

Con l'HTTPS: `aggiorna -Rete si -Https si`, poi di nuovo `rete.ps1 apri` da amministratore (apre la porta 8443).

Le prove SQL:

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

- **Il nome `gestionale.desimone.lan`** è nel certificato, ma perché i tablet lo trovino serve una voce nel router
  dell'azienda (DNS locale). Finché non c'è, si usa l'indirizzo del PC.
- **Programma per Windows** (P-04, Electron) e **APK** (P-03, Capacitor), in attesa del parere di Lorenzo e
  Giorgio. Per ora l'app si apre nel browser.
- **Bilancia della sede letta dal servizio** sulla porta COM (L-09). Per ora si legge via cavo dal browser.
- Etichette sulla QL-800, import da STEP (P-11), sincronizzazione dei tablet (L-08), PIN per entrare senza
  collegamento (REQ-E-06). La copia notturna c'è (sopra).
- I dati di Supabase non vengono copiati: la sede parte con il database vuoto, a parte i semilavorati della
  migrazione 020. Gli articoli del sito si caricano con `importa-catalogo.js` (sopra); le **foto** non ancora.
