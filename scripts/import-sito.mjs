// scripts/import-sito.mjs — Importa il catalogo di antoninodesimone.it nel catalogo "montato"
//
// Anteprima (non scrive nulla):
//   node scripts/import-sito.mjs --preview anteprima.json
// Import reale (serve la secret key di Supabase in .env.local, mai committata):
//   node --env-file=.env.local scripts/import-sito.mjs --import
//
// Fonte: WooCommerce Store API pubblica del sito. Lo SKU è il codice originale del sito.
// Rilanciabile: salta collezioni, articoli (per SKU) e foto già presenti.

import { readFileSync, writeFileSync } from 'node:fs'

const SITE = 'https://www.antoninodesimone.it/wp-json/wc/store/v1'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'

// [categoria sul sito, nome collezione, codice 4 lettere, colore] — codice e colore come li salva catalog.js
const COLLECTIONS = [
  ['bows-nodi-damore', "Bows – Nodi d'amore", 'BOWS', '#E8A898'],
  ['linea-colourful', 'Colourful', 'COLR', '#E8A898'],
  ['linea-sirena', 'Sirena', 'SIRE', '#B8B4AE'],
  ['linea-intreccio', 'Intreccio', 'INTR', '#C94030'],
  ['linea-abbraccio', 'Abbraccio', 'ABBR', '#E8A898'],
  ['linea-amo', 'Amo', 'LAMO', '#C9A84C'],
  ['amuletum', 'Amuletum', 'AMUL', '#A8331F'],
  ['bomboniere', 'Bomboniere', 'BOMB', '#D4C4B8'],
  ['bracciali-in-pelle', 'Bracciali in Pelle', 'PELL', '#2A2620'],
  ['linea-classic', 'Classic', 'CLAS', '#A8331F'],
  ['pink-talisman', 'Pink Talisman', 'PINK', '#E8A898'],
  ['linea-fantasy', 'Fantasy', 'FANT', '#C94030'],
  ['quadretti', 'Quadretti', 'QUAD', '#C9A84C'],
  ['segni-zodiacali', 'Segni Zodiacali', 'ZODI', '#C9A84C'],
  ['linea-ghiande', 'Ghiande', 'GHIA', '#A8331F'],
  ['linea-sposa', 'Sposa', 'SPOS', '#D4C4B8'],
  ['living-coral', 'Living Coral', 'LIVC', '#C94030'],
  ['tribali', 'Tribali', 'TRIB', '#A8331F'],
  ['linea-cielo-stellato', 'Cielo Stellato', 'CIEL', '#B8B4AE'],
  ['linea-fiocchi-di-neve', 'Fiocchi di Neve', 'FIOC', '#B8B4AE'],
  ['linea-inverno', 'Inverno', 'INVE', '#B8B4AE'],
  ['linea-nature', 'Nature', 'NATU', '#A8331F'],
  ['linea-punto-luce', 'Punto Luce', 'PUNT', '#C9A84C'],
  ['trame-di-corallo', 'Trame di Corallo', 'TRAM', '#D4C4B8'],
  ['gemelli-collezione', 'Gemelli', 'GEME', '#2A2620'],
  ['say-my-name', 'Say My Name', 'SAYN', '#C9A84C'],
]

// Materiali: quelli mancanti vengono creati (i codici esistenti vengono dal seed 005)
const MATERIALS = [
  ['CR', 'Corallo Rosso del Mediterraneo', 'coral'],
  ['CS', 'Corallo Rosso Sciacca', 'coral'],
  ['RP', 'Corallo Rosa', 'coral'],
  ['RB', 'Corallo Bianco', 'coral'],
  ['AU', 'Oro Giallo 18k', 'metal'],
  ['AUB', 'Oro Bianco 18k', 'metal'],
  ['AUR', 'Oro Rosa 18k', 'metal'],
  ['AUN', 'Oro Brunito 18k', 'metal'],
  ['AG', 'Argento 925', 'metal'],
  ['AGB', 'Argento Bianco 925', 'metal'],
  ['AGD', 'Argento Dorato 925', 'metal'],
  ['AGR', 'Argento Rosa 925', 'metal'],
]

// ── Parsing ──────────────────────────────────────────────────

const ENTITIES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', euro: '€', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì', deg: '°', times: '×' }
const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)

const htmlToText = h => decode((h || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n')
  .replace(/<[^>]+>/g, ''))
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim()

function cleanName(raw) {
  let s = decode(raw).replace(/\s+/g, ' ').trim()
  if (s !== s.toUpperCase()) return s
  // Nomi TUTTO MAIUSCOLO sul sito → maiuscola iniziale
  s = s.toLowerCase()
  s = s.charAt(0).toUpperCase() + s.slice(1)
  for (const w of ['Pink Talisman', 'Pacifico', 'Mediterraneo', 'Fatima', 'Sciacca', 'Linea']) {
    s = s.replace(new RegExp(`\\b${w}\\b`, 'gi'), w)
  }
  return s
}

// Prima occorrenza (più a sinistra) tra più pattern → valore associato
function firstMatch(text, rules) {
  let best = null
  for (const [re, value] of rules) {
    const m = re.exec(text)
    if (m && (!best || m.index < best.index)) best = { index: m.index, value }
  }
  return best?.value ?? null
}

const TYPE_RULES = [
  [/\b(anell[oi]|fedin[ae]|rings?)\b/, 'anello'],
  [/\b(braccial[ei]|braccialetto|bracelets?)\b/, 'bracciale'],
  [/\b(collan[ae]|collier|girocollo|sautoir|catenina|necklaces?)\b/, 'collana'],
  [/\b(orecchin[oi]|earrings?)\b/, 'orecchini'],
  [/\b(ciondol[oi]|ciodnolo|pendent[ei]|charms?|medaglion[ei]|medagli[ae]|pendants?|amuletum|amulet[oi])\b/, 'ciondolo'],
  [/\b(spill[ae]|fermagli?o|brooch)\b/, 'spilla'],
]
const TYPE_BY_CATEGORY = { anello: 'anello', bracciale: 'bracciale', collane: 'collana', orecchini: 'orecchini', pendente: 'ciondolo', fermaglio: 'spilla' }

const CORAL_RULES = [
  [/sciacca/, 'CS'],
  [/corallo bianco|bianco del pacifico|white (pacific )?coral/, 'RB'],
  [/corallo rosa|rosa del pacifico|pink (pacific )?coral|pacific coral/, 'RP'],
  [/corallo rosso|rosso del mediterraneo|red (mediterranean )?coral|mediterranean coral/, 'CR'],
]
const CORAL_BY_COLOR = { rosso: 'CR', 'rosso medio prima qualità': 'CR', rosa: 'RP', bianco: 'RB', sciacca: 'CS' }

const METAL_RE = /(argento(?: 925)?(?: e)? dorat[oa]|gilded silver|gold[- ]plated silver)|(argento(?: 925)? bianc[oa])|(argento(?: 925)? ros[ae](?:t[oa])?)|(oro bianco|white gold)|(oro rosa|pink gold|rose gold)|(oro brunito)|(oro giallo|yellow gold)|(argento|silver)|(\boro\b|\bgold\b)/
const METAL_CODES = ['AGD', 'AGB', 'AGR', 'AUB', 'AUR', 'AUN', 'AU', 'AG', 'AU']
const METAL_BY_ATTR = { 'oro giallo 18 kt': 'AU', 'oro 18 kt': 'AU', 'oro bianco 18 kt': 'AUB', 'argento 925': 'AG', 'argento bianco 925': 'AGB', 'argento dorato 925': 'AGD', 'argento rosa 925': 'AGR' }

function metalIn(text) {
  const m = METAL_RE.exec(text)
  if (!m) return null
  return METAL_CODES[m.slice(1).findIndex(Boolean)]
}

function pickMetal(candidates) {
  const found = candidates.filter(Boolean)
  if (!found.length) return null
  // Un generico "argento"/"oro" nel nome cede a una variante più precisa trovata altrove
  const [first] = found
  if (first === 'AG') return found.find(c => ['AGB', 'AGD', 'AGR'].includes(c)) || 'AG'
  if (first === 'AU') return found.find(c => ['AUB', 'AUR', 'AUN'].includes(c)) || 'AU'
  return first
}

const num = s => Number(String(s).replace(',', '.'))

function parseMeasurements(desc, taglia, type) {
  const t = desc.toLowerCase()
  const out = {}
  const len = /lunghezza(?:\s+(?:totale|complessiva|regolabile|massima))?\s*(?:è\s*)?:?\s*(?:di\s*)?(?:circa\s*)?(cm|mm)?\.?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?/.exec(t)
  if (len) {
    const unit = len[1] || len[3] || 'cm'
    const v = num(len[2]) / (unit === 'mm' ? 10 : 1)
    if (v > 0.3 && v < 200) out.length_cm = Math.round(v * 10) / 10
  }
  if (!out.length_cm && taglia && ['collana', 'bracciale'].includes(type)) {
    const m = /^(\d+(?:[.,]\d+)?)\s*cm$/.exec(taglia.trim())
    if (m) out.length_cm = num(m[1])
  }
  const wt = /\bpes(?:o|a|ano)\b(?:\s+(?:circa|totale|complessivo|medio))*\s*:?\s*(?:di\s*)?(?:circa\s*)?(?:gr|g|grammi)?\.?\s*(\d+(?:[.,]\d+)?)/.exec(t)
  if (wt) {
    const v = num(wt[1])
    if (v > 0.1 && v < 1000) out.weight_g = v
  }
  return Object.keys(out).length ? out : null
}

function pickImage(p) {
  const img = p.images?.[0]
  if (!img) return null
  const entries = (img.srcset || '').split(/,\s+(?=https?:)/).map(e => {
    const m = /^(\S.*\S)\s+(\d+)w$/.exec(e.trim())
    return m ? { url: m[1], w: Number(m[2]) } : null
  }).filter(Boolean)
  // ~1024px: buona qualità per il catalogo senza caricare gli originali da 2-3 MB
  const good = entries.filter(e => e.w <= 1200).sort((a, b) => b.w - a.w)[0]
  return good?.url || img.src
}

function transform(p, { collectionSlug, enBySku, enOnly }) {
  const en = enOnly ? p : enBySku.get(p.sku)
  const name = cleanName(p.name)
  const lname = name.toLowerCase()
  const desc = htmlToText(p.description)
  const ldesc = desc.toLowerCase()
  const attr = n => p.attributes.find(a => a.name === n)?.terms.map(t => decode(t.name)) || []

  const catSlugs = p.categories.map(c => c.slug)
  const product_type = firstMatch(lname, TYPE_RULES)
    || catSlugs.map(s => TYPE_BY_CATEGORY[s]).find(Boolean)
    || 'altro'

  const color = attr('Colore')[0]?.toLowerCase()
  const coral = firstMatch(lname, CORAL_RULES) || firstMatch(ldesc, CORAL_RULES)
    || (/\bcorall[oi]\b|\bcoral\b/.test(lname + ' ' + ldesc) ? (CORAL_BY_COLOR[color] || 'CR') : null)

  const metal = pickMetal([metalIn(lname), metalIn(ldesc), METAL_BY_ATTR[attr('Metallo')[0]?.toLowerCase()]])

  const taglia = attr('Taglia')[0] || null
  const minor = p.prices.currency_minor_unit ?? 2
  const price = Number(p.prices.price) / 10 ** minor
  const stock = Number(/(\d+)\s+(?:disponibil|in stock)/i.exec(p.stock_availability?.text || '')?.[1] || 0)

  const notes = [
    `Fonte: ${p.permalink}`,
    taglia && `Taglia: ${taglia}`,
    p.type === 'variable' && 'Prodotto con varianti sul sito: il prezzo è quello base.',
    enOnly && 'Presente solo sul sito in inglese.',
  ].filter(Boolean).join('\n')

  return {
    collectionSlug,
    sku: p.sku.trim(),
    name,
    product_type,
    coral,
    metal,
    price_retail: price > 0 ? price : null,
    stock_retail: stock,
    description_it: enOnly ? null : desc || null,
    description_en: en ? htmlToText(en.description) || null : null,
    measurements: parseMeasurements(enOnly ? '' : desc, taglia, product_type),
    notes,
    image: pickImage(p),
  }
}

// ── Scarico dal sito ─────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function siteGet(url) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) return { data: await res.json(), pages: Number(res.headers.get('x-wp-totalpages') || 1) }
    if (i === 2) throw new Error(`${res.status} ${url}`)
    await sleep(2000)
  }
}

async function siteProducts(catId, lang) {
  const out = []
  for (let page = 1; ; page++) {
    const { data, pages } = await siteGet(`${SITE}/products?category=${catId}&per_page=100&page=${page}${lang ? `&lang=${lang}` : ''}`)
    out.push(...data)
    await sleep(300)
    if (page >= pages) return out
  }
}

async function loadCatalog() {
  const cats = (await siteGet(`${SITE}/products/categories?per_page=100`)).data
  const articles = []
  const seen = new Set()
  const report = { shared: [], enOnly: [] }
  for (const [slug] of COLLECTIONS) {
    const cat = cats.find(c => c.slug === slug)
    if (!cat) throw new Error(`Categoria non trovata sul sito: ${slug}`)
    const it = await siteProducts(cat.id)
    const en = await siteProducts(cat.id, 'en')
    const enBySku = new Map(en.filter(p => p.sku).map(p => [p.sku.trim(), p]))
    // Se la pagina italiana è vuota (es. Tribali) si usano i prodotti della versione inglese
    const enOnly = it.length === 0 && en.length > 0
    for (const p of enOnly ? en : it) {
      const sku = p.sku?.trim()
      if (!sku) throw new Error(`Prodotto senza codice: ${p.permalink}`)
      // Un prodotto in più collezioni va nella prima della lista
      if (seen.has(sku)) { report.shared.push(`${sku} (resta nella prima collezione, presente anche in ${slug})`); continue }
      seen.add(sku)
      if (enOnly) report.enOnly.push(sku)
      articles.push(transform(p, { collectionSlug: slug, enBySku, enOnly }))
    }
    console.log(`${slug.padEnd(24)} ${String(enOnly ? en.length : it.length).padStart(3)} prodotti${enOnly ? ' (solo EN)' : ''}`)
  }
  return { articles, report }
}

// ── Supabase ─────────────────────────────────────────────────

const SUPABASE_URL = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(readFileSync(new URL('../config.js', import.meta.url), 'utf8'))[1]
const KEY = process.env.SUPABASE_SECRET_KEY

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function uploadImage(article) {
  const img = await fetch(article.image, { headers: { 'User-Agent': UA } })
  if (!img.ok) throw new Error(`immagine ${img.status} ${article.image}`)
  const type = img.headers.get('content-type') || 'image/jpeg'
  const ext = { 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg'
  const path = `processed/${article.id}/${article.sku.replace(/[^A-Za-z0-9_-]/g, '_')}.${ext}`
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': type, 'x-upsert': 'true' },
    body: Buffer.from(await img.arrayBuffer()),
  })
  if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`)
  await rest('POST', 'photos', {
    article_id: article.id,
    storage_path: path,
    public_url: `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`,
    photo_type: 'processed',
    is_cover: true,
    sort_order: 0,
    processing_status: 'done',
    processed_at: new Date().toISOString(),
  })
}

async function importToSupabase(articles) {
  if (!KEY) throw new Error('Manca SUPABASE_SECRET_KEY (usa: node --env-file=.env.local scripts/import-sito.mjs --import)')

  // Sicurezza: il DB deve contenere solo dati di questo import (eseguire prima la pulizia)
  const ourSlugs = new Map(COLLECTIONS.map(([site, name, code, color]) => {
    const slug = `${code.toLowerCase()}-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
    return [site, { name, slug, code, color }]
  }))
  const existingColl = await rest('GET', 'collections?select=id,slug')
  const foreign = existingColl.filter(c => ![...ourSlugs.values()].some(o => o.slug === c.slug))
  const existingArt = await rest('GET', 'articles?select=id,sku')
  const skus = new Set(articles.map(a => a.sku))
  const foreignArt = existingArt.filter(a => !skus.has(a.sku))
  if (foreign.length || foreignArt.length) {
    throw new Error(`Nel database ci sono ${foreign.length} collezioni e ${foreignArt.length} articoli non di questo import. Esegui prima supabase/pulizia_catalogo.sql`)
  }

  // Materiali
  const mats = await rest('GET', 'materials?select=id,code')
  const missing = MATERIALS.filter(([code]) => !mats.some(m => m.code === code))
  if (missing.length) mats.push(...await rest('POST', 'materials', missing.map(([code, name, type]) => ({ code, name, type }))))
  const matId = Object.fromEntries(mats.map(m => [m.code, m.id]))
  console.log(`Materiali: ${missing.length} creati`)

  // Collezioni
  const collId = Object.fromEntries(existingColl.map(c => [c.slug, c.id]))
  const newColls = COLLECTIONS.map(([site], i) => ({ ...ourSlugs.get(site), sort_order: i + 1 }))
    .filter(c => !collId[c.slug])
    .map(c => ({ name: c.name, slug: c.slug, channel: 'both', sort_order: c.sort_order, description_it: c.code, description_en: c.color }))
  if (newColls.length) for (const c of await rest('POST', 'collections', newColls)) collId[c.slug] = c.id
  console.log(`Collezioni: ${newColls.length} create`)

  // Articoli
  const artId = Object.fromEntries(existingArt.map(a => [a.sku, a.id]))
  const toInsert = articles.filter(a => !artId[a.sku]).map(a => ({
    collection_id: collId[ourSlugs.get(a.collectionSlug).slug],
    name: a.name,
    product_type: a.product_type,
    coral_material_id: a.coral ? matId[a.coral] : null,
    metal_material_id: a.metal ? matId[a.metal] : null,
    sku: a.sku,
    price_retail: a.price_retail,
    stock_retail: a.stock_retail,
    channel: 'both',
    status: 'published',
    description_it: a.description_it,
    description_en: a.description_en,
    measurements: a.measurements,
    notes: a.notes,
  }))
  for (let i = 0; i < toInsert.length; i += 50) {
    for (const r of await rest('POST', 'articles', toInsert.slice(i, i + 50))) artId[r.sku] = r.id
  }
  console.log(`Articoli: ${toInsert.length} creati`)

  // Foto di copertina
  const withPhoto = new Set((await rest('GET', 'photos?select=article_id')).map(p => p.article_id))
  const queue = articles.filter(a => a.image && !withPhoto.has(artId[a.sku])).map(a => ({ ...a, id: artId[a.sku] }))
  const errors = []
  let done = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let a; (a = queue.shift());) {
      try { await uploadImage(a) } catch (e) { errors.push(`${a.sku}: ${e.message}`) }
      if (++done % 25 === 0) console.log(`  foto ${done}…`)
    }
  }))
  console.log(`Foto: ${done - errors.length} caricate, ${errors.length} errori`)
  errors.forEach(e => console.log('  ✗', e))
}

// ── Main ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const { articles, report } = await loadCatalog()
console.log(`\nTotale: ${articles.length} articoli`)
report.shared.forEach(s => console.log('  condiviso:', s))
if (report.enOnly.length) console.log('  solo sito EN:', report.enOnly.join(', '))

const previewPath = args[args.indexOf('--preview') + 1]
if (args.includes('--preview') && previewPath) {
  writeFileSync(previewPath, JSON.stringify(articles, null, 1))
  console.log(`Anteprima scritta in ${previewPath}`)
}
if (args.includes('--import')) await importToSupabase(articles)
