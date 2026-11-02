# Banco prova del database

Prove di prestazione di [docs/analisi-database-locale.md](../../docs/analisi-database-locale.md): una tabella `articles` con lo schema del progetto e una `stock_movements` con 3 movimenti per articolo, più le operazioni del gestionale (scansione, elenchi, ricerca, vendita, modifica, inserimento, report).

| File | Cosa fa |
|---|---|
| `pg_gen.sql` | Crea e riempie il database PostgreSQL con `N` articoli e `3 × N` movimenti, poi gli indici |
| `pg_movimenti.sql` | Porta i movimenti a 100 per articolo, per la prova al volume reale (10 mila articoli, un milione di movimenti) |
| `pgbench/*.sql` | Un'operazione per file, lanciata da `pgbench` |
| `pg_run.ps1` | Lancia tutte le prove PostgreSQL su Windows |
| `pg_run.sh` | Lo stesso su macOS o Linux (zsh) |
| `sqlite_bench.py` | Genera i dati e lancia le stesse prove su SQLite (motore di PocketBase) |

## Registro dei movimenti, sul modello vero (14/10/2026)

Le prove sopra usano una tabella `articles` semplificata e una vendita che scala un numero di giacenza. Nel gestionale la giacenza è la **somma dei movimenti** (migrazioni 022 e seguenti), e le richieste passano da PostgREST con i permessi per riga. Queste prove rifanno la misura su quel modello, per REQ-I-06 (esito di una variazione entro 2 s) e REQ-N-01 (10 operatori insieme).

| File | Cosa fa |
|---|---|
| `mov_run.sh`, `mov_run.ps1` | Creano il database `desimone_bench` con le **stesse migrazioni della sede** (`sede/database/00_base_sede.sql`, `supabase/migrations` tranne la 008, `sede/database/9x`), lo riempiono e lanciano tutte le prove |
| `mov_gen.sql` | `N` gioielli con collezione, tipo e materiali; per ognuno `M` movimenti (carico in laboratorio, poi trasferimenti verso il negozio e vendite), un operatore e un dispositivo per le prove |
| `pgbench/mov_*.sql` | Le operazioni dell'app, con ruolo `authenticated` e token nella transazione come fa PostgREST: giacenza e storico di un gioiello, vendita e trasferimento con `register_movement`, elenco dei gioielli di Movimenti, pagine e totale della schermata Giacenze |

Il database della sede (`desimone`) **non si tocca**: gli script si rifiutano di usarlo, non cambiano ruoli né password e lasciano stare `postgrest.conf`. Si possono lanciare sul mini PC o nella Sandbox accanto alla sede installata.

Su Windows:

```powershell
$env:PGPASSWORD = "password dell'utente postgres"
.\mov_run.ps1 -N 10000 -M 100      # un milione di movimenti, circa 4 minuti
.\mov_run.ps1 -N 10000 -M 10       # 100 mila, più vicino al volume dei primi anni
psql -U postgres -d postgres -c "DROP DATABASE desimone_bench"
```

Su macOS o Linux: `PGPORT=5432 scripts/bench-database/mov_run.sh 10000 100`.

Per ogni operazione escono il tempo medio (`lat_ms`), quante al secondo (`tps`) e i percentili p50, p95 e il massimo, dal registro di pgbench. Con 10 operatori le prove sono due: solo registrazioni, e registrazioni con le schermate pesanti (elenco dei gioielli e Giacenze). I risultati sul Mac sono nel §5.3 di [docs/analisi-database-locale.md](../../docs/analisi-database-locale.md).

## Su Windows (mini PC di prova o PC server)

Serve PostgreSQL installato (installer EDB); `psql` e `pgbench` sono in `C:\Program Files\PostgreSQL\<versione>\bin`.

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
# volume reale: 10 mila articoli, un milione di movimenti (~160 MB)
createdb -U postgres a10k
psql -U postgres -d a10k -v N=10000 -v ON_ERROR_STOP=1 -f pg_gen.sql
psql -U postgres -d a10k -f pg_movimenti.sql
.\pg_run.ps1 -Db a10k -N 10000                                         # ~3 min
dropdb -U postgres a10k                                               # alla fine
```

Prova di carico con 3 milioni di articoli (circa 5 minuti e 3 GB in più):

```powershell
createdb -U postgres a3m
psql -U postgres -d a3m -v N=3000000 -v ON_ERROR_STOP=1 -f pg_gen.sql
.\pg_run.ps1 -Db a3m -N 3000000
dropdb -U postgres a3m
```

Prima della prova conviene impostare in `postgresql.conf` gli stessi valori usati sul Mac: `shared_buffers = 128MB` (256MB per la prova di carico), `effective_cache_size = 1GB`, `work_mem = 8MB`, `maintenance_work_mem = 128MB`, `max_connections = 30`. Poi si riavvia il servizio.

## SQLite

```sh
python3 sqlite_bench.py gen s3m.db 3000000
python3 sqlite_bench.py run s3m.db 3000000
```

## Come leggere i risultati

`lat_ms` è il tempo medio di un'operazione, `tps` o `ops/s` quante se ne fanno al secondo. La riga "concorrenza" simula 8 utenti con il mix 45% scansioni, 15% elenchi, 10% ricerche, 10% storico, 15% vendite, 5% nuovi articoli. I tempi del Mac sono nel §5 del documento: §5.1 per il volume reale, §5.2 per la prova di carico.
