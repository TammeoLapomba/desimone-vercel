// js/giacenze.js — Giacenze per articolo e luogo (fetta 3)
//
// Servizi della BBA: UC-01 consultare le giacenze per articolo e luogo (tutti, REQ-001.1), UC-10 stampare l'elenco
// (amministrazione, REQ-R-01), UC-14 vedere il valore (amministrazione, REQ-M-08; base da decidere). Nella WBA: L-01
// interfaccia, F-13 mostrare le giacenze, F-15 produrre l'elenco (L-11). La giacenza è la somma dei movimenti
// (stock_levels, REQ-C-01) e i permessi li decide il database: qui si mostra solo ciò che il ruolo può fare.
// I filtri sono quelli della scheda 2.5 (REQ-M-28): con un luogo scelto, quantità, totale e valore sono di quel luogo.
// Luoghi, dispositivi, utenti e copia di sicurezza stanno in Impostazioni (scheda 1.5).
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getStockOverview, IN_SEDE, getBackupStatus,
} from './supabase.js'
import { gramsText } from './utils.js'
import { initFilters } from './filters.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
const euro = n => `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}`   // mai il punto delle migliaia
const articles = n => `${num(n)} ${n === 1 ? 'articolo' : 'articoli'}`

const state = {
  operator: null,
  locations: [],
  items: [],       // { kind, id, code, name, group, type, collection, materials, metal, shape, quality, unit, priceRetail, priceWholesale, at: Map location_id → { pieces, grams } }
}
const isAdmin = () => state.operator?.role === 'admin'

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()

  state.operator = await getMyOperator()
  if (!state.operator) {
    return block('Il tuo utente non è ancora abilitato alle giacenze: chiedi all\'amministrazione di aggiungerti agli operatori.')
  }
  $('operatorChip').textContent = `${state.operator.name} · ${ROLE_LABELS[state.operator.role]}`

  await load()
  $('page').hidden = false
  if (isAdmin()) {
    $('btnPrint').hidden = false
    $('valueNote').hidden = false
  }
  setupListeners()
  showFieldsOfKind()
  renderStock()
  if (isAdmin() && IN_SEDE) loadBackupAlert()
}

// L'avviso "copia non riuscita" resta qui (scheda 1.5, decisione 2): l'amministrazione apre Giacenze ogni giorno, Impostazioni no
async function loadBackupAlert() {
  let warnings
  try {
    warnings = (await getBackupStatus())?.avvisi || []
  } catch (err) {
    warnings = [`Stato della copia non disponibile: ${err.message}`]
  }
  const alert = $('backupAlert')
  alert.hidden = !warnings.length
  alert.innerHTML = warnings.length
    ? `<b>Copia di sicurezza</b><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul><a href="/impostazioni.html#copia">Apri la copia di sicurezza</a>`
    : ''
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

async function load() {
  const [setup, overview] = await Promise.all([getMovementSetup(), getStockOverview()])
  state.locations = setup.locations
  state.items = normalize(overview)
}

// Gioielli e semilavorati nella stessa forma, con la giacenza per luogo
function normalize({ articles, raw, stock }) {
  const at = new Map()
  for (const r of stock) {
    const id = r.article_id || r.raw_item_id
    if (!at.has(id)) at.set(id, new Map())
    at.get(id).set(r.location_id, { pieces: r.pieces, grams: Number(r.grams) })
  }
  const art = articles.map(a => ({
    kind: 'montato', id: a.id, code: a.sku || '', name: a.name || '',
    group: ['Gioiello', a.product_type?.name, a.collections?.name].filter(Boolean).join(' · '),
    type: a.product_type?.name || null,
    collection: a.collections?.name || null,
    materials: [...new Set((a.article_materials || []).map(m => m.material?.name).filter(Boolean))],
    metal: a.metal?.name || null,
    unit: 'pezzi', priceRetail: Number(a.price_retail) || 0, priceWholesale: Number(a.price_wholesale) || 0,
    at: at.get(a.id) || new Map(),
  }))
  const semi = raw.map(r => ({
    kind: 'semilavorato', id: r.id, code: r.sku || '', name: r.description || r.size || '',
    group: ['Semilavorato', r.raw_categories?.name].filter(Boolean).join(' · '),
    type: r.raw_categories?.name || null,
    materials: r.coral?.name ? [r.coral.name] : [],   // un semilavorato è sempre corallo lavorato: il materiale è quel corallo
    shape: r.raw_shapes?.name || null,
    quality: r.quality || null,
    unit: r.unit, priceRetail: 0, priceWholesale: 0,
    at: at.get(r.id) || new Map(),
  }))
  return [...art, ...semi].sort((a, b) => a.code.localeCompare(b.code, 'it', { numeric: true }))
}

// ─── Giacenze (UC-01, UC-10, UC-14) ───────────────────────────

const totalOf = item => {
  let pieces = 0, grams = 0
  for (const s of item.at.values()) { pieces += s.pieces; grams += s.grams }
  return { pieces, grams }
}
const hasStock = s => s && (s.pieces !== 0 || Math.abs(s.grams) >= 0.05)

// Quantità nell'unità dell'articolo (REQ-U-03): pezzi, grammi, o pezzi e grammi
function qty(item, s) {
  if (!hasStock(s)) return ''
  if (item.unit === 'grammi') return gramsText(s.grams)
  if (item.unit === 'pezzi_grammi') return `${num(s.pieces)} pz · ${gramsText(s.grams)}`
  return num(s.pieces)
}

// Colonne: i luoghi attivi, più quelli disattivati che hanno ancora merce
function stockColumns(items) {
  return state.locations.filter(l => l.active || items.some(i => hasStock(i.at.get(l.id))))
}

// ─── Filtri (REQ-M-28, scheda 2.5) ────────────────────────────

let filters = null

const distinct = values => [...new Set(values.filter(Boolean))].map(v => [v, v])
const byField = (key, label, more = {}) => ({
  key, label, ...more, options: items => distinct(items.map(i => i[key])), test: (i, v) => i[key] === v,
})

// family: il campo è solo di quella famiglia. Sceglierne un valore lascia quella famiglia, perché l'altra non ce l'ha
const FILTER_FIELDS = [
  // Il luogo non toglie righe da solo: decide di quale quantità si parla (quantityOf)
  { key: 'location', label: 'Luogo', test: () => true,
    options: () => stockColumns(state.items).map(l => [l.id, l.active ? l.name : `${l.name} (disattivato)`]) },
  byField('type', 'Tipo'),
  byField('collection', 'Collezione', { all: 'Tutte', family: 'montato' }),
  { key: 'material', label: 'Materiale', options: items => distinct(items.flatMap(i => i.materials)), test: (i, v) => i.materials.includes(v) },
  byField('metal', 'Metallo', { family: 'montato' }),
  byField('shape', 'Forma', { all: 'Tutte', family: 'semilavorato' }),
  byField('quality', 'Qualità', { all: 'Tutte', family: 'semilavorato' }),
]

const chosenLocation = () => state.locations.find(l => l.id === $('flt_location').value) || null
const quantityOf = (item, location) => (location ? item.at.get(location.id) || { pieces: 0, grams: 0 } : totalOf(item))

function showFieldsOfKind() {
  const kind = $('kindSelect').value
  filters.showFields(f => !kind || !f.family || f.family === kind)
}

// Ciò che le tendine possono proporre: la famiglia scelta e, con la spunta, ciò che c'è davvero
function itemsInView() {
  const kind = $('kindSelect').value
  const onlyStock = $('onlyStock').checked
  const location = chosenLocation()
  return state.items.filter(i => (!kind || i.kind === kind) && (!onlyStock || hasStock(quantityOf(i, location))))
}

// Sotto la tabella, per tutti i ruoli: in STEP una riga era un pezzo, qui i pezzi si contano (scheda 2.5, decisione 5)
function summary(items, location) {
  const parts = [articles(items.length)]
  const jewels = items.filter(i => i.kind === 'montato')
  if (jewels.length) {
    const pieces = jewels.reduce((sum, i) => sum + quantityOf(i, location).pieces, 0)
    parts.push(`${num(pieces)} ${pieces === 1 ? 'pezzo' : 'pezzi'} di gioielli`)
  }
  const semi = items.filter(i => i.kind === 'semilavorato')
  if (semi.length) {
    let pieces = 0, grams = 0
    for (const i of semi) {
      const q = quantityOf(i, location)
      if (i.unit !== 'grammi') pieces += q.pieces
      if (i.unit !== 'pezzi') grams += q.grams
    }
    const amounts = [
      semi.some(i => i.unit !== 'grammi') ? `${num(pieces)} pz` : '',
      semi.some(i => i.unit !== 'pezzi') ? gramsText(grams) : '',
    ].filter(Boolean)
    parts.push(`semilavorati: ${amounts.join(', ')}`)
  }
  return parts.join(' · ')
}

function renderStock() {
  const inView = itemsInView()
  filters.refresh(inView)
  const items = filters.apply(inView)
  const location = chosenLocation()
  // Con un luogo scelto la tabella è l'elenco di quel luogo: una colonna sola, e il totale sarebbe un doppione
  const columns = location ? [location] : stockColumns(state.items)
  const qtyColumns = columns.length + (location ? 0 : 1)
  const admin = isAdmin()

  const head = `
    <colgroup>
      <col class="gia-col-code"><col class="gia-col-name">
      ${'<col class="gia-col-qty">'.repeat(qtyColumns)}
      ${admin ? '<col class="gia-col-value"><col class="gia-col-value">' : ''}
    </colgroup>
    <thead><tr>
      <th scope="col">Codice</th><th scope="col">Articolo</th>
      ${columns.map(l => `<th scope="col" class="num">${esc(l.name)}${l.active ? '' : ' <span class="gia-off">(disattivato)</span>'}</th>`).join('')}
      ${location ? '' : '<th scope="col" class="num">Totale</th>'}
      ${admin ? '<th scope="col" class="num">Valore pubblico</th><th scope="col" class="num">Valore ingrosso</th>' : ''}
    </tr></thead>`

  let valueRetail = 0, valueWholesale = 0, piecesMontato = 0
  const rows = items.map(i => {
    const total = quantityOf(i, location)
    const vr = i.kind === 'montato' ? total.pieces * i.priceRetail : 0
    const vw = i.kind === 'montato' ? total.pieces * i.priceWholesale : 0
    if (i.kind === 'montato') piecesMontato += total.pieces
    valueRetail += vr
    valueWholesale += vw
    return `
      <tr data-code="${esc(i.code)}" tabindex="0" title="Apri nei Movimenti">
        <td class="cell-code" title="${esc(i.code)}">${esc(i.code) || '—'}</td>
        <td><div class="cell-title" title="${esc(i.name)}">${esc(i.name) || '—'}</div><div class="cell-sub">${esc(i.group)}</div></td>
        ${columns.map(l => { const t = qty(i, i.at.get(l.id)); return `<td class="num${t ? '' : ' is-zero'}">${t || '0'}</td>` }).join('')}
        ${location ? '' : `<td class="num gia-total${hasStock(total) ? '' : ' is-zero'}">${qty(i, total) || '0'}</td>`}
        ${admin ? `<td class="num">${i.kind === 'montato' && i.priceRetail ? euro(vr) : '—'}</td>
                   <td class="num">${i.kind === 'montato' && i.priceWholesale ? euro(vw) : '—'}</td>` : ''}
      </tr>`
  }).join('')

  const foot = admin && items.some(i => i.kind === 'montato') ? `
    <tfoot><tr>
      <td colspan="${qtyColumns + 2}">Totale gioielli${location ? ` in ${esc(location.name)}` : ''}: ${num(piecesMontato)} pezzi</td>
      <td class="num">${euro(valueRetail)}</td><td class="num">${euro(valueWholesale)}</td>
    </tr></tfoot>` : ''

  // Larghezza minima dalle colonne: sotto, la tabella scorre di lato invece di schiacciare il nome
  $('stockTable').style.minWidth = `${150 + 240 + 120 * qtyColumns + (admin ? 300 : 0)}px`
  $('stockTable').innerHTML = head + `<tbody>${rows || `<tr><td class="table-empty" colspan="${qtyColumns + 2 + (admin ? 2 : 0)}">Nessun articolo trovato</td></tr>`}</tbody>` + foot
  $('stockCount').textContent = summary(items, location)
}

// Elenco stampabile (REQ-R-01): quello che si vede, con data, ora, chi lo stampa e i filtri usati
function printList() {
  const location = chosenLocation()
  const used = [
    $('kindSelect').selectedOptions[0].text,
    $('onlyStock').checked ? 'solo articoli con giacenza' : 'anche a zero',
    ...filters.labels(),
  ].join(' · ')
  const now = new Date().toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' })
  $('printHead').innerHTML = `
    <div class="gia-print-title">Elenco delle giacenze${location ? `: ${esc(location.name)}` : ''}</div>
    <div>Al ${esc(now)} · stampato da ${esc(state.operator.name)} · ${esc(used)}</div>`
  window.print()
}

// ─── Eventi ───────────────────────────────────────────────────

function setupListeners() {
  filters = initFilters({ fields: FILTER_FIELDS, text: i => `${i.code}\n${i.name}`, onChange: renderStock, remember: 'giacenze' })
  $('kindSelect').addEventListener('change', () => { showFieldsOfKind(); renderStock() })
  $('onlyStock').addEventListener('change', renderStock)
  $('btnPrint').addEventListener('click', printList)
  // Una riga apre l'articolo nei Movimenti, con giacenza e storico (UC-02)
  const open = row => { if (row?.dataset.code) location.href = `/movimenti.html?codice=${encodeURIComponent(row.dataset.code)}` }
  $('stockTable').addEventListener('click', e => open(e.target.closest('tbody tr')))
  $('stockTable').addEventListener('keydown', e => { if (e.key === 'Enter') open(e.target.closest('tbody tr')) })
}

init().catch(err => {
  console.error(err)
  block(`Non riesco a caricare le giacenze: ${err.message || err}`)
})
