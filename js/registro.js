// js/registro.js — Registro dei movimenti, con i filtri (fetta 3)
//
// Servizio della BBA: UC-02 consultare lo storico dei movimenti (tutti, REQ-M-01), qui per tutti gli articoli
// insieme; quello del singolo articolo resta nella schermata Movimenti. Nella WBA: L-01 interfaccia, F-13 mostrare
// lo storico. Il registro arriva al milione di movimenti: si legge dal più recente a pagine da 100 e i filtri li
// applica il database (getMovements). Lo legge ogni operatore (movements_select): qui non si decide niente.
import { requireAuth, signOut, getMyOperator, getMovementSetup, getMovements, findItemByCode } from './supabase.js'
import { formatEuro, gramsText } from './utils.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const PAGE = 100
const TYPES = { C: 'Carico', S: 'Scarico', T: 'Trasferimento', R: 'Rettifica' }   // R: la rettifica di una conta (041)
const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const FAMILY = 'famiglia:'

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const state = {
  operator: null,
  setup: null,     // { locations, reasons, devices, scales, operators }, in ordine alfabetico
  code: null,      // codice dell'articolo già applicato al filtro
  item: null,      // articolo del filtro: { kind, id, code, name }, { missing: true } se il codice non esiste
  rows: [],
  done: false,     // letti tutti i movimenti che passano i filtri
  request: 0,      // l'ultima lettura partita: le risposte delle precedenti si scartano
}

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()

  state.operator = await getMyOperator()
  if (!state.operator) {
    return block('Il tuo utente non è ancora abilitato al registro: chiedi all\'amministrazione di aggiungerti agli operatori.')
  }
  $('operatorChip').textContent = `${state.operator.name} · ${ROLE_LABELS[state.operator.role]}`

  state.setup = await getMovementSetup()
  renderOptions()
  $('page').hidden = false
  setupListeners()

  // Arrivo da un articolo: registro già filtrato
  const code = new URLSearchParams(location.search).get('codice')
  if (code) $('fCode').value = code
  await setItem(code || '', true)
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

// ─── Filtri ───────────────────────────────────────────────────

const option = (value, text) => `<option value="${esc(value)}">${esc(text)}</option>`

function renderOptions() {
  const { locations, operators } = state.setup
  renderReasons()
  $('fLocation').innerHTML = option('', 'Tutti') + locations.map(l =>
    option(l.id, `${l.name}${l.kind === 'fiera' ? ' (fiera)' : ''}${l.active ? '' : ' (disattivato)'}`)).join('')
  $('fOperator').innerHTML = option('', 'Tutti') + [...operators]
    .sort((a, b) => a.name.localeCompare(b.name, 'it')).map(o => option(o.id, o.name)).join('')
}

// Causali del tipo scelto, divise per tipo, più le famiglie (025: "vendita" raccoglie le vendite di ogni canale).
// Ci sono anche quelle non più in uso, perché restano nei movimenti vecchi.
function renderReasons() {
  const type = $('fType').value
  const current = $('fReason').value
  const reasons = state.setup.reasons.filter(r => !type || r.movement_type === type)
  const families = [...new Set(reasons.map(r => r.category).filter(Boolean))]
  $('fReason').innerHTML = option('', 'Tutte') +
    families.map(c => option(FAMILY + c, c === 'vendita' ? 'Tutte le vendite' : `Famiglia ${c}`)).join('') +
    Object.entries(TYPES).map(([t, label]) => {
      const list = reasons.filter(r => r.movement_type === t)
      return list.length ? `<optgroup label="${label}">${list.map(r => option(r.id, `${r.name}${r.active ? '' : ' (non più in uso)'}`)).join('')}</optgroup>` : ''
    }).join('')
  $('fReason').value = [...$('fReason').options].some(o => o.value === current) ? current : ''
}

// Un giorno scelto vale tutto, dalla mezzanotte locale: "Al" comprende il suo giorno
function dayStart(value, addDays = 0) {
  if (!value) return null
  const d = new Date(`${value}T00:00`)
  d.setDate(d.getDate() + addDays)
  return d.toISOString()
}

function readFilters() {
  const reason = $('fReason').value
  const reasonIds = !reason ? []
    : reason.startsWith(FAMILY) ? state.setup.reasons.filter(r => r.category === reason.slice(FAMILY.length)).map(r => r.id)
      : [reason]
  return {
    type: $('fType').value || null,
    reasonIds,
    locationId: $('fLocation').value || null,
    operatorId: $('fOperator').value || null,
    since: dayStart($('fSince').value),
    until: dayStart($('fUntil').value, 1),
    articleId: state.item?.kind === 'montato' ? state.item.id : null,
    rawItemId: state.item?.kind === 'semilavorato' ? state.item.id : null,
    withCancelled: $('fCancelled').checked,
  }
}

// Articolo dal codice, letto o scritto: prima com'è, poi in maiuscolo come nei Movimenti. Invio e uscita dal
// campo arrivano tutti e due: lo stesso codice non si rilegge, se non con force.
async function setItem(raw, force = false) {
  const code = raw.trim()
  if (!force && code === state.code) return
  state.code = code
  const hint = $('fCodeHint')
  state.item = null
  hint.textContent = ''
  hint.classList.remove('field-error')
  if (code) {
    try {
      const item = await findItemByCode(code) || (code !== code.toUpperCase() ? await findItemByCode(code.toUpperCase()) : null)
      state.item = item || { missing: true }
      hint.textContent = item ? `${item.name || ''}${item.archived ? ' · archiviato' : ''}` : `Codice sconosciuto: ${code}`
      hint.classList.toggle('field-error', !item)
    } catch (err) {
      return showError(err)
    }
  }
  await load()
}

// ─── Lettura e tabella ────────────────────────────────────────

async function load(more = false) {
  const request = ++state.request
  $('btnMore').disabled = true
  if (!more) $('count').textContent = 'Carico i movimenti…'
  try {
    const rows = state.item?.missing ? [] : await getMovements(readFilters(), { offset: more ? state.rows.length : 0, limit: PAGE })
    if (request !== state.request) return
    state.rows = more ? [...state.rows, ...rows] : rows
    state.done = rows.length < PAGE
    render()
  } catch (err) {
    if (request === state.request) showError(err)
  } finally {
    if (request === state.request) $('btnMore').disabled = false
  }
}

function showError(err) {
  console.error(err)
  $('count').textContent = `Non riesco a leggere il registro: ${err.message || err}`
}

function render() {
  const locations = new Map(state.setup.locations.map(l => [l.id, l.name]))
  const reasons = new Map(state.setup.reasons.map(r => [r.id, r.name]))
  const operators = new Map(state.setup.operators.map(o => [o.id, o.name]))
  const place = id => esc(locations.get(id) || '—')
  const where = m => m.movement_type === 'T' ? `${place(m.from_location_id)} → ${place(m.to_location_id)}`
    : place(m.from_location_id || m.to_location_id)
  // Il trasferimento non aggiunge né toglie: la quantità si mostra senza segno
  // Nella rettifica pezzi e peso hanno ciascuno il suo segno (041)
  const sign = (m, text, value) => (m.movement_type === 'R' ? (value < 0 ? '−' : '+')
    : m.movement_type === 'C' ? '+' : m.movement_type === 'S' ? '−' : '') + text

  const head = `
    <colgroup>
      <col class="reg-col-when"><col class="reg-col-item"><col class="reg-col-move"><col class="reg-col-place">
      <col class="reg-col-qty"><col class="reg-col-qty"><col class="reg-col-who">
    </colgroup>
    <thead><tr>
      <th scope="col">Quando</th><th scope="col">Articolo</th><th scope="col">Movimento</th><th scope="col">Luogo</th>
      <th scope="col" class="num">Pezzi</th><th scope="col" class="num">Peso</th><th scope="col">Chi</th>
    </tr></thead>`

  const rows = state.rows.map(m => {
    const item = m.article ? { code: m.article.sku, name: m.article.name } : { code: m.raw_item?.sku, name: m.raw_item?.description }
    const archived = (m.article || m.raw_item)?.deleted_at ? ' · archiviato' : ''
    return `
      <tr class="${m.cancelled_at ? 'is-cancelled' : ''}" data-code="${esc(item.code)}" tabindex="0" title="${esc(m.code)} · apri l'articolo nei Movimenti">
        <td class="reg-when">${when(m.occurred_at)}</td>
        <td><div class="cell-code">${esc(item.code) || '—'}</div><div class="cell-sub">${esc(item.name)}${archived}</div></td>
        <td>${m.movement_type === 'R' ? '' : `${TYPES[m.movement_type]} · `}${esc(reasons.get(m.reason_id) || '')}${m.document_ref ? ` · ${esc(m.document_ref)}` : ''}${m.sale_price ? ` · ${formatEuro(m.sale_price)}` : ''}
          ${m.note ? `<div class="mov-note">${esc(m.note)}</div>` : ''}
          ${m.cancelled_at ? `<div class="mov-note">Annullato: ${esc(m.cancel_reason)}</div>` : ''}</td>
        <td>${where(m)}</td>
        <td class="num">${m.pieces ? sign(m, num(Math.abs(m.pieces)), m.pieces) : ''}</td>
        <td class="num">${m.grams ? sign(m, gramsText(Math.abs(m.grams)), Number(m.grams)) : ''}${m.weight_source === 'calcolo' ? ' <span class="mov-note">calcolato</span>' : ''}</td>
        <td>${esc(operators.get(m.operator_id) || '')}</td>
      </tr>`
  }).join('')

  $('table').innerHTML = head + `<tbody>${rows || '<tr><td class="table-empty" colspan="7">Nessun movimento con questi filtri</td></tr>'}</tbody>`
  const n = state.rows.length
  $('count').textContent = !n ? '' : state.done ? `${num(n)} ${n === 1 ? 'movimento' : 'movimenti'}`
    : `I ${num(n)} movimenti più recenti: "Mostra altri" per i precedenti`
  $('btnMore').hidden = state.done
}

// ─── Eventi ───────────────────────────────────────────────────

function setupListeners() {
  $('filters').addEventListener('submit', e => e.preventDefault())
  $('fType').addEventListener('change', () => {
    renderReasons()
    load()
  })
  for (const id of ['fReason', 'fLocation', 'fOperator', 'fSince', 'fUntil', 'fCancelled']) {
    $(id).addEventListener('change', () => load())
  }
  // Il lettore di codici scrive come una tastiera e chiude con Invio; anche uscire dal campo applica il codice
  $('fCode').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setItem($('fCode').value)
  })
  $('fCode').addEventListener('change', () => setItem($('fCode').value))
  $('btnReset').addEventListener('click', () => {
    $('filters').reset()
    renderReasons()
    setItem('', true)
  })
  $('btnMore').addEventListener('click', () => load(true))

  // Una riga apre l'articolo nei Movimenti, con giacenza e storico
  const open = row => { if (row?.dataset.code) location.href = `/movimenti.html?codice=${encodeURIComponent(row.dataset.code)}` }
  $('table').addEventListener('click', e => open(e.target.closest('tbody tr')))
  $('table').addEventListener('keydown', e => { if (e.key === 'Enter') open(e.target.closest('tbody tr')) })
}

init().catch(err => {
  console.error(err)
  block(`Non riesco a caricare il registro: ${err.message || err}`)
})
