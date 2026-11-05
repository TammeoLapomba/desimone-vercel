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
  registerMovement, cancelMovement, insertDevice, setDeviceScale, setDeviceKind, findItemByCode, getCodeCheck,
} from './supabase.js'
import { scanQr, cameraSupport } from './scanner.js'
import { showToast, formatEuro, parseEuro, getCoverPhoto, articleMaterialLines, articleMetalLine } from './utils.js'
import { initFilters } from './filters.js'
import { initMobileNav } from './pwa.js'
import { createScale, sourceFor, SIMULATED_MODEL } from './bilancia/bilancia.js'

window.signOutUser = signOut
const { validaPeso, formatGrams } = window.Pesi

const TYPES = { C: 'Carico', S: 'Scarico', T: 'Trasferimento' }
const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const UNIT_LABELS = { pezzi: 'a pezzi', grammi: 'a grammi', pezzi_grammi: 'a pezzi e grammi' }
const SOURCE_LABELS = { cavo: 'via cavo', simulata: 'simulata', sede: 'della sede' }
const KIND_LABELS = { pc: 'PC: lettore a pistola', mobile: 'Tablet o telefono: anche la fotocamera' }
const DEVICE_KEY = 'desimone-os:dispositivo'
const LAST_CODE_KEY = 'desimone-os:ultimo-codice'
const DRAFT_KEY = 'desimone-os:bozza-carico'

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
  priceTouched: false, // il prezzo di vendita l'ha scritto l'operatore: non si ripropone più
  check: null,        // schermata di controllo aperta: { params, code }
}

const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} },
}

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()

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
  // Arrivo dall'inventario (catalogo, articolo, semilavorato): articolo già scelto
  const query = new URLSearchParams(location.search)
  const preset = state.byCode.get((query.get('codice') || '').toUpperCase())
  if (preset) await selectItem(preset)
  // Di ritorno da "Correggi i dati": il carico riprende da ciò che era già scritto (CR11)
  if (preset && query.has('bozza')) restoreDraft()
  if (!state.device) openModal('deviceModal')
  else if (!preset) focusCode()
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

// Come model_weight nel database (028): un numero maggiore di zero, al decimo; altrimenti null
const modelWeight = m => {
  const w = m?.weight_g
  return typeof w === 'number' && w > 0 ? Math.round(w * 10) / 10 : null
}

// Gioielli (montato) e semilavorati nella stessa forma, per il lettore di codici e la ricerca
function normalizeItems({ articles, raw }) {
  const art = articles.map(a => ({
    kind: 'montato',
    id: a.id,
    code: a.sku,
    provisional: !a.code_confirmed_at,   // da confermare prima del primo uso (REQ-A-09)
    name: a.name,
    unit: 'pezzi',
    price: a.price_retail ?? null,     // listino: si propone nel prezzo di vendita
    weight: modelWeight(a.measurements), // peso del modello: i movimenti pesano pezzi × questo (028)
    group: `Gioiello · ${a.product_type?.name || '—'}`,
    collection: a.collections?.name || null,
    materials: [...new Set((a.article_materials || []).map(m => m.material?.name).filter(Boolean))],
  }))
  const semi = raw.map(r => ({
    kind: 'semilavorato',
    id: r.id,
    code: r.sku,
    provisional: !r.code_confirmed_at,
    name: r.description || [r.raw_categories?.name, r.raw_shapes?.name, r.size].filter(Boolean).join(' '),
    unit: r.unit,
    price: null,
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

// L'elenco è in ordine alfabetico; si propone la prima causale nell'ordine dell'azienda (sort_order, 025),
// così uno scarico parte da Vendita Showroom e non da Omaggio
const proposedReason = reasons => reasons.reduce((a, b) => (b.sort_order < a.sort_order ? b : a), reasons[0])

function renderTypes() {
  $('typeGroup').innerHTML = allowedTypes().map(t => `
    <button type="button" class="mov-type" role="radio" data-type="${t}" aria-checked="${t === state.type}">${TYPES[t]}</button>`).join('')
}

// ─── Dispositivo e bilancia ───────────────────────────────────

function useDevice(device) {
  state.device = device
  $('btnDevice').textContent = device ? `Dispositivo ${device.code}` : 'Scegli il dispositivo'
  if (device) storage.set(DEVICE_KEY, { id: device.id })
  // La fotocamera solo sui tablet e sui telefoni (034); sul PC si legge con la pistola e non si accende mai
  $('btnCamera').hidden = device?.kind !== 'mobile' || cameraSupport() === 'none'
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
  $('scaleBox').hidden = rule().weight === 'model' || (s?.source !== 'simulata' && !state.driver?.connected)  // il gioiello non si pesa (028)
}

// ─── Articolo ────────────────────────────────────────────────

// Pronti per la prossima lettura: sul PC il cursore nel codice, per la pistola. Sul tablet no, altrimenti a ogni
// movimento si aprirebbe la tastiera sopra la pagina
function focusCode() {
  if (state.device?.kind !== 'mobile') $('codeInput').focus()
}

// Lettura con la fotocamera (tablet e telefoni): il testo del QR va dove andrebbe quello della pistola (AC-05)
async function scanWithCamera() {
  if (cameraSupport() === 'https') {
    return showResult(`La fotocamera funziona solo in https. Apri https://${location.hostname}:8443 (la prima volta, ` +
      `per il certificato: http://${location.hostname}:8080/certificato).`, 'error')
  }
  const text = await scanQr()
  if (text) await identify(text)
}

// Lettura dal lettore di codici o codice scritto (F-02): stesso codice = un pezzo in più (REQ-B-03)
async function identify(raw) {
  const code = raw.trim().toUpperCase()
  if (!code) return
  $('codeInput').value = ''
  const item = state.byCode.get(code)
  if (!item) {
    // Un codice archiviato non è sconosciuto (REQ-A-08): l'etichetta può essere ancora in giro
    const found = await findItemByCode(code).catch(() => null)
    showResult(found?.archived
      ? `Articolo archiviato: ${found.code} ${found.name || ''}. Può riattivarlo l'amministrazione.`
      : `Codice sconosciuto: ${raw.trim()}`, 'error')                  // REQ-B-02
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
  $('priceInput').value = ''
  state.priceTouched = false
  renderItemBox()
  $('itemBox').hidden = false
  $('details').hidden = false
  hideResult()
  await loadItemData()
  renderLocations()
  setDefaultWeightKind()
  changed()
}

function renderItemBox() {
  const { item } = state
  $('itemBox').innerHTML = `
    <div class="mov-item-code">${esc(item.code)}${item.provisional ? ' <span class="code-tag">Provvisorio</span>' : ''}</div>
    <div class="mov-item-name">${esc(item.name)}</div>
    <div class="mov-item-meta">${esc(item.group)} · ${UNIT_LABELS[item.unit] || ''}</div>`
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
// Un articolo a pezzi c'è dove ha pezzi: i grammi rimasti in un luogo a zero pezzi (montato caricato col peso e poi
// spostato senza) non bastano, register_movement rifiuterebbe ogni quantità. Solo gli articoli a grammi contano i grammi.
const holds = locationId => state.item?.unit === 'grammi' ? stockAt(locationId).grams > 0 : stockAt(locationId).pieces > 0

// "Da" offre solo i luoghi dove l'articolo c'è: da altrove register_movement rifiuterebbe comunque. "A" offre
// tutti i luoghi attivi. keep tiene la scelta dell'operatore se è ancora possibile (dopo una registrazione).
function renderLocations(keep = false) {
  const locs = activeLocations()
  const held = locs.filter(l => holds(l.id))
  const proposed = state.operator.default_location_id
  const option = l => `<option value="${l.id}">${esc(l.name)}${l.kind === 'fiera' ? ' (fiera)' : ''}</option>`
  const prevFrom = $('fromSelect').value
  const prevTo = $('toSelect').value
  $('fromSelect').innerHTML = held.length ? held.map(option).join('') : '<option value="">Nessun luogo con giacenza</option>'
  $('toSelect').innerHTML = locs.map(option).join('')
  const from = keep && held.some(l => l.id === prevFrom) ? prevFrom
    : (held.find(l => l.id === proposed) || held[0])?.id || ''
  $('fromSelect').value = from
  $('toSelect').value = keep && locs.some(l => l.id === prevTo) ? prevTo
    : state.type === 'T' ? (locs.find(l => l.id !== from && l.id === proposed) || locs.find(l => l.id !== from))?.id || ''
      : proposed || locs[0]?.id || ''
}

// ─── Quantità e peso (REQ-U-01…U-25) ──────────────────────────

const hasHistory = () => state.history.some(l => !l.cancelled)

// Cosa chiede l'articolo in questo movimento, come lo controlla il database (register_movement, 023 e 028).
// weight 'model': il gioiello non si pesa, il peso è pezzi × peso del modello (028)
function rule() {
  const { item, type } = state
  if (!item) return { pieces: true, weight: 'optional', measured: false, firstLoad: false }
  const firstLoad = type === 'C' && !hasHistory()
  if (item.kind === 'montato') return { pieces: true, weight: 'model', measured: false, firstLoad }
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

// Peso del gioiello per i pezzi scritti (028); null se il modello non ha il peso
function modelGrams() {
  const pieces = parseInt($('piecesInput').value, 10)
  const w = state.item?.weight
  return w && pieces >= 1 ? Math.round(w * pieces * 10) / 10 : null
}

function renderQuantity() {
  const r = rule()
  const byModel = r.weight === 'model'
  $('piecesField').hidden = !r.pieces
  $('weightRow').hidden = byModel
  $('weightLabel').innerHTML = `Peso (g)${r.weight === 'required' ? ' <span class="field-required">*</span>' : ''}`
  $('weightKind').hidden = !(r.firstLoad && r.pieces && !byModel)
  $('lastField').hidden = !(state.item?.unit === 'grammi' && state.type !== 'C')
  renderScale()
  if (byModel) {
    const w = state.item.weight
    const grams = modelGrams()
    $('weightHint').innerHTML = !w
      ? `Il modello non ha il peso${state.type === 'C' ? ': per caricarlo inseriscilo nella' : ': si registrano solo i pezzi. Si inserisce nella'} <a href="/article.html?id=${esc(state.item.id)}">scheda dell'articolo</a>.`
      : grams !== null ? `${gramsText(w)} del modello × ${parseInt($('piecesInput').value, 10)} pz = <b>${gramsText(grams)}</b>, calcolato (orientativo).`
        : `${gramsText(w)} a pezzo, dal modello: si calcola sui pezzi (orientativo).`
    return
  }
  const hints = []
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

// ─── Prezzo di vendita (026) ──────────────────────────────────

const selectedReason = () => state.setup.reasons.find(x => x.id === $('reasonSelect').value)
const isSale = () => selectedReason()?.category === 'vendita'

// Il campo c'è solo nelle vendite. Per un gioiello propone listino × pezzi, finché l'operatore non lo cambia.
function renderPrice() {
  const sale = isSale()
  $('priceField').hidden = !sale
  if (!sale) return
  const pieces = parseInt($('piecesInput').value, 10)
  const list = state.item?.price
  const proposal = list && pieces >= 1 ? Math.round(list * pieces * 100) / 100 : null
  if (!state.priceTouched) $('priceInput').value = proposal ? proposal.toFixed(2).replace('.', ',') : ''
  const typed = $('priceInput').value.trim() ? parseEuro($('priceInput').value) : null
  $('priceHint').textContent = typed && !typed.ok ? typed.error
    : proposal && !state.priceTouched ? `Proposto il listino: ${formatEuro(list)} × ${pieces}. Scrivi quanto ha pagato il cliente.`
      : 'Il totale pagato dal cliente per questo movimento.'
  $('priceHint').classList.toggle('field-error', !!typed && !typed.ok)
}

// ─── Richiesta, anteprima e codice ────────────────────────────

function buildRequest() {
  const r = rule()
  const type = state.type
  const reason = selectedReason()
  const fromId = type === 'C' ? null : $('fromSelect').value
  const toId = type === 'S' ? null : $('toSelect').value
  if (!reason) return { error: 'Scegli la causale.' }
  if (type !== 'C' && !fromId) return { error: 'Questo articolo non ha giacenza in nessun luogo: non c\'è niente da far uscire.' }
  if (type === 'T' && fromId === toId) return { error: 'Partenza e arrivo devono essere luoghi diversi.' }

  const pieces = r.pieces ? parseInt($('piecesInput').value, 10) : null
  if (r.pieces && !(pieces >= 1)) return { error: 'Indica quanti pezzi, almeno uno.' }

  // Come register_movement (028): senza peso del modello non si carica, ma si annulla una vendita
  if (r.weight === 'model' && type === 'C' && reason.code !== 'annullamento_vendita' && !state.item.weight) {
    return { error: 'Il modello non ha il peso: inseriscilo nella scheda dell\'articolo, poi carica.' }
  }
  const w = r.weight === 'model'
    ? { ok: true, grams: modelGrams(), source: 'calcolo', scaleId: null }  // lo ricalcola il database (028)
    : readWeight(r)
  if (!w.ok) return { error: w.error }
  let { grams, source, scaleId } = w
  // Peso di un pezzo al primo carico: si registra il totale calcolato, segnato come orientativo (REQ-U-19, U-21)
  if (grams !== null && r.weight !== 'model' && r.firstLoad && r.pieces && weightKind() === 'pezzo') {
    grams = Math.round(grams * pieces * 10) / 10
    source = 'calcolo'
    scaleId = null
  }
  if (grams !== null && grams <= 0) return { error: 'Il peso deve essere maggiore di zero.' }
  if (r.weight === 'required' && grams === null) return { error: 'Per questo articolo serve il peso.' }

  let salePrice = null
  if (reason.category === 'vendita') {
    if (!$('priceInput').value.trim()) return { error: 'Scrivi il prezzo di vendita.' }
    const price = parseEuro($('priceInput').value)
    if (!price.ok) return { error: price.error }
    salePrice = price.value
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
      salePrice,
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
  const price = req.params.salePrice !== null
    ? `<div class="mov-preview-line"><span class="mov-preview-loc">Prezzo di vendita</span><b>${formatEuro(req.params.salePrice)}</b></div>` : ''
  box.innerHTML = (from ? line(from) : '') + (to ? line(to) : '') + price +
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
  // Primo uso: prima si controlla il codice. Il database rifiuta chi salta la conferma (REQ-A-09, A-10)
  if (state.item.provisional) return openCodeCheck(req.params)
  await sendNew(req.params)
}

function sendNew(params, confirmCode = null) {
  const when = new Date()
  return send({ ...params, confirmCode, code: newCode(state.type, when), occurredAt: when.toISOString(), deviceId: state.device.id })
}

// Stesso movimento? Serve se il codice risultasse già usato da un altro movimento. Il peso di un gioiello lo
// calcola il database dal modello (028): può differire se il modello è cambiato nel frattempo, non si confronta.
const sameMovement = (m, p) => m.movement_type === p.type && (m.article_id ?? null) === p.articleId &&
  (m.raw_item_id ?? null) === p.rawItemId && (m.pieces ?? null) === p.pieces &&
  (p.articleId !== null || (m.grams === null ? null : Number(m.grams)) === p.grams) &&
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
    if (params.confirmCode) {
      state.item.provisional = false
      renderItemBox()
    }
    showOutcome(res, params)
    await loadItemData()
    renderLocations(true)
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
  const price = m.sale_price ? `<div>Prezzo di vendita: ${formatEuro(m.sale_price)}</div>` : ''
  showResult(`<b>${res.duplicate ? 'Era già registrato' : 'Registrato'}</b> · ${TYPES[params.type]} ${esc(m.code)}<div>${where}</div>${price}${diff}`, 'ok', true)
}

function afterSuccess() {
  $('piecesInput').value = 1
  $('weightInput').value = ''
  $('weightInput').readOnly = false
  $('noteInput').value = ''
  $('lastInput').checked = false
  $('priceInput').value = ''
  state.priceTouched = false
  state.scaleWeight = null
  changed(false)
  focusCode()
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
  $('reasonSelect').value = reasons.some(r => r.id === current) ? current : proposedReason(reasons)?.id || ''
  renderQuantity()
  renderPrice()
  renderPreview()
}

// ─── Schermata di controllo prima del primo uso (REQ-A-09, CR11) ─

async function openCodeCheck(params) {
  let check
  try {
    check = await getCodeCheck(state.item)
  } catch (err) {
    return showResult(err.message || String(err), 'error')
  }
  // Confermato da qualcun altro nel frattempo: si prosegue
  if (!check.explain) {
    state.item.provisional = false
    renderItemBox()
    return sendNew(params)
  }
  if (check.explain.missing) return showResult(check.explain.missing, 'error')

  // Il codice può essere cambiato da quando la pagina è aperta: si mostra e si conferma quello di adesso
  state.byCode.delete(state.item.code.toUpperCase())
  state.item.code = check.explain.code
  state.byCode.set(state.item.code.toUpperCase(), state.item)
  renderItemBox()
  state.check = { params, code: check.explain.code }
  renderCodeCheck(check)
  lastFocus = document.activeElement
  $('codeCheckModal').classList.add('open')
  // Sulla finestra e non su un pulsante: il lettore chiude ogni lettura con Invio, e non deve confermare (CD-10)
  $('codeCheckBox').focus()
}

function renderCodeCheck({ explain, details }) {
  const isJewel = state.item.kind === 'montato'
  const photo = isJewel ? getCoverPhoto(details.photos) : getCoverPhoto(details.raw_photos)
  const lines = isJewel
    ? [...articleMaterialLines(details), articleMetalLine(details),
       details.price_retail ? `Prezzo: ${formatEuro(details.price_retail)}` : '',
       state.item.weight ? `Peso di un pezzo: ${gramsText(state.item.weight)}` : ''].filter(Boolean)
    : [details.size ? `Misura: ${details.size}` : '', UNIT_LABELS[details.unit] ? `Si muove ${UNIT_LABELS[details.unit]}` : ''].filter(Boolean)
  $('codeCheckBody').innerHTML = `
    <div class="code-check-code">${esc(explain.code)}</div>
    <table class="mov-table code-parts">
      <tbody>${explain.parts.map(p => `<tr><td class="mov-item-code">${esc(p.text)}</td><td>${esc(p.label)}</td><td>${esc(p.meaning)}</td></tr>`).join('')}</tbody>
    </table>
    ${explain.left_out?.length ? `<p class="mov-modal-text">Non ci stanno nel codice: ${esc(explain.left_out.join(', '))}. Restano nella scheda.</p>` : ''}
    <div class="code-check-item">
      ${photo ? `<img src="${esc(photo)}" alt="">` : ''}
      <div>
        <div class="mov-item-name">${esc(state.item.name)}</div>
        ${lines.map(l => `<div class="mov-note">${esc(l)}</div>`).join('')}
      </div>
    </div>
    ${isJewel ? '' : '<p class="mov-modal-text">Il codice di un semilavorato non segue i dati: se è sbagliato, eliminalo e rifallo da Semilavorato.</p>'}
    <p class="code-check-warning">Dopo la conferma questo codice non cambia più.</p>`
  $('btnCodeFix').hidden = !isJewel
}

// Il carico riparte con ciò che era già scritto, anche se il codice cambia
function fixItemData() {
  const draft = {
    itemId: state.item.id,
    type: state.type,
    toId: $('toSelect').value,
    reasonId: $('reasonSelect').value,
    pieces: $('piecesInput').value,
    note: $('noteInput').value,
  }
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch {}
  location.href = `/article.html?id=${encodeURIComponent(state.item.id)}&torna=movimenti`
}

function restoreDraft() {
  let draft = null
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY))
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {}
  if (draft?.itemId !== state.item?.id) return
  if (allowedTypes().includes(draft.type)) state.type = draft.type
  renderTypes()
  renderLocations()
  $('toSelect').value = draft.toId
  $('piecesInput').value = draft.pieces
  $('noteInput').value = draft.note
  changed()
  $('reasonSelect').value = draft.reasonId
  changed()
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
  const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const rows = historyRows()
  // Il trasferimento non aggiunge né toglie: la quantità si mostra senza segno
  const sign = (r, text) => (r.movement_type === 'C' ? '+' : r.movement_type === 'S' ? '−' : '') + text
  const afterText = l => [showPieces ? `${l.pieces_after} pz` : '', showGrams ? gramsText(l.grams_after) : ''].filter(Boolean).join(' · ')
  const place = r => r.movement_type === 'T'
    ? `${esc(locationName(r.m.from_location_id))} → ${esc(locationName(r.m.to_location_id))}`
    : esc(locationName(r.legs[0].location_id))
  const after = r => r.legs.length === 1 ? afterText(r.legs[0])
    : [r.m.from_location_id, r.m.to_location_id].map(id => r.legs.find(l => l.location_id === id)).filter(Boolean)
      .map(l => `${esc(locationName(l.location_id))}: ${afterText(l)}`).join('<br>')

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
    ${rows.length ? `
    <div class="mov-table-scroll">
    <table class="mov-table mov-history">
      <thead><tr>
        <th scope="col">Quando</th><th scope="col">Luogo</th><th scope="col">Movimento</th>
        ${showPieces ? '<th scope="col" class="num">Pezzi</th>' : ''}${showGrams ? '<th scope="col" class="num">Peso</th>' : ''}
        <th scope="col" class="num">Dopo</th><th scope="col">Chi</th>${isAdmin ? '<th scope="col"><span class="sr-only">Azioni</span></th>' : ''}
      </tr></thead>
      <tbody>${rows.map(r => {
        const m = r.m
        const pieces = Math.abs(r.legs[0].pieces)
        const grams = Math.abs(Number(r.legs[0].grams))
        const cancel = isAdmin && !r.cancelled && !m.parent_id
          ? `<button type="button" class="mov-link" data-cancel="${r.movement_id}" data-code="${esc(r.code)}">Annulla</button>` : ''
        return `<tr class="${r.cancelled ? 'is-cancelled' : ''}" title="${esc(r.code)}">
          <td>${when(r.occurred_at)}</td>
          <td>${place(r)}</td>
          <td>${TYPES[r.movement_type]} · ${esc(reasons.get(m.reason_id) || '')}${m.sale_price ? ` · ${formatEuro(m.sale_price)}` : ''}${m.note ? `<div class="mov-note">${esc(m.note)}</div>` : ''}${r.cancelled ? `<div class="mov-note">Annullato: ${esc(m.cancel_reason)}</div>` : ''}</td>
          ${showPieces ? `<td class="num">${pieces ? sign(r, String(pieces)) : ''}</td>` : ''}
          ${showGrams ? `<td class="num">${grams ? sign(r, gramsText(grams)) : ''}${m.weight_source === 'calcolo' ? ' <span class="mov-note">calcolato</span>' : ''}</td>` : ''}
          <td class="num">${r.cancelled ? '—' : after(r)}</td>
          <td>${esc(operators.get(m.operator_id) || '')}</td>
          ${isAdmin ? `<td>${cancel}</td>` : ''}
        </tr>`
      }).join('')}</tbody>
    </table>
    </div>` : '<p class="mov-empty">Nessun movimento.</p>'}`
}

// Una riga per movimento (REQ-M-01): le gambe di movement_history sono una per luogo toccato, quindi due per un
// trasferimento (F-12). Arrivano dal più recente: il movimento resta al posto della sua prima gamba.
function historyRows() {
  const rows = new Map()
  for (const l of state.history) {
    if (!rows.has(l.movement_id)) rows.set(l.movement_id, { ...l, m: l.movement || {}, legs: [] })
    rows.get(l.movement_id).legs.push(l)
  }
  return [...rows.values()]
}

// Annullamento con motivo, solo l'amministrazione (REQ-M-06, M-13, M-14)
async function cancel(id, code) {
  const reason = prompt(`Annullare il movimento ${code}?\n\nResta nello storico, segnato come annullato. Scrivi il motivo:`)
  if (reason === null) return
  try {
    await cancelMovement(id, reason)
    showToast('Movimento annullato')
    await loadItemData()
    renderLocations(true)
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

// Per un dispositivo nuovo si propone il tipo dalla forma: schermo tattile senza mouse = tablet o telefono.
// Lo conferma l'amministrazione, e poi vale il tipo registrato
const suggestedKind = () => window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'pc'

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
    <div class="form-field">
      <label class="field-label" for="newDeviceKind">Tipo</label>
      <select class="field-input field-select" id="newDeviceKind">
        ${Object.entries(KIND_LABELS).map(([k, label]) => `<option value="${k}"${k === suggestedKind() ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="mov-actions"><button type="button" class="btn-ghost" id="btnNewDevice">Registra</button></div>
    ${state.device ? `
    <h3 class="mov-panel-title">Tipo di ${esc(state.device.code)}</h3>
    <div class="mov-radio-list" role="radiogroup" aria-label="Tipo del dispositivo">
      ${Object.entries(KIND_LABELS).map(([k, label]) => `<label><input type="radio" name="deviceKind" value="${k}"${k === (state.device.kind || 'pc') ? ' checked' : ''}> ${label}</label>`).join('')}
    </div>
    <div class="mov-actions"><button type="button" class="btn-ghost" id="btnSaveKind">Salva</button></div>` : ''}
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
      focusCode()
    } else if (e.target.id === 'btnNewDevice') {
      const code = $('newDeviceCode').value.trim().toUpperCase()
      const name = $('newDeviceName').value.trim()
      if (!/^[A-Z0-9]{2,6}$/.test(code)) return showToast('La sigla va da 2 a 6 lettere maiuscole o cifre')
      if (!name) return showToast('Scrivi il nome del dispositivo')
      const device = await insertDevice({ code, name, kind: $('newDeviceKind').value })
      state.setup.devices.push(device)
      useDevice(device)
      renderDeviceModal()
      showToast(`Dispositivo ${code} registrato e in uso`)
    } else if (e.target.id === 'btnSaveKind') {
      const kind = document.querySelector('input[name="deviceKind"]:checked')?.value || 'pc'
      const updated = await setDeviceKind(state.device.id, kind)
      state.setup.devices = state.setup.devices.map(d => d.id === updated.id ? { ...d, ...updated } : d)
      useDevice(state.setup.devices.find(d => d.id === updated.id))
      renderDeviceModal()
      showToast(`${updated.code}: ${kind === 'mobile' ? 'tablet o telefono, con la fotocamera' : 'PC, con la pistola'}`)
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
    if (state.item) renderLocations()
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
  $('btnCamera').addEventListener('click', () => scanWithCamera().catch(err => showToast(err.message, 5000)))
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
  $('priceInput').addEventListener('input', () => {
    state.priceTouched = true
    changed()
  })
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
    focusCode()
  })

  $('itemPanel').addEventListener('click', e => {
    const btn = e.target.closest('[data-cancel]')
    if (btn) cancel(btn.dataset.cancel, btn.dataset.code)
  })

  $('btnDevice').addEventListener('click', () => openModal('deviceModal'))
  $('deviceBody').addEventListener('click', deviceModalClick)

  $('btnCodeFix').addEventListener('click', fixItemData)
  $('btnCodeConfirm').addEventListener('click', () => {
    const { params, code } = state.check
    closeModal('codeCheckModal')
    sendNew(params, code)
  })
  // Invio non preme nessun pulsante di questa finestra: lo manda il lettore di codici (CD-10)
  $('codeCheckModal').addEventListener('keydown', e => {
    if (e.key === 'Enter') e.preventDefault()
  })

  for (const id of ['searchModal', 'deviceModal', 'codeCheckModal']) {
    const modal = $(id)
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close]')) closeModal(id)
    })
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    for (const id of ['searchModal', 'deviceModal', 'codeCheckModal']) if ($(id).classList.contains('open')) closeModal(id)
  })
}

init().catch(err => {
  console.error(err)
  block(`Errore nel caricamento: ${err.message}`)
})
