// sede/ripristina.js — Rimette nella sede una copia di sicurezza (pacchetto 7.2, architettura-locale.md §8)
//
// Sul PC server, dalla cartella del repository, con i due servizi fermi:
//   Stop-Service desimone-sede, desimone-postgrest
//   $env:PGPASSWORD = "password dell'utente postgres"
//   node sede\ripristina.js E:\CopieDeSimone\desimone-20261104-020000.dump
//   Start-Service desimone-postgrest, desimone-sede
// Opzioni come installa.js: --psql <psql.exe>  --db <nome>  --host <host>  --porta-db <porta>  --dati <cartella dei dati>
//
// Cosa fa: controlla che la copia si legga; si ferma se qualcuno è ancora collegato al database; salva il database
// com'è adesso in prima-del-ripristino-AAAAMMGG-HHMMSS.dump, accanto alla copia; sostituisce tutto il contenuto del
// database con quello della copia, in una sola transazione (se qualcosa va storto non cambia niente); rimette le foto
// che mancano dalla cartella foto accanto alla copia. Account, giacenze, movimenti e migrazioni applicate tornano
// quelli del momento della copia: ciò che è stato fatto dopo si perde, ma resta in prima-del-ripristino-….dump, che
// si rimette con questo stesso script. Se il database è così rovinato che non si può salvare: --senza-copia si
// Su un PC nuovo: prima installa.js (crea database, ruoli e configurazioni), poi questo script.
// Solo moduli di Node.js (REQ-003).

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const argv = process.argv.slice(2)
const args = {}
const files = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i]
  else files.push(argv[i])
}

const WINDOWS = process.platform === 'win32'
const DB = args.db || 'desimone'
const HOST = args.host || 'localhost'
const DB_PORT = args['porta-db'] || '5432'
const DATA_DIR = path.resolve(args.dati || (WINDOWS ? 'C:\\DeSimone\\dati' : 'sede-dati'))
const PSQL = args.psql || findPsql()
const PG_RESTORE = path.join(path.dirname(PSQL), WINDOWS ? 'pg_restore.exe' : 'pg_restore')
const PG_DUMP = path.join(path.dirname(PSQL), WINDOWS ? 'pg_dump.exe' : 'pg_dump')

const stamp = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
  '-' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join('')

function findPsql() {
  if (!WINDOWS) return 'psql'
  for (const v of ['17', '16']) {
    const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`
    if (fs.existsSync(p)) return p
  }
  return 'psql.exe'
}

const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
delete env.PGOPTIONS
const conn = ['-h', HOST, '-p', DB_PORT, '-U', 'postgres']
const exec = (file, a) => execFileSync(file, a, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const query = sql => exec(PSQL, ['-X', '-q', '-tA', ...conn, '-d', DB, '-c', sql]).trim()
const lines = sql => query(sql).split(/\r?\n/).filter(Boolean)   // psql su Windows risponde con \r\n

function fail(msg) {
  console.error(`\nERRORE: ${msg}`)
  process.exit(1)
}

function main() {
  const file = files[0] && path.resolve(files[0])
  if (!file || !fs.existsSync(file)) fail('indica la copia da rimettere: node sede\\ripristina.js <file .dump>')
  console.log(`Gestionale De Simone — ripristino di una copia di sicurezza\nCopia: ${file}\nDatabase: ${DB} su ${HOST}:${DB_PORT}`)

  let list
  try {
    list = exec(PG_RESTORE, ['--list', file])
  } catch (e) {
    fail(`la copia non si legge: ${(e.stderr || e.message).trim()}`)
  }
  if (!list.includes('TABLE DATA public movements')) fail('il file non è una copia del gestionale (mancano i movimenti)')

  try {
    const others = Number(query(`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`))
    if (others && args.forza !== 'si') {
      fail(`${others} collegamenti al database sono ancora aperti: ferma prima i servizi ` +
        '(Stop-Service desimone-sede, desimone-postgrest). Per andare avanti lo stesso: --forza si')
    }
  } catch (e) {
    if (e.status === undefined) throw e
    fail(`collegamento a PostgreSQL non riuscito (PGPASSWORD? database "${DB}" creato da installa.js?): ${(e.stderr || e.message).trim()}`)
  }

  // Prima di sovrascrivere, il database com'è adesso: se la copia rimessa era quella sbagliata, o il lavoro fatto
  // dopo serviva, si torna qui. Sta accanto alla copia; la conservazione della copia notturna non la tocca.
  let before = null
  if (args['senza-copia'] !== 'si') {
    before = path.join(path.dirname(file), `prima-del-ripristino-${stamp(new Date())}.dump`)
    process.stdout.write('\nSalvo il database com\'è adesso … ')
    try {
      exec(PG_DUMP, [...conn, '-d', DB, '-Fc', '-f', `${before}.tmp`])
      if (!exec(PG_RESTORE, ['--list', `${before}.tmp`]).includes('TABLE DATA public movements')) {
        throw new Error('la copia non contiene i movimenti')
      }
      fs.renameSync(`${before}.tmp`, before)
    } catch (e) {
      try { fs.rmSync(`${before}.tmp`, { force: true }) } catch {}
      fail(`non sono riuscito a salvare il database di adesso, quindi non ho toccato niente:\n${(e.stderr || e.message).trim()}\n` +
        'Se il database è così rovinato che non si può salvare: --senza-copia si')
    }
    console.log(`fatto\n  ${before}`)
  }

  // Permessi predefiniti. La copia scrive i permessi di ogni oggetto come differenza da quelli di fabbrica, e alla
  // fine rimette i propri permessi predefiniti (ALTER DEFAULT PRIVILEGES). Ma gli oggetti ricreati prendono i
  // predefiniti del database di adesso: quelli della base della sede (tutto ad authenticated) e della 032 (niente a
  // PUBLIC). Così authenticated potrebbe eseguire funzioni che gli erano negate (item_retire, sede_login) e nessuno
  // potrebbe usare auth.uid(). Quindi durante il ripristino valgono i predefiniti di fabbrica; se il ripristino non
  // riesce si rimettono quelli di prima.
  const kind = `CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
    WHEN 'T' THEN 'TYPES' ELSE 'SCHEMAS' END`
  const saved = lines(`
    SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres %s GRANT %s ON %s TO %s',
      CASE WHEN d.defaclnamespace <> 0 THEN 'IN SCHEMA ' || quote_ident(d.defaclnamespace::regnamespace::text) ELSE '' END,
      a.privs, ${kind}, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(a.grantee::regrole::text) END)
    FROM pg_default_acl d
    CROSS JOIN LATERAL (SELECT grantee, string_agg(privilege_type, ', ') AS privs FROM aclexplode(d.defaclacl)
                        WHERE grantee <> d.defaclrole GROUP BY grantee) a
    WHERE d.defaclrole = 'postgres'::regrole
    UNION ALL
    SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE %s ON %s FROM PUBLIC',
      CASE d.defaclobjtype WHEN 'f' THEN 'EXECUTE' ELSE 'USAGE' END, ${kind})
    FROM pg_default_acl d
    WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype IN ('f', 'T')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) WHERE grantee = 0)`)
  const reset = `DO $$ DECLARE r record; g oid; BEGIN
    FOR r IN SELECT d.*, CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
               WHEN 'T' THEN 'TYPES' ELSE 'SCHEMAS' END AS kind
             FROM pg_default_acl d WHERE d.defaclrole = 'postgres'::regrole LOOP
      FOR g IN SELECT DISTINCT grantee FROM aclexplode(r.defaclacl) WHERE grantee <> r.defaclrole LOOP
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres %s REVOKE ALL ON %s FROM %s',
          CASE WHEN r.defaclnamespace <> 0 THEN 'IN SCHEMA ' || quote_ident(r.defaclnamespace::regnamespace::text) ELSE '' END,
          r.kind, CASE WHEN g = 0 THEN 'PUBLIC' ELSE quote_ident(g::regrole::text) END);
      END LOOP;
      IF r.defaclnamespace = 0 AND r.defaclobjtype IN ('f', 'T') THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT %s ON %s TO PUBLIC',
          CASE r.defaclobjtype WHEN 'f' THEN 'EXECUTE' ELSE 'USAGE' END, r.kind);
      END IF;
    END LOOP;
  END $$`

  process.stdout.write('\nRimetto il database … ')
  let error = null
  try {
    query(reset)
    exec(PG_RESTORE, [...conn, '-d', DB, '--clean', '--if-exists', '--single-transaction', '--exit-on-error', file])
  } catch (e) {
    error = e
    for (const sql of saved) query(sql)   // la transazione del ripristino è annullata: si torna a com'era
  }
  if (error) fail(`ripristino non riuscito, il database non è cambiato:\n${(error.stderr || error.message).trim()}`)
  console.log('fatto')
  console.log(`  migrazioni nella copia: ${query('SELECT count(*) FROM sede.migrazioni')}, ` +
    `articoli: ${query('SELECT count(*) FROM articles')}, movimenti: ${query('SELECT count(*) FROM movements')}`)

  // Le foto che mancano, dalla cartella foto della copia
  const from = path.join(path.dirname(file), 'foto')
  const to = path.join(DATA_DIR, 'foto')
  let added = 0
  if (fs.existsSync(from)) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue
      const src = path.join(entry.parentPath ?? entry.path, entry.name)
      const dst = path.join(to, path.relative(from, src))
      if (fs.existsSync(dst)) continue
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      added++
    }
  }
  console.log(`Foto rimesse: ${added} (in ${to})`)
  console.log('\nFatto. Rilancia installa.js se la copia è di una versione più vecchia, poi riavvia i servizi.')
  if (before) console.log(`Per tornare a com'era prima del ripristino: node sede\\ripristina.js "${before}"`)
}

main()
