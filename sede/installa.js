// sede/installa.js — Installa o aggiorna il gestionale sul PC server (WBA v0.5: P-05, P-06, P-07, P-09)
//
// Cosa fa, e si può rilanciare quante volte si vuole (a ogni nuova versione, L-14):
//   1. crea il database "desimone" se manca
//   2. applica le migrazioni che mancano, in ordine: sede/database/00_base_sede.sql, supabase/migrations
//      (tranne la 008, solo sviluppo), sede/database/90_accessi_sede.sql; quelle già applicate sono in
//      sede.migrazioni e non si ripetono
//   3. imposta PostgreSQL per un PC con 4 GB (D-1): vale dal prossimo riavvio del servizio di PostgreSQL
//   4. genera, solo la prima volta, la password di PostgREST e il segreto dei token; prepara il ruolo in sola lettura
//      della copia di sicurezza (sede/servizio/copia.js)
//   5. scrive nella cartella dei dati postgrest.conf, sede.json e i file di WinSW per i due servizi
//   6. se non c'è ancora nessun account, crea il primo amministratore
//
// Uso (PowerShell, dalla cartella del repository):
//   $env:PGPASSWORD = "password dell'utente postgres scelta installando PostgreSQL"
//   node sede\installa.js --dati C:\DeSimone\dati
// Opzioni: --psql <percorso di psql.exe>  --db <nome>  --host <host>  --porta-db <porta>  --porta <porta dell'app>
//          --copia <cartella della copia di sicurezza, su un disco dedicato: resta per i giri successivi>
// Solo moduli di Node.js (REQ-003).

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const readline = require('node:readline')
const { execFileSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) =>
  a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]] : acc, []))

const WINDOWS = process.platform === 'win32'
const DATA_DIR = path.resolve(args.dati || (WINDOWS ? 'C:\\DeSimone\\dati' : path.join(REPO, 'sede-dati')))
const DB = args.db || 'desimone'
const HOST = args.host || 'localhost'
const DB_PORT = args['porta-db'] || '5432'
const APP_PORT = Number(args.porta || 8080)
const PSQL = args.psql || findPsql()

function findPsql() {
  if (!WINDOWS) return 'psql'
  for (const v of ['17', '16']) {
    const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`
    if (fs.existsSync(p)) return p
  }
  return 'psql.exe'
}

const step = msg => console.log(`\n▸ ${msg}`)

// psql come utente postgres; testo sempre in UTF-8, anche su Windows (descrizioni con accenti)
function psql(database, extra) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', DB_PORT, '-U', 'postgres', '-d', database, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
const query = (database, sql) => psql(database, ['-tA', '-c', sql]).trim()
const runFile = (database, file) => psql(database, ['-f', file])
const literal = s => `'${String(s).replace(/'/g, "''")}'`

// Valori generati una volta e conservati nella cartella dei dati (mai nel repository)
function secret(name) {
  const file = path.join(DATA_DIR, 'segreti', name)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 })
  }
  return fs.readFileSync(file, 'utf8').trim()
}

// Domande una per volta, anche con le risposte già pronte in ingresso; la password non si vede sullo schermo
function prompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
  const lines = rl[Symbol.asyncIterator]()
  let muted = false
  rl._writeToOutput = text => { if (!muted) process.stdout.write(text) }
  const ask = async (question, { hidden = false } = {}) => {
    process.stdout.write(question)
    muted = hidden
    const { value, done } = await lines.next()
    muted = false
    if (hidden || !process.stdin.isTTY) process.stdout.write('\n')
    if (done) throw new Error('Risposte finite: rilancia l\'installazione e rispondi alle domande')
    return value
  }
  ask.close = () => rl.close()
  return ask
}

function migrations() {
  const list = [['sede/00_base_sede.sql', path.join(REPO, 'sede', 'database', '00_base_sede.sql')]]
  const dir = path.join(REPO, 'supabase', 'migrations')
  for (const f of fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    if (f.startsWith('008_')) continue   // spegneva la sicurezza solo in sviluppo
    list.push([`supabase/${f}`, path.join(dir, f)])
  }
  for (const f of fs.readdirSync(path.join(REPO, 'sede', 'database')).filter(f => /^9\d_.*\.sql$/.test(f)).sort()) {
    list.push([`sede/${f}`, path.join(REPO, 'sede', 'database', f)])
  }
  return list
}

async function main() {
  console.log(`Gestionale De Simone — installazione nella sede\nRepository: ${REPO}\nDati: ${DATA_DIR}\npsql: ${PSQL}`)
  fs.mkdirSync(DATA_DIR, { recursive: true })

  step('Collegamento a PostgreSQL')
  console.log(query('postgres', 'SELECT version()'))

  step(`Database "${DB}"`)
  if (query('postgres', `SELECT 1 FROM pg_database WHERE datname = ${literal(DB)}`) !== '1') {
    query('postgres', `CREATE DATABASE "${DB}" ENCODING 'UTF8' TEMPLATE template0`)
    console.log('creato')
  } else console.log('già presente')

  step('Migrazioni')
  const applied = new Set(query(DB, "SELECT to_regclass('sede.migrazioni') IS NOT NULL") === 't'
    ? query(DB, 'SELECT nome FROM sede.migrazioni').split(/\r?\n/).filter(Boolean) : [])   // psql su Windows: \r\n
  let count = 0
  for (const [name, file] of migrations()) {
    if (applied.has(name)) continue
    process.stdout.write(`  ${name} … `)
    runFile(DB, file)
    query(DB, `INSERT INTO sede.migrazioni (nome) VALUES (${literal(name)})`)
    console.log('ok')
    count++
  }
  console.log(count ? `${count} applicate` : 'niente da applicare: il database è aggiornato')

  step('PostgreSQL per 4 GB di RAM (D-1)')
  const settings = {
    shared_buffers: '256MB', effective_cache_size: '1536MB', work_mem: '16MB', maintenance_work_mem: '128MB',
    max_connections: '30', synchronous_commit: 'on', fsync: 'on', full_page_writes: 'on',   // REQ-E-04
  }
  for (const [k, v] of Object.entries(settings)) query(DB, `ALTER SYSTEM SET ${k} = ${literal(v)}`)
  console.log('impostato: vale dal prossimo riavvio del servizio di PostgreSQL (o del PC)')

  step('Ruolo di PostgREST e segreto dei token')
  const dbPassword = secret('postgrest-db-password')
  const jwtSecret = secret('jwt-secret')
  query(DB, `ALTER ROLE authenticator WITH LOGIN PASSWORD ${literal(dbPassword)}`)
  console.log('fatto (in segreti\\ dentro la cartella dei dati)')

  // Copia di sicurezza (7.2): legge tutto, righe protette comprese, e non scrive niente
  step('Ruolo della copia di sicurezza')
  const copyPassword = secret('copia-db-password')
  query(DB, "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copia') THEN CREATE ROLE copia; END IF; END $$")
  query(DB, `ALTER ROLE copia WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(copyPassword)}`)
  query(DB, 'GRANT pg_read_all_data TO copia')
  console.log('fatto')

  step('Configurazioni')
  const photoDir = path.join(DATA_DIR, 'foto')
  fs.mkdirSync(photoDir, { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'log'), { recursive: true })
  const postgrestConf = path.join(DATA_DIR, 'postgrest.conf')
  fs.writeFileSync(postgrestConf, [
    '# Generato da sede/installa.js — PostgREST (P-06): solo su localhost, lo raggiunge il servizio della sede',
    `db-uri = "postgres://authenticator:${dbPassword}@${HOST}:${DB_PORT}/${DB}"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-pool = 10',
    `jwt-secret = "${jwtSecret}"`,
    'server-host = "127.0.0.1"',
    'server-port = 3000',
    '',
  ].join('\n'), { mode: 0o600 })
  const sedeJson = path.join(DATA_DIR, 'sede.json')
  const previous = fs.existsSync(sedeJson) ? JSON.parse(fs.readFileSync(sedeJson, 'utf8')) : {}
  fs.writeFileSync(sedeJson, JSON.stringify({
    porta: APP_PORT,
    indirizzo: previous.indirizzo || '127.0.0.1',
    https: previous.https || null,
    postgrest: 'http://127.0.0.1:3000',
    segretoToken: jwtSecret,
    cartellaApp: REPO,
    cartellaFoto: photoDir,
    durataSessioneOre: previous.durataSessioneOre || 12,
    // Copia di sicurezza: la cartella si sceglie con --copia e resta; senza, si usa quella dentro i dati, che
    // la pagina segnala come "stesso disco" finché non se ne indica una su un disco dedicato
    pgBin: path.dirname(PSQL),
    database: { host: HOST, porta: Number(DB_PORT), nome: DB },
    segretoCopia: copyPassword,
    copia: {
      cartella: args.copia ? path.resolve(args.copia) : previous.copia?.cartella || path.join(DATA_DIR, 'copie'),
      ora: previous.copia?.ora || '02:00',
      giorni: previous.copia?.giorni || 30,
      mesi: previous.copia?.mesi || 12,
    },
  }, null, 2) + '\n', { mode: 0o600 })
  console.log(`copia di sicurezza ogni notte alle ${previous.copia?.ora || '02:00'} in ` +
    (args.copia ? path.resolve(args.copia) : previous.copia?.cartella || path.join(DATA_DIR, 'copie')))
  for (const name of ['servizio-postgrest', 'servizio-sede']) {
    const xml = fs.readFileSync(path.join(REPO, 'sede', 'winsw', `${name}.xml`), 'utf8')
      .replaceAll('{DATI}', DATA_DIR).replaceAll('{REPO}', REPO).replaceAll('{NODE}', process.execPath)
      .replaceAll('{PGBIN}', path.dirname(PSQL))
    fs.writeFileSync(path.join(DATA_DIR, `${name}.xml`), xml)
  }
  console.log(`scritti in ${DATA_DIR}: postgrest.conf, sede.json, servizio-postgrest.xml, servizio-sede.xml`)

  step('Account')
  const users = Number(query(DB, 'SELECT count(*) FROM auth.users'))
  if (users) console.log(`${users} account già presenti`)
  else {
    console.log('Nessun account: crea il primo amministratore.')
    const ask = prompter()
    const name = (await ask('  Nome (come compare nei movimenti): ')).trim()
    const email = (await ask('  Email: ')).trim()
    const password = await ask('  Password (almeno 8 caratteri, non si vede mentre la scrivi): ', { hidden: true })
    ask.close()
    query(DB, `SELECT auth.crea_utente(${literal(email)}, ${literal(password)}, ${literal(name)}, 'admin')`)
    console.log(`  creato ${email} (amministrazione)`)
  }

  console.log(`\nFatto. Prossimi passi in sede/README.md: servizi con WinSW, poi http://localhost:${APP_PORT}`)
}

main().catch(err => {
  console.error(`\nERRORE: ${(err.stderr || err.message || err).toString().trim()}`)
  process.exit(1)
})
