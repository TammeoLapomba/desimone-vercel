// sede/importa-catalogo.js — Carica nella sede il catalogo del sito (gioielli, "montato"), senza internet
//
// Il catalogo si scarica su un PC con internet, con l'anteprima di scripts/import-sito.mjs (non scrive niente):
//   node scripts/import-sito.mjs --preview catalogo.json
// e si porta sul PC server (chiavetta, cartella condivisa). Lì, dalla cartella del repository:
//   $env:PGPASSWORD = "password dell'utente postgres"
//   node sede\importa-catalogo.js catalogo.json
// Opzioni: --psql <percorso di psql.exe>  --db <nome>  --host <host>  --porta-db <porta>
//
// Si può rilanciare quante volte si vuole, per esempio con un catalogo più nuovo:
//   - crea le collezioni e gli articoli che mancano (per SKU, il codice del sito), con i loro materiali;
//   - completa il peso di un pezzo degli articoli che non ce l'hanno (028: senza peso un gioiello non si carica);
//   - non cambia niente di ciò che c'è già: un articolo modificato nella sede resta com'è, e un peso scritto nella
//     scheda vale più di quello del sito.
// La giacenza non si importa: nella sede nasce dai carichi (REQ-001). Le foto non ci sono ancora.
// Solo moduli di Node.js (REQ-003). Serve la migrazione 028 (model_weight): prima si lancia installa.js.

'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

// Opzioni come installa.js; il primo argomento che non è un'opzione è il file del catalogo
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
const PSQL = args.psql || findPsql()

function findPsql() {
  if (!WINDOWS) return 'psql'
  for (const v of ['17', '16']) {
    const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`
    if (fs.existsSync(p)) return p
  }
  return 'psql.exe'
}

// psql come utente postgres; testo sempre in UTF-8, anche su Windows (descrizioni con accenti)
function psql(extra) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', DB_PORT, '-U', 'postgres', '-d', DB, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
// Righe della risposta: psql su Windows risponde con \r\n
const lines = sql => psql(['-tA', '-c', sql]).split(/\r?\n/).filter(Boolean)

function fail(msg) {
  console.error(`\nERRORE: ${msg}`)
  process.exit(1)
}

function readCatalog(file) {
  if (!file) fail('indica il file del catalogo: node sede\\importa-catalogo.js catalogo.json')
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`non riesco a leggere ${file}: ${e.message}`)
  }
  if (!Array.isArray(data) || !data.length || !data.every(a => a.sku && a.name)) {
    fail(`${file} non è un catalogo: serve l'anteprima di scripts/import-sito.mjs --preview`)
  }
  const old = data.filter(a => !a.collection?.slug)
  if (old.length) fail(`${file} è un'anteprima vecchia, senza le collezioni: rifalla con scripts/import-sito.mjs --preview`)
  const untyped = data.filter(a => !a.product_type)
  if (untyped.length) fail(`tipo prodotto non riconosciuto per: ${untyped.map(a => a.sku).join(', ')}`)
  return data
}

// I codici del catalogo devono esistere nelle anagrafiche della sede (migrazioni 014 e 015)
function checkCodes(catalog) {
  const have = sql => new Set(lines(sql))
  const types = have('SELECT slug FROM product_types')
  const materials = have('SELECT code FROM materials')
  const metals = have('SELECT code FROM metals')
  const missing = new Set()
  for (const a of catalog) {
    if (!types.has(a.product_type)) missing.add(`tipo ${a.product_type}`)
    if (a.metal && !metals.has(a.metal)) missing.add(`metallo ${a.metal}`)
    for (const m of a.materials || []) if (!materials.has(m)) missing.add(`materiale ${m}`)
  }
  if (missing.size) fail(`codici che la sede non conosce: ${[...missing].join(', ')}. Aggiorna prima con installa.js`)
}

function main() {
  console.log(`Gestionale De Simone — catalogo del sito nella sede\nDatabase: ${DB} su ${HOST}:${DB_PORT}\npsql: ${PSQL}`)
  const file = files[0] && path.resolve(files[0])
  const catalog = readCatalog(file)
  console.log(`Catalogo: ${file}, ${catalog.length} articoli`)

  try {
    if (lines("SELECT to_regprocedure('model_weight(jsonb)') IS NOT NULL")[0] !== 't') {
      fail('nel database manca la migrazione 028: lancia prima sede\\installa.js')
    }
    checkCodes(catalog)
  } catch (e) {
    fail(`collegamento a PostgreSQL non riuscito (PGPASSWORD?): ${(e.stderr || e.message).trim()}`)
  }

  const rows = catalog.map(a => ({
    sku: a.sku, name: a.name, type: a.product_type, metal: a.metal || null, materials: a.materials || [],
    price: a.price_retail ?? null, desc_it: a.description_it ?? null, desc_en: a.description_en ?? null,
    measurements: a.measurements ?? null, notes: a.notes ?? null, coll: a.collection,
    weight: a.measurements?.weight_g ?? null,
  }))
  const json = JSON.stringify(rows)
  if (json.includes('$catalogo$')) fail('il catalogo contiene $catalogo$: non si può caricare così')

  // Tutto in una transazione: o entra tutto, o niente
  const sql = `
BEGIN;
CREATE TEMP TABLE imp ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($catalogo$${json}$catalogo$::jsonb)
  AS x(sku text, name text, type text, metal text, materials jsonb, price numeric, desc_it text, desc_en text,
       measurements jsonb, notes text, coll jsonb, weight numeric);
CREATE TEMP TABLE coll_nuove (slug text) ON COMMIT DROP;
CREATE TEMP TABLE art_nuovi (id uuid, sku text) ON COMMIT DROP;
CREATE TEMP TABLE pesati (sku text) ON COMMIT DROP;

-- Collezioni che mancano, come le salva l'app: codice in description_it, colore in description_en
WITH ins AS (
  INSERT INTO collections (name, slug, channel, sort_order, description_it, description_en)
  SELECT DISTINCT ON (coll ->> 'slug') coll ->> 'name', coll ->> 'slug', 'both', (coll ->> 'sort_order')::int,
         coll ->> 'code', coll ->> 'color'
  FROM imp
  WHERE NOT EXISTS (SELECT 1 FROM collections c WHERE c.slug = imp.coll ->> 'slug')
  RETURNING slug)
INSERT INTO coll_nuove SELECT slug FROM ins;

-- Articoli che mancano (lo SKU è unico anche tra gli eliminati: un articolo eliminato nella sede non torna)
WITH ins AS (
  INSERT INTO articles (collection_id, name, product_type_id, metal_id, sku, price_retail, channel,
                        description_it, description_en, measurements, notes)
  SELECT c.id, i.name, t.id, m.id, i.sku, i.price, 'both', i.desc_it, i.desc_en, i.measurements, i.notes
  FROM imp i
  JOIN collections c ON c.slug = i.coll ->> 'slug'
  JOIN product_types t ON t.slug = i.type
  LEFT JOIN metals m ON m.code = i.metal
  WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.sku = i.sku)
  RETURNING id, sku)
INSERT INTO art_nuovi SELECT id, sku FROM ins;

-- Materiali degli articoli appena creati, nell'ordine del catalogo
INSERT INTO article_materials (article_id, material_id, sort_order)
SELECT n.id, mt.id, e.ord
FROM art_nuovi n
JOIN imp i ON i.sku = n.sku
CROSS JOIN LATERAL jsonb_array_elements_text(i.materials) WITH ORDINALITY AS e(code, ord)
JOIN materials mt ON mt.code = e.code;

-- Peso di un pezzo per gli articoli che c'erano già e non ce l'hanno; uno scritto nella scheda non si tocca
WITH up AS (
  UPDATE articles a
  SET measurements = coalesce(a.measurements, '{}'::jsonb) || jsonb_build_object('weight_g', i.weight)
  FROM imp i
  WHERE a.sku = i.sku AND i.weight > 0 AND model_weight(a.measurements) IS NULL
    AND NOT EXISTS (SELECT 1 FROM art_nuovi n WHERE n.sku = a.sku)
  RETURNING a.sku)
INSERT INTO pesati SELECT sku FROM up;

SELECT (SELECT count(*) FROM coll_nuove) || '|' || (SELECT count(*) FROM art_nuovi) || '|' ||
       (SELECT count(*) FROM pesati) || '|' ||
       coalesce((SELECT string_agg(a.sku, ', ' ORDER BY a.sku) FROM articles a JOIN imp i ON i.sku = a.sku
                 WHERE a.deleted_at IS NULL AND model_weight(a.measurements) IS NULL), '');
COMMIT;
`
  const tmp = path.join(os.tmpdir(), `catalogo-sede-${process.pid}.sql`)
  fs.writeFileSync(tmp, sql, 'utf8')
  let out
  try {
    out = psql(['-tA', '-f', tmp])
  } catch (e) {
    fail(`il caricamento non è riuscito, nel database non è cambiato niente:\n${(e.stderr || e.message).trim()}`)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  const [colls, created, weighed, noWeight] = out.split(/\r?\n/).filter(Boolean).pop().split('|')
  console.log(`\nCollezioni: ${colls} create`)
  console.log(`Articoli: ${created} creati, ${catalog.length - Number(created)} c'erano già (non toccati)`)
  console.log(`Pesi: ${weighed} completati negli articoli che c'erano già`)
  if (noWeight) {
    const n = noWeight.split(', ').length
    console.log(`\nSenza peso (${n}): non si possono caricare finché il peso di un pezzo non è nella scheda dell'articolo.\n  ${noWeight}`)
  }
  console.log('\nFatto. Le giacenze nascono dai carichi in Movimenti.')
}

main()
