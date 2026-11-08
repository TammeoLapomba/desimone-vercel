// js/giacenze.js — Giacenze per articolo e luogo (fetta 3)
//
// Servizi della BBA: UC-01 consultare le giacenze per articolo e luogo (tutti, REQ-001.1), UC-10 stampare l'elenco
// (amministrazione, REQ-R-01), UC-14 vedere il valore (amministrazione, REQ-M-08; base da decidere). Nella WBA: L-01
// interfaccia, F-13 mostrare le giacenze, F-15 produrre l'elenco (L-11). La giacenza è la somma dei movimenti
// (stock_levels, REQ-C-01) e i permessi li decide il database: qui si mostra solo ciò che il ruolo può fare.
// Luoghi, dispositivi, utenti e copia di sicurezza stanno in Impostazioni (scheda 1.5).
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getStockOverview, IN_SEDE, getBackupStatus,
} from './supabase.js'
import { showToast, gramsText } from './utils.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const euro = n => `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}`   // mai il punto delle migliaia
const articles = n => `${num(n)} ${n === 1 ? 'articolo' : 'articoli'}`

const state = {
  operator: null,
  locations: [],
  items: [],       // { kind, id, code, name, group, unit, priceRetail, priceWholesale, at: Map location_id → { pieces, grams } }
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
    unit: 'pezzi', priceRetail: Number(a.price_retail) || 0, priceWholesale: Number(a.price_wholesale) || 0,
    at: at.get(a.id) || new Map(),
  }))
  const semi = raw.map(r => ({
    kind: 'semilavorato', id: r.id, code: r.sku || '', name: r.description || r.size || '',
    group: ['Semilavorato', r.raw_categories?.name].filter(Boolean).join(' · '),
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

function filteredItems() {
  const q = $('searchInput').value.trim().toLowerCase()
  const kind = $('kindSelect').value
  const onlyStock = $('onlyStock').checked
  return state.items.filter(i =>
    (!kind || i.kind === kind) &&
    (!onlyStock || hasStock(totalOf(i))) &&
    (!q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)))
}

function renderStock() {
  const items = filteredItems()
  const columns = stockColumns(state.items)
  const admin = isAdmin()

  const head = `
    <colgroup>
      <col class="gia-col-code"><col class="gia-col-name">
      ${columns.map(() => '<col class="gia-col-qty">').join('')}
      <col class="gia-col-qty">
      ${admin ? '<col class="gia-col-value"><col class="gia-col-value">' : ''}
    </colgroup>
    <thead><tr>
      <th scope="col">Codice</th><th scope="col">Articolo</th>
      ${columns.map(l => `<th scope="col" class="num">${esc(l.name)}${l.active ? '' : ' <span class="gia-off">(disattivato)</span>'}</th>`).join('')}
      <th scope="col" class="num">Totale</th>
      ${admin ? '<th scope="col" class="num">Valore pubblico</th><th scope="col" class="num">Valore ingrosso</th>' : ''}
    </tr></thead>`

  let valueRetail = 0, valueWholesale = 0, piecesMontato = 0
  const rows = items.map(i => {
    const total = totalOf(i)
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
        <td class="num gia-total${hasStock(total) ? '' : ' is-zero'}">${qty(i, total) || '0'}</td>
        ${admin ? `<td class="num">${i.kind === 'montato' && i.priceRetail ? euro(vr) : '—'}</td>
                   <td class="num">${i.kind === 'montato' && i.priceWholesale ? euro(vw) : '—'}</td>` : ''}
      </tr>`
  }).join('')

  const foot = items.length && admin ? `
    <tfoot><tr>
      <td colspan="${columns.length + 2}">Totale gioielli: ${num(piecesMontato)} pezzi</td>
      <td></td>
      <td class="num">${euro(valueRetail)}</td><td class="num">${euro(valueWholesale)}</td>
    </tr></tfoot>` : ''

  // Larghezza minima dalle colonne: sotto, la tabella scorre di lato invece di schiacciare il nome
  $('stockTable').style.minWidth = `${150 + 240 + 120 * (columns.length + 1) + (admin ? 300 : 0)}px`
  $('stockTable').innerHTML = head + `<tbody>${rows || `<tr><td class="table-empty" colspan="${columns.length + 3 + (admin ? 2 : 0)}">Nessun articolo trovato</td></tr>`}</tbody>` + foot
  $('stockCount').textContent = articles(items.length)
}

// Elenco stampabile (REQ-R-01): quello che si vede, con data, ora, chi lo stampa e i filtri usati
function printList() {
  const filters = [
    $('kindSelect').selectedOptions[0].text,
    $('onlyStock').checked ? 'solo articoli con giacenza' : 'anche a zero',
    $('searchInput').value.trim() ? `ricerca "${$('searchInput').value.trim()}"` : '',
  ].filter(Boolean).join(' · ')
  const now = new Date().toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' })
  $('printHead').innerHTML = `
    <div class="gia-print-title">Elenco delle giacenze</div>
    <div>Al ${esc(now)} · stampato da ${esc(state.operator.name)} · ${esc(filters)}</div>`
  window.print()
}

// ─── Eventi ───────────────────────────────────────────────────

function setupListeners() {
  $('searchInput').addEventListener('input', renderStock)
  $('kindSelect').addEventListener('change', renderStock)
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
