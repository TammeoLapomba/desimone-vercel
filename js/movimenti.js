// js/movimenti.js — Schermata dei movimenti (fetta 2): carico, scarico e trasferimento
//
// Nell'app (P-01) realizza le funzioni dell'interfaccia della WBA: F-01.1 comporre la richiesta, F-02 e F-31
// identificare o cercare l'articolo, F-04 validare il peso scritto a mano, F-34 assegnare il codice del
// movimento, F-13 mostrare esito, giacenze e storico. Le regole le decide il database (register_movement):
// qui si mostra solo ciò che il ruolo può fare e si avvisa prima, senza sostituire i controlli (L-01).
// Scenari della BBA: SD-01 vendita al banco, SD-02 riaggiunta di un venduto, SD-03 carico con peso,
// SD-04 trasferimento.
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getMovableItems, getItemStock, getItemHistory,
  registerMovement, cancelMovement, insertDevice, setDeviceScale,
} from './supabase.js'
import { showToast } from './utils.js'
import { initFilters } from './filters.js'
import { initMobileNav } from './pwa.js'
import { createScale, sourceFor, SIMULATED_MODEL } from './bilancia/bilancia.js'

window.signOutUser = signOut
const { validaPeso, formatGrams } = window.Pesi

const TYPES = { C: 'Carico', S: 'Scarico', T: 'Trasferimento' }
const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const UNIT_LABELS = { pezzi: 'a pezzi', grammi: 'a grammi', pezzi_grammi: 'a pezzi e grammi' }
const SOURCE_LABELS = { cavo: 'via cavo', simulata: 'simulata', sede: 'della sede' }
const DEVICE_KEY = 'desimone-os:dispositivo'
const LAST_CODE_KEY = 'desimone-os:ultimo-codice'

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const gramsText = g => formatGrams(Math.round(Number(g) * 1000))       // 24.5 → "24,5 g" (REQ-U-08)
const signed = (n, text) => (n > 0 ? '+' : n < 0 ? '−' : '') + text

const state = {
  operator: null,     // { id, name, role, default_location_id }
  setup: null,        // { locations, reasons, devices, scales, operators }
  items: [],          // gioielli e semilavorati nella stessa forma (normalizeItems)
  byCode: new Map(),
  device: null,
  scale: null,        // { scale, source }: la bilancia di questo dispositivo, o quella della sede (REQ-I-11)
  driver: null,       // createScale(...)
  type: null,         // 'C' | 'S' | 'T'
  item: null,
  stock: [],          // giacenza dell'articolo per luogo
  history: [],
  scaleWeight: null,  // { grams, scaleId } letto dalla bilancia; null se il peso è scritto a mano
  pending: null,      // richiesta partita senza esito: si ripete con lo stesso codice (REQ-E-11)
}

const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} },
}

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav({ onNewArticle: () => $('codeInput')?.focus() })

  state.operator = await getMyOperator()
  if (!state.operator) {
    return block('Il tuo utente non è ancora abilitato ai movimenti: chiedi all\'amministrazione di aggiungerti agli operatori.')
  }
  $('operatorChip').textContent = `${state.operator.name} · ${ROLE_LABELS[state.operator.role]}`

  const [setup, items] = await Promise.all([getMovementSetup(), getMovableItems()])
  state.setup = setup
  state.items = normalizeItems(items)
  state.byCode = new Map(state.items.map(i => [i.code.toUpperCase(), i]))

  const types = allowedTypes()
  if (!types.length) return block('Il tuo ruolo non ha causali di movimento: chiedi all\'amministrazione.')
  state.type = types[0]
  renderTypes()

  useDevice(state.setup.devices.find(d => d.id === storage.get(DEVICE_KEY)?.id && !d.revoked_at) || null)
  $('movLayout').hidden = false
  setupListeners()
  initSearch()
  if (!state.device) openModal('deviceModal')
  else $('codeInput').focus()
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

// Gioielli (montato) e semilavorati nella stessa forma, per il lettore di codici e la ricerca
function normalizeItems({ articles, raw }) {
  const art = articles.map(a => ({
    kind: 'montato',
    id: a.id,
    code: a.sku,
    name: a.name,
    unit: 'pezzi',
    group: `Gioiello · ${a.product_type?.name || '—'}`,
    collection: a.collections?.name || null,
    materials: (a.article_materials || []).map(m => m.material?.name).filter(Boolean),
  }))
  const semi = raw.map(r => ({
    kind: 'semilavorato',
    id: r.id,
    code: r.sku,
    name: r.description || [r.raw_categories?.name, r.raw_shapes?.name, r.size].filter(Boolean).join(' '),
    unit: r.unit,
    group: `Semilavorato · ${r.raw_categories?.name || '—'}`,
    collection: null,
    materials: [],
  }))
  // Senza codice un articolo non entra nel codice del movimento (REQ-M-19): l'anagrafica glielo deve dare (AC-01)
  return [...art, ...semi].filter(i => i.code)
}

// ─── Ruolo: tipi e causali ammessi (BBA, matrice dei permessi) ─

const reasonsFor = type => state.setup.reasons.filter(r =>
  r.active && !r.system && r.movement_type === type &&
  (state.operator.role === 'admin' || r.allowed_roles.includes(state.operator.role)))

const allowedTypes = () => Object.keys(TYPES).filter(t => reasonsFor(t).length)

function renderTypes() {
  $('typeGroup').innerHTML = allowedTypes().map(t => `
    <button type="button" class="mov-type" role="radio" data-type="${t}" aria-checked="${t === state.type}">${TYPES[t]}</button>`).join('')
}

// ─── Dispositivo e bilancia ───────────────────────────────────

function useDevice(device) {
  state.device = device
  $('btnDevice').textContent = device ? `Dispositivo ${device.code}` : 'Scegli il dispositivo'
  if (device) storage.set(DEVICE_KEY, { id: device.id })
  state.driver?.close()
  state.driver = null
  state.scale = device ? sourceFor(device, state.setup.scales) : null
  state.scaleWeight = null
  renderScale()
}

function getDriver() {
  if (!state.scale?.source) return null
  if (!state.driver) {
    state.driver = createScale({
      source: state.scale.source,
      onReading: r => {
        $('scaleReading').textContent = r.text
        $('scaleReading').classList.toggle('is-stable', r.stable)
        $('scaleBox').hidden = false
      },
      onStatus: (message, kind) => {
        $('scaleStatus').textContent = message
        $('scaleStatus').classList.toggle('is-error', kind === 'error')
        $('scaleBox').hidden = false
      },
    })
  }
  return state.driver
}

function renderScale() {
  const s = state.scale
  const btn = $('btnScale')
  if (!btn) return
  btn.disabled = !s?.source || s.source === 'sede'
  btn.title = !s?.source ? 'Nessuna bilancia registrata'
    : s.source === 'sede' ? 'La bilancia della sede si leggerà con il servizio del PC server: per ora scrivi il peso a mano'
      : `${s.scale.name} (${SOURCE_LABELS[s.source]})`
  $('simControls').hidden = s?.source !== 'simulata'
  $('scaleBox').hidden = s?.source !== 'simulata' && !state.driver?.connected
}

// ─── Articolo ────────────────────────────────────────────────

// Lettura dal lettore di codici o codice scritto (F-02): stesso codice = un pezzo in più (REQ-B-03)
async function identify(raw) {
  const code = raw.trim().toUpperCase()
  if (!code) return
  $('codeInput').value = ''
  const item = state.byCode.get(code)
  if (!item) {
    showResult(`Codice sconosciuto: ${raw.trim()}`, 'error')           // REQ-B-02
    return
  }
  if (state.item?.id === item.id && rule().pieces) {
    $('piecesInput').value = (parseInt($('piecesInput').value, 10) || 0) + 1
    changed()
    return
  }
  await selectItem(item)
}

async function selectItem(item) {
  state.item = item
  state.scaleWeight = null
  $('piecesInput').value = 1
  $('weightInput').value = ''
  $('weightInput').readOnly = false
  $('noteInput').value = ''
  $('lastInput').checked = false
  $('itemBox').innerHTML = `
    <div class="mov-item-code">${esc(item.code)}</div>
    <div class="mov-item-name">${esc(item.name)}</div>
    <div class="mov-item-meta">${esc(item.group)} · ${UNIT_LABELS[item.unit] || ''}</div>`
  $('itemBox').hidden = false
  $('details').hidden = false
  hideResult()
  await loadItemData()
  setDefaultLocations()
  setDefaultWeightKind()
  changed()
}

async function loadItemData() {
  const ref = state.item.kind === 'montato' ? { articleId: state.item.id } : { rawItemId: state.item.id }
  const [stock, history] = await Promise.all([getItemStock(ref), getItemHistory(ref)])
  state.stock = stock
  state.history = history
  renderItemPanel()
}

const stockAt = locationId => {
  const s = state.stock.find(x => x.location_id === locationId)
  return { pieces: s?.pieces ?? 0, grams: Number(s?.grams ?? 0) }
}

// ─── Luoghi (REQ-B-05, B-06) ──────────────────────────────────

const activeLocations = () => state.setup.locations.filter(l => l.active)
const locationName = id => state.setup.locations.find(l => l.id === id)?.name || '—'

function setDefaultLocations() {
  const locs = activeLocations()
  const proposed = state.operator.default_location_id
  const withStock = locs.find(l => stockAt(l.id).pieces > 0 || stockAt(l.id).grams > 0)
  const from = (proposed && (stockAt(proposed).pieces > 0 || stockAt(proposed).grams > 0)) ? proposed : withStock?.id || proposed || locs[0]?.id
  const options = locs.map(l => `<option value="${l.id}">${esc(l.name)}${l.kind === 'fiera' ? ' (fiera)' : ''}</option>`).join('')
  $('fromSelect').innerHTML = options
  $('toSelect').innerHTML = options
  $('fromSelect').value = from || ''
  $('toSelect').value = state.type === 'T'
    ? (locs.find(l => l.id !== from && l.id === proposed) || locs.find(l => l.id !== from))?.id || ''
    : proposed || locs[0]?.id || ''
}

// ─── Quantità e peso (REQ-U-01…U-25) ──────────────────────────

const hasHistory = () => state.history.some(l => !l.cancelled)

// Cosa chiede l'articolo in questo movimento, come lo controlla il database (register_movement, 023)
function rule() {
  const { item, type } = state
  if (!item) return { pieces: true, weight: 'optional', measured: false, firstLoad: false }
  const firstLoad = type === 'C' && !hasHistory()
  if (item.kind === 'montato') return { pieces: true, weight: firstLoad ? 'required' : 'optional', measured: false, firstLoad }
  if (item.unit === 'pezzi') return { pieces: true, weight: 'optional', measured: false, firstLoad }
  if (item.unit === 'grammi') return { pieces: false, weight: 'required', measured: false, firstLoad }
  return { pieces: true, weight: 'required', measured: type !== 'C', firstLoad }  // pezzi e grammi (REQ-U-04, U-10)
}

// Primo carico: il gioiello propone il peso di un pezzo, il semilavorato il peso totale (REQ-U-17, U-18)
function setDefaultWeightKind() {
  const kind = state.item?.kind === 'montato' ? 'pezzo' : 'totale'
  document.querySelectorAll('input[name="weightKind"]').forEach(r => { r.checked = r.value === kind })
}

const weightKind = () => document.querySelector('input[name="weightKind"]:checked')?.value || 'totale'

function renderQuantity() {
  const r = rule()
  $('piecesField').hidden = !r.pieces
  $('weightLabel').innerHTML = `Peso (g)${r.weight === 'required' ? ' <span class="field-required">*</span>' : ''}`
  $('weightKind').hidden = !(r.firstLoad && r.pieces)
  $('lastField').hidden = !(state.item?.unit === 'grammi' && state.type !== 'C')
  const hints = []
  if (r.firstLoad && state.item?.kind === 'montato') hints.push('Primo carico: il peso del gioiello si registra come orientativo.')
  if (r.measured) hints.push('Peso misurato di ciò che esce.')
  if (r.weight === 'optional') hints.push('Facoltativo.')
  if (state.scaleWeight) hints.push(`Letto dalla bilancia ${esc(state.scale.scale.name)}. <button type="button" class="mov-link" id="btnManual">Scrivi a mano</button>`)
  $('weightHint').innerHTML = hints.join(' ')
}

// Peso scritto a mano (F-04, REQ-U-06…U-09) o letto dalla bilancia (REQ-I-03, U-25, U-26)
function readWeight(r) {
  if (state.scaleWeight) return { ok: true, grams: state.scaleWeight.grams, source: 'bilancia', scaleId: state.scaleWeight.scaleId }
  const text = $('weightInput').value.trim()
  if (!text) return { ok: true, grams: null }
  const v = validaPeso(text)
  if (!v.ok) return { ok: false, error: v.error }
  return { ok: true, grams: v.mg / 1000, source: 'mano' }
}

// ─── Richiesta, anteprima e codice ────────────────────────────

function buildRequest() {
  const r = rule()
  const type = state.type
  const reason = state.setup.reasons.find(x => x.id === $('reasonSelect').value)
  const fromId = type === 'C' ? null : $('fromSelect').value
  const toId = type === 'S' ? null : $('toSelect').value
  if (!reason) return { error: 'Scegli la causale.' }
  if (type === 'T' && fromId === toId) return { error: 'Partenza e arrivo devono essere luoghi diversi.' }

  const pieces = r.pieces ? parseInt($('piecesInput').value, 10) : null
  if (r.pieces && !(pieces >= 1)) return { error: 'Indica quanti pezzi, almeno uno.' }

  const w = readWeight(r)
  if (!w.ok) return { error: w.error }
  let { grams, source, scaleId } = w
  // Peso di un pezzo al primo carico: si registra il totale calcolato, segnato come orientativo (REQ-U-19, U-21)
  if (grams !== null && r.firstLoad && r.pieces && weightKind() === 'pezzo') {
    grams = Math.round(grams * pieces * 10) / 10
    source = 'calcolo'
    scaleId = null
  }
  if (grams !== null && grams <= 0) return { error: 'Il peso deve essere maggiore di zero.' }
  if (r.weight === 'required' && grams === null) {
    return { error: r.firstLoad && state.item.kind === 'montato' ? 'Al primo carico di un gioiello serve il peso.' : 'Per questo articolo serve il peso.' }
  }

  // Giacenza prima e dopo nei luoghi toccati, come la vede l'operatore (REQ-M-21)
  const leg = (locationId, sign) => {
    const before = stockAt(locationId)
    return {
      location: locationName(locationId),
      pieces_before: before.pieces,
      pieces_after: before.pieces + sign * (pieces ?? 0),
      grams_before: before.grams,
      grams_after: Math.round((before.grams + sign * (grams ?? 0)) * 10) / 10,
    }
  }
  const shown = {}
  if (fromId) shown.from = leg(fromId, -1)
  if (toId) shown.to = leg(toId, +1)

  return {
    params: {
      type,
      reasonId: reason.id,
      articleId: state.item.kind === 'montato' ? state.item.id : null,
      rawItemId: state.item.kind === 'semilavorato' ? state.item.id : null,
      fromId,
      toId,
      pieces,
      grams,
      weightSource: grams === null ? null : source,
      scaleId: source === 'bilancia' ? scaleId : null,
      last: state.item.unit === 'grammi' && type !== 'C' && $('lastInput').checked,
      note: $('noteInput').value.trim(),
      shownStock: shown,
    },
  }
}

function renderPreview() {
  const req = buildRequest()
  const box = $('preview')
  if (req.error) {
    box.innerHTML = `<span class="mov-preview-hint">${esc(req.error)}</span>`
    box.classList.remove('is-warning')
    return
  }
  const showGrams = state.item.kind === 'semilavorato' || req.params.grams !== null
  const line = s => `<div class="mov-preview-line${s.pieces_after < 0 ? ' is-negative' : ''}">
      <span class="mov-preview-loc">${esc(s.location)}</span>
      ${rule().pieces ? `<span>${s.pieces_before} → <b>${s.pieces_after}</b> pz</span>` : ''}
      ${showGrams ? `<span>${gramsText(s.grams_before)} → <b>${gramsText(s.grams_after)}</b></span>` : ''}
    </div>`
  const { from, to } = req.params.shownStock
  const over = from && from.pieces_after < 0
  box.classList.toggle('is-warning', !!over)
  box.innerHTML = (from ? line(from) : '') + (to ? line(to) : '') +
    (over ? `<div class="mov-preview-warn">Oltre la giacenza: in ${esc(from.location)} ci sono ${from.pieces_before} pezzi.</div>` : '')
}

// Codice del movimento, nato sul dispositivo (F-34, REQ-M-19): articolo, tipo, momento e sigla del dispositivo;
// nello stesso secondo, sullo stesso dispositivo, un suffisso lo rende diverso (REQ-M-20)
function newCode(type, when) {
  const p = n => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`
  const base = `${state.item.code}-${type}-${stamp}-${state.device.code}`
  const last = storage.get(LAST_CODE_KEY)
  const n = last?.base === base ? last.n + 1 : 1
  storage.set(LAST_CODE_KEY, { base, n })
  return n === 1 ? base : `${base}-${n}`
}

// ─── Registrazione ────────────────────────────────────────────

async function submit(e) {
  e.preventDefault()
  if (!state.device) return openModal('deviceModal')
  if (state.pending) return send(state.pending)
  const req = buildRequest()
  if (req.error) return showResult(req.error, 'error')
  const when = new Date()
  await send({ ...req.params, code: newCode(state.type, when), occurredAt: when.toISOString(), deviceId: state.device.id })
}

// Stesso movimento? Serve se il codice risultasse già usato da un altro movimento
const sameMovement = (m, p) => m.movement_type === p.type && (m.article_id ?? null) === p.articleId &&
  (m.raw_item_id ?? null) === p.rawItemId && (m.pieces ?? null) === p.pieces &&
  (m.grams === null ? null : Number(m.grams)) === p.grams &&
  (m.from_location_id ?? null) === p.fromId && (m.to_location_id ?? null) === p.toId

// Errore di rete: la richiesta forse è arrivata, forse no. Il database si accorge della ripetizione dal codice.
const isNetworkError = err => !err.code && /fetch|network|load failed|timeout/i.test(err.message || '')

async function send(params, attempt = 1) {
  const btn = $('btnSubmit')
  btn.disabled = true
  btn.textContent = 'Registrazione…'
  try {
    const res = await registerMovement(params)
    if (res.duplicate && !sameMovement(res.movement, params)) {
      if (attempt > 3) throw new Error('Codice del movimento già usato: riprova tra un secondo.')
      return send({ ...params, code: `${params.code}-${attempt + 1}` }, attempt + 1)
    }
    state.pending = null
    showOutcome(res, params)
    await loadItemData()
    afterSuccess()
  } catch (err) {
    if (isNetworkError(err)) {
      state.pending = params
      showResult('Esito non arrivato: la rete è caduta? Premi "Riprova": lo stesso movimento non verrà registrato due volte.', 'warn')
    } else {
      state.pending = null
      showResult(err.message || String(err), 'error')
    }
  } finally {
    btn.disabled = false
    btn.textContent = state.pending ? 'Riprova' : 'Registra'
  }
}

// Esito con la giacenza aggiornata (F-13, REQ-I-06)
function showOutcome(res, params) {
  const m = res.movement
  const part = (s, id) => {
    if (!s || !id) return ''
    const bits = []
    if (state.item.kind === 'montato' || state.item.unit !== 'grammi') bits.push(`${s.pieces} pz`)
    if (state.item.kind === 'semilavorato') bits.push(gramsText(s.grams))
    return `${esc(locationName(id))}: ${bits.join(', ')}`
  }
  const where = [part(res.from_stock, m.from_location_id), part(res.to_stock, m.to_location_id)].filter(Boolean).join(' · ')
  const diff = res.weighing_difference !== null && res.weighing_difference !== undefined
    ? `<div>Differenza di pesatura registrata: ${signed(-Number(res.weighing_difference), gramsText(Math.abs(Number(res.weighing_difference))))}</div>` : ''
  showResult(`<b>${res.duplicate ? 'Era già registrato' : 'Registrato'}</b> · ${TYPES[params.type]} ${esc(m.code)}<div>${where}</div>${diff}`, 'ok', true)
}

function afterSuccess() {
  $('piecesInput').value = 1
  $('weightInput').value = ''
  $('weightInput').readOnly = false
  $('noteInput').value = ''
  $('lastInput').checked = false
  state.scaleWeight = null
  changed(false)
  $('codeInput').focus()
}

function showResult(message, kind, html = false) {
  const box = $('result')
  box.className = `mov-result is-${kind}`
  if (html) box.innerHTML = message
  else box.textContent = message
  box.hidden = false
}

function hideResult() {
  $('result').hidden = true
}

// Ogni modifica della richiesta: niente più ripetizione in sospeso, anteprima e campi aggiornati
function changed(clearResult = true) {
  if (state.pending) {
    state.pending = null
    $('btnSubmit').textContent = 'Registra'
  }
  if (clearResult) hideResult()
  if (!state.item) return
  const type = state.type
  $('fromField').hidden = type === 'C'
  $('toField').hidden = type === 'S'
  $('locationsRow').classList.toggle('full', type !== 'T')
  const current = $('reasonSelect').value
  const reasons = reasonsFor(type)
  $('reasonSelect').innerHTML = reasons.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')
  if (reasons.some(r => r.id === current)) $('reasonSelect').value = current
  renderQuantity()
  renderPreview()
}

// ─── Giacenza e storico dell'articolo (F-13) ──────────────────

function renderItemPanel() {
  const item = state.item
  const showPieces = item.unit !== 'grammi'
  const showGrams = item.kind === 'semilavorato' || state.stock.some(s => Number(s.grams) !== 0)
  const stockRows = state.stock
    .filter(s => s.pieces !== 0 || Number(s.grams) !== 0)
    .sort((a, b) => locationName(a.location_id).localeCompare(locationName(b.location_id), 'it'))
  const total = stockRows.reduce((t, s) => ({ pieces: t.pieces + s.pieces, grams: t.grams + Number(s.grams) }), { pieces: 0, grams: 0 })
  const operators = new Map(state.setup.operators.map(o => [o.id, o.name]))
  const reasons = new Map(state.setup.reasons.map(r => [r.id, r.name]))
  const isAdmin = state.operator.role === 'admin'
  const seen = new Set()
  const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  $('itemPanel').className = ''
  $('itemPanel').innerHTML = `
    <div class="mov-panel-item"><span class="mov-item-code">${esc(item.code)}</span> ${esc(item.name)}</div>
    <h3 class="mov-panel-title">Dove si trova</h3>
    ${stockRows.length ? `
    <table class="mov-table">
      <thead><tr><th scope="col">Luogo</th>${showPieces ? '<th scope="col" class="num">Pezzi</th>' : ''}${showGrams ? '<th scope="col" class="num">Peso</th>' : ''}</tr></thead>
      <tbody>${stockRows.map(s => `<tr><td>${esc(locationName(s.location_id))}</td>${showPieces ? `<td class="num">${s.pieces}</td>` : ''}${showGrams ? `<td class="num">${gramsText(s.grams)}</td>` : ''}</tr>`).join('')}</tbody>
      ${stockRows.length > 1 ? `<tfoot><tr><th scope="row">Totale</th>${showPieces ? `<td class="num">${total.pieces}</td>` : ''}${showGrams ? `<td class="num">${gramsText(total.grams)}</td>` : ''}</tr></tfoot>` : ''}
    </table>` : '<p class="mov-empty">Nessuna giacenza registrata con i movimenti.</p>'}
    <h3 class="mov-panel-title">Storico</h3>
    ${state.history.length ? `
    <div class="mov-table-scroll">
    <table class="mov-table mov-history">
      <thead><tr>
        <th scope="col">Quando</th><th scope="col">Luogo</th><th scope="col">Movimento</th>
        ${showPieces ? '<th scope="col" class="num">Pezzi</th>' : ''}${showGrams ? '<th scope="col" class="num">Peso</th>' : ''}
        <th scope="col" class="num">Dopo</th><th scope="col">Chi</th>${isAdmin ? '<th scope="col"><span class="sr-only">Azioni</span></th>' : ''}
      </tr></thead>
      <tbody>${state.history.map(l => {
        const m = l.movement || {}
        const first = !seen.has(l.movement_id)
        seen.add(l.movement_id)
        const after = [showPieces ? `${l.pieces_after} pz` : '', showGrams ? gramsText(l.grams_after) : ''].filter(Boolean).join(' · ')
        const cancel = isAdmin && first && !l.cancelled && !m.parent_id
          ? `<button type="button" class="mov-link" data-cancel="${l.movement_id}" data-code="${esc(l.code)}">Annulla</button>` : ''
        return `<tr class="${l.cancelled ? 'is-cancelled' : ''}" title="${esc(l.code)}">
          <td>${when(l.occurred_at)}</td>
          <td>${esc(locationName(l.location_id))}</td>
          <td>${TYPES[l.movement_type]} · ${esc(reasons.get(m.reason_id) || '')}${m.note ? `<div class="mov-note">${esc(m.note)}</div>` : ''}${l.cancelled ? `<div class="mov-note">Annullato: ${esc(m.cancel_reason)}</div>` : ''}</td>
          ${showPieces ? `<td class="num">${l.pieces ? signed(l.pieces, String(Math.abs(l.pieces))) : ''}</td>` : ''}
          ${showGrams ? `<td class="num">${Number(l.grams) ? signed(Number(l.grams), gramsText(Math.abs(Number(l.grams)))) : ''}${m.weight_source === 'calcolo' ? ' <span class="mov-note">calcolato</span>' : ''}</td>` : ''}
          <td class="num">${l.cancelled ? '—' : after}</td>
          <td>${esc(operators.get(m.operator_id) || '')}</td>
          ${isAdmin ? `<td>${cancel}</td>` : ''}
        </tr>`
      }).join('')}</tbody>
    </table>
    </div>` : '<p class="mov-empty">Nessun movimento.</p>'}`
}

// Annullamento con motivo, solo l'amministrazione (REQ-M-06, M-13, M-14)
async function cancel(id, code) {
  const reason = prompt(`Annullare il movimento ${code}?\n\nResta nello storico, segnato come annullato. Scrivi il motivo:`)
  if (reason === null) return
  try {
    await cancelMovement(id, reason)
    showToast('Movimento annullato')
    await loadItemData()
    changed(false)
  } catch (err) {
    showToast(err.message, 5000)
  }
}

// ─── Ricerca dell'articolo (F-31, REQ-B-08…B-10) ──────────────

let filters = null

function initSearch() {
  const distinct = values => [...new Set(values.filter(Boolean))].map(v => [v, v])
  filters = initFilters({
    fields: [
      { key: 'group', label: 'Tipo', options: items => distinct(items.map(i => i.group)), test: (i, v) => i.group === v },
      { key: 'collection', label: 'Collezione', all: 'Tutte', options: items => distinct(items.map(i => i.collection)), test: (i, v) => i.collection === v },
      { key: 'material', label: 'Materiale', options: items => distinct(items.flatMap(i => i.materials)), test: (i, v) => i.materials.includes(v) },
    ],
    text: i => `${i.code}\n${i.name}`,
    onChange: renderSearch,
  })
}

function renderSearch() {
  filters.refresh(state.items)
  const found = filters.apply(state.items)
  const shown = found.slice(0, 100)
  $('searchCount').textContent = found.length > shown.length
    ? `${found.length} articoli: i primi ${shown.length}, restringi la ricerca`
    : `${found.length} ${found.length === 1 ? 'articolo' : 'articoli'}`
  $('searchResults').innerHTML = shown.map(i => `
    <li><button type="button" class="mov-search-item" data-id="${i.id}">
      <span class="mov-item-code">${esc(i.code)}</span>
      <span class="mov-search-name">${esc(i.name)}</span>
      <span class="mov-search-group">${esc(i.group)}${i.collection ? ` · ${esc(i.collection)}` : ''}</span>
    </button></li>`).join('')
}

// ─── Finestra del dispositivo (REQ-D-04) e della sua bilancia (CR7) ─

function renderDeviceModal() {
  const isAdmin = state.operator.role === 'admin'
  const devices = state.setup.devices.filter(d => !d.revoked_at)
  const own = state.device ? state.setup.scales.find(s => s.active && s.device_id === state.device.id) : null
  const scaleKind = !own ? 'nessuna' : own.model === SIMULATED_MODEL ? 'simulata' : 'cavo'
  $('deviceBody').innerHTML = `
    ${devices.length ? `
    <p class="mov-modal-text">Scegli quale dispositivo stai usando. La scelta resta in questo browser.</p>
    <div class="form-field">
      <label class="field-label" for="deviceSelect">Dispositivo</label>
      <select class="field-input field-select" id="deviceSelect">
        ${devices.map(d => `<option value="${d.id}"${d.id === state.device?.id ? ' selected' : ''}>${esc(d.code)} — ${esc(d.name)}</option>`).join('')}
      </select>
    </div>
    <div class="mov-actions"><button type="button" class="btn-primary" id="btnUseDevice">Usa questo dispositivo</button></div>`
    : `<p class="mov-modal-text">Non c'è ancora nessun dispositivo registrato.${isAdmin ? '' : ' Chiedi all\'amministrazione di registrare questo.'}</p>`}
    ${isAdmin ? `
    <h3 class="mov-panel-title">Registra un nuovo dispositivo</h3>
    <div class="form-row">
      <div class="form-field">
        <label class="field-label" for="newDeviceCode">Sigla</label>
        <input class="field-input" id="newDeviceCode" maxlength="6" autocomplete="off" placeholder="WEB1" aria-describedby="newDeviceHint">
      </div>
      <div class="form-field">
        <label class="field-label" for="newDeviceName">Nome</label>
        <input class="field-input" id="newDeviceName" autocomplete="off" placeholder="Portatile di Matteo">
      </div>
    </div>
    <div class="field-hint" id="newDeviceHint">Da 2 a 6 lettere maiuscole o cifre, unica: entra nel codice di ogni movimento.</div>
    <div class="mov-actions"><button type="button" class="btn-ghost" id="btnNewDevice">Registra</button></div>
    ${state.device ? `
    <h3 class="mov-panel-title">Bilancia collegata a ${esc(state.device.code)}</h3>
    <div class="mov-radio-list" role="radiogroup" aria-label="Bilancia del dispositivo">
      <label><input type="radio" name="scaleKind" value="nessuna"${scaleKind === 'nessuna' ? ' checked' : ''}> Nessuna: si pesa con la bilancia della sede (PC server)</label>
      <label><input type="radio" name="scaleKind" value="cavo"${scaleKind === 'cavo' ? ' checked' : ''}> Via cavo USB-seriale (Chrome o Edge sul computer)</label>
      <label><input type="radio" name="scaleKind" value="simulata"${scaleKind === 'simulata' ? ' checked' : ''}> Simulata, per le prove</label>
    </div>
    <div class="mov-actions"><button type="button" class="btn-ghost" id="btnSaveScale">Salva</button></div>` : ''}` : ''}`
}

async function deviceModalClick(e) {
  try {
    if (e.target.id === 'btnUseDevice') {
      useDevice(state.setup.devices.find(d => d.id === $('deviceSelect').value))
      closeModal('deviceModal')
      $('codeInput').focus()
    } else if (e.target.id === 'btnNewDevice') {
      const code = $('newDeviceCode').value.trim().toUpperCase()
      const name = $('newDeviceName').value.trim()
      if (!/^[A-Z0-9]{2,6}$/.test(code)) return showToast('La sigla va da 2 a 6 lettere maiuscole o cifre')
      if (!name) return showToast('Scrivi il nome del dispositivo')
      const device = await insertDevice({ code, name })
      state.setup.devices.push(device)
      useDevice(device)
      renderDeviceModal()
      showToast(`Dispositivo ${code} registrato e in uso`)
    } else if (e.target.id === 'btnSaveScale') {
      const kind = document.querySelector('input[name="scaleKind"]:checked')?.value || 'nessuna'
      await setDeviceScale(state.device, kind, SIMULATED_MODEL)
      state.setup = await getMovementSetup()
      useDevice(state.setup.devices.find(d => d.id === state.device.id))
      renderDeviceModal()
      showToast('Bilancia del dispositivo salvata')
    }
  } catch (err) {
    showToast(err.code === '23505' ? 'Sigla già usata da un altro dispositivo' : err.message, 5000)
  }
}

// ─── Finestre ────────────────────────────────────────────────

let lastFocus = null

function openModal(id) {
  lastFocus = document.activeElement
  if (id === 'deviceModal') renderDeviceModal()
  if (id === 'searchModal') renderSearch()
  $(id).classList.add('open')
  setTimeout(() => $(id).querySelector(id === 'searchModal' ? '#searchInput' : '.modal-body select, .modal-body input, .modal-body button')?.focus(), 50)
}

function closeModal(id) {
  $(id).classList.remove('open')
  lastFocus?.focus?.()
}

// ─── Eventi ──────────────────────────────────────────────────

function setupListeners() {
  $('typeGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-type]')
    if (!btn) return
    state.type = btn.dataset.type
    renderTypes()
    if (state.item) setDefaultLocations()
    changed()
  })

  // Il lettore di codici scrive come una tastiera e chiude con Invio
  $('codeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      identify($('codeInput').value)
    }
  })

  $('btnSearch').addEventListener('click', () => openModal('searchModal'))
  $('searchResults').addEventListener('click', e => {
    const btn = e.target.closest('[data-id]')
    if (!btn) return
    closeModal('searchModal')
    selectItem(state.items.find(i => i.id === btn.dataset.id))
  })

  for (const id of ['fromSelect', 'toSelect', 'reasonSelect', 'piecesInput', 'noteInput', 'lastInput']) {
    $(id).addEventListener('input', () => changed())
  }
  $('weightKind').addEventListener('change', () => changed())
  $('weightInput').addEventListener('input', () => {
    const v = $('weightInput').value.trim()
    const check = v ? validaPeso(v) : { ok: true }
    $('weightError').textContent = check.ok ? '' : check.error
    $('weightError').hidden = check.ok
    changed()
  })

  // Peso dalla bilancia quando l'operatore lo chiede (REQ-I-03.1), solo stabile (REQ-I-04)
  $('btnScale').addEventListener('click', async () => {
    const driver = getDriver()
    if (!driver) return
    const btn = $('btnScale')
    btn.disabled = true
    btn.textContent = 'Attendo il peso stabile…'
    try {
      const reading = await driver.readStable()
      if (reading.grams <= 0) throw new Error('La bilancia segna zero: appoggia la merce sul piatto')
      state.scaleWeight = { grams: reading.grams, scaleId: state.scale.scale.id }
      $('weightInput').value = reading.text.replace(' g', '')
      $('weightInput').readOnly = true
      $('weightError').hidden = true
      changed()
    } catch (err) {
      $('scaleStatus').textContent = err.message
      $('scaleStatus').classList.add('is-error')
      $('scaleBox').hidden = false
    } finally {
      btn.disabled = false
      btn.textContent = 'Leggi dalla bilancia'
    }
  })

  // "Scrivi a mano": il peso letto dalla bilancia non si modifica, si sostituisce (D-3, criterio C-1)
  $('weightHint').addEventListener('click', e => {
    if (e.target.id !== 'btnManual') return
    state.scaleWeight = null
    $('weightInput').readOnly = false
    $('weightInput').value = ''
    $('weightInput').focus()
    changed()
  })

  // Merce sul piatto della bilancia simulata
  $('simControls').addEventListener('click', async e => {
    const btn = e.target.closest('[data-load]')
    const driver = getDriver()
    if (!btn || !driver) return
    if (!driver.connected) await driver.connect()
    const sim = driver.simulated()
    if (btn.dataset.load === 'clear') sim.clearPan()
    else sim.addLoad(Number(btn.dataset.load))
  })

  $('movForm').addEventListener('submit', submit)
  $('btnClear').addEventListener('click', () => {
    state.item = null
    state.pending = null
    $('itemBox').hidden = true
    $('details').hidden = true
    $('itemPanel').className = 'mov-empty'
    $('itemPanel').textContent = 'Scegli un articolo per vedere dove si trova e come è cambiata la sua quantità.'
    $('btnSubmit').textContent = 'Registra'
    hideResult()
    $('codeInput').focus()
  })

  $('itemPanel').addEventListener('click', e => {
    const btn = e.target.closest('[data-cancel]')
    if (btn) cancel(btn.dataset.cancel, btn.dataset.code)
  })

  $('btnDevice').addEventListener('click', () => openModal('deviceModal'))
  $('deviceBody').addEventListener('click', deviceModalClick)

  for (const id of ['searchModal', 'deviceModal']) {
    const modal = $(id)
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close]')) closeModal(id)
    })
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    for (const id of ['searchModal', 'deviceModal']) if ($(id).classList.contains('open')) closeModal(id)
  })
}

init().catch(err => {
  console.error(err)
  block(`Errore nel caricamento: ${err.message}`)
})
