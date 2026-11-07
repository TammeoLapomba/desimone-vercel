// js/conte.js — Conte e rettifiche (scheda 2.1, migrazioni 040 e 041)
//
// Nell'app (P-01) la parte di F-11 che sta sul dispositivo: aprire una conta, leggere o cercare i codici (REQ-B-03,
// B-04, B-08), pesare (UC-16, UC-17), vedere il riepilogo e confermare (SD-05, REQ-M-09…M-12). Le regole le decide il
// database (stock_count_*): contano tutti gli operatori, differenze e conferma solo l'amministrazione (CR16).
// Chi conta non vede quanto risulta (decisione 5). Ogni lettura si salva subito (decisione 10).
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getMovableItems, getRawCategories, findItemByCode,
  getStockCounts, getStockCount, openStockCount, setStockCountLine, removeStockCountLine, discardStockCount,
  getStockCountSummary, confirmStockCount,
} from './supabase.js'
import { scanQr, cameraSupport } from './scanner.js'
import { showToast } from './utils.js'
import { initMobileNav } from './pwa.js'
import { createScale, sourceFor } from './bilancia/bilancia.js'

window.signOutUser = signOut
const { validaPeso, formatGrams } = window.Pesi

const DEVICE_KEY = 'desimone-os:dispositivo'   // lo sceglie Movimenti: la sua sigla entra nel codice delle rettifiche
const FAMILY_LABELS = { gioielli: 'Gioielli', semilavorati: 'Semilavorati' }
const STATUS_LABELS = { aperta: 'Aperta', confermata: 'Confermata', buttata: 'Buttata' }
const PROBLEMS = {
  'manca il peso': 'Manca il peso',
  'modello senza peso': 'Il modello non ha il peso: scrivilo nella scheda dell\'articolo',
  'mai caricato': 'Mai caricato: caricalo da Movimenti, poi contalo di nuovo',
  'archiviato': 'Archiviato: togli la riga o riattiva l\'articolo',
  'sotto zero': 'La giacenza scenderebbe sotto zero: contalo di nuovo',
}

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const gramsText = g => formatGrams(Math.round(Number(g) * 1000))      // 24.5 → "24,5 g" (REQ-U-08)
const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const label = c => `Conta ${c.number}/${c.year}`
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } } }

const state = {
  operator: null,
  setup: null,         // { locations, reasons, devices, scales, operators }
  categories: [],
  items: new Map(),    // 'a:<id>' o 'r:<id>' → articolo
  byCode: new Map(),
  device: null,
  scale: null,
  driver: null,
  count: null,         // la conta aperta nella pagina, con le righe
  summary: null,
  timer: null,
}

const isAdmin = () => state.operator?.role === 'admin'
const keyOf = (articleId, rawItemId) => articleId ? `a:${articleId}` : `r:${rawItemId}`
const itemOf = line => state.items.get(keyOf(line.article_id, line.raw_item_id))
const locationName = id => state.setup.locations.find(l => l.id === id)?.name || '—'
const operatorName = id => state.setup.operators.find(o => o.id === id)?.name || ''
const categoryName = id => state.categories.find(c => c.id === id)?.name || ''

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()
  state.operator = await getMyOperator()
  if (!state.operator) return block('Il tuo utente non è un operatore: le conte le fanno gli operatori.')
  $('operatorChip').textContent = state.operator.name

  const [setup, items, categories] = await Promise.all([getMovementSetup(), getMovableItems(), getRawCategories()])
  state.setup = setup
  state.categories = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'it'))   // menu in ordine alfabetico
  for (const a of items.articles) {
    const item = { kind: 'montato', id: a.id, code: a.sku, name: a.name, unit: 'montato', categoryId: null }
    state.items.set(`a:${a.id}`, item)
  }
  for (const r of items.raw) {
    const name = r.description || [r.raw_categories?.name, r.raw_shapes?.name, r.size].filter(Boolean).join(' ')
    const item = { kind: 'semilavorato', id: r.id, code: r.sku, name, unit: r.unit, categoryId: r.category_id }
    state.items.set(`r:${r.id}`, item)
  }
  for (const item of state.items.values()) if (item.code) state.byCode.set(item.code.toUpperCase(), item)

  const saved = storage.get(DEVICE_KEY)
  state.device = state.setup.devices.find(d => d.id === saved?.id && !d.revoked_at) || null
  state.scale = state.device ? sourceFor(state.device, state.setup.scales) : null
  $('deviceChip').textContent = state.device ? `Dispositivo ${state.device.code}` : 'Scegli il dispositivo in Movimenti'

  setupListeners()
  const id = new URLSearchParams(location.search).get('id')
  if (id) await showCount(id)
  else await showList()
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

// ─── Elenco e conta nuova ─────────────────────────────────────

async function showList() {
  $('listView').hidden = false
  const counts = await getStockCounts({ limit: 80 })
  const open = counts.filter(c => c.status === 'aperta' && !c.quick)
  const closed = counts.filter(c => c.status !== 'aperta').slice(0, 25)
  $('openList').innerHTML = open.length ? open.map(row).join('') : '<p class="mov-empty">Nessuna conta aperta.</p>'
  $('closedList').innerHTML = closed.length ? closed.map(row).join('') : '<p class="mov-empty">Nessuna conta chiusa.</p>'

  const sede = state.setup.locations.filter(l => l.active && l.kind === 'sede')
  $('newLocation').innerHTML = sede.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')
  if (state.operator.default_location_id && sede.some(l => l.id === state.operator.default_location_id)) {
    $('newLocation').value = state.operator.default_location_id      // il luogo del ruolo (REQ-B-05)
  }
  $('newCategory').innerHTML = '<option value="">Tutte</option>' +
    state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
}

function row(c) {
  const what = [FAMILY_LABELS[c.family], c.category_id ? categoryName(c.category_id) : ''].filter(Boolean).join(' · ')
  const kind = c.quick ? 'correzione di un articolo' : c.complete ? 'completa' : 'parziale'
  const by = c.status === 'aperta'
    ? `aperta da ${esc(operatorName(c.opened_by))} il ${when(c.opened_at)}`
    : `${STATUS_LABELS[c.status].toLowerCase()} da ${esc(operatorName(c.closed_by))} il ${when(c.closed_at)}`
  return `<a class="cnt-row" href="/conte.html?id=${c.id}">
      <span class="cnt-row-title">${label(c)}</span>
      <span>${esc(locationName(c.location_id))} · ${esc(what)} · ${kind}</span>
      <span class="cnt-row-meta">${by}</span>
    </a>`
}

async function submitNew(e) {
  e.preventDefault()
  $('newError').textContent = ''
  const family = $('newFamily').value
  try {
    const count = await openStockCount({
      locationId: $('newLocation').value,
      family,
      categoryId: family === 'semilavorati' ? ($('newCategory').value || null) : null,
      complete: document.querySelector('input[name="newKind"]:checked').value === 'completa',
    })
    location.href = `/conte.html?id=${count.id}`
  } catch (err) {
    $('newError').textContent = err.message
  }
}

// ─── Una conta ────────────────────────────────────────────────

async function showCount(id) {
  state.count = await getStockCount(id)
  if (!state.count) return block('Conta non trovata.')
  $('countView').hidden = false
  renderCount()
  clearInterval(state.timer)
  // Si conta anche in due, da due dispositivi: le righe degli altri arrivano da sole
  state.timer = setInterval(refresh, 15000)
}

async function refresh() {
  if (state.count?.status !== 'aperta' || document.visibilityState !== 'visible') return
  if (document.activeElement?.closest('#linesTable')) return     // non sotto le dita di chi sta scrivendo
  try {
    state.count = await getStockCount(state.count.id)
    renderCount()
  } catch (err) {
    console.error(err)
  }
}

function inPerimeter(item) {
  const c = state.count
  if (c.family === 'gioielli') return item.kind === 'montato'
  return item.kind === 'semilavorato' && (!c.category_id || item.categoryId === c.category_id)
}

function renderCount() {
  const c = state.count
  const open = c.status === 'aperta'
  $('countTitle').textContent = label(c)
  const what = [FAMILY_LABELS[c.family], c.category_id ? categoryName(c.category_id) : ''].filter(Boolean).join(' · ')
  const kind = c.quick ? 'Correzione di un articolo' : c.complete ? 'Completa: ciò che non si conta va a zero' : 'Parziale: cambia solo ciò che si conta'
  const status = open ? `Aperta da ${operatorName(c.opened_by)} il ${when(c.opened_at)}`
    : `${STATUS_LABELS[c.status]} da ${operatorName(c.closed_by)} il ${when(c.closed_at)}` +
      (c.status === 'confermata' ? `. Le rettifiche sono nel Registro, con il riferimento "${label(c)}"` : '')
  $('countSub').innerHTML = `${esc(locationName(c.location_id))} · ${esc(what)}<br>${esc(kind)}<br>${esc(status)}`

  $('countOpen').hidden = !open
  $('countActions').hidden = !open
  $('btnSummary').hidden = !isAdmin()
  $('btnDiscard').hidden = !(isAdmin() || state.operator.id === c.opened_by)
  $('blindNote').hidden = isAdmin()
  $('btnCamera').hidden = state.device?.kind !== 'mobile' || cameraSupport() === 'none'
  if (!open) $('summaryCard').hidden = true
  renderLines()
}

function scaleUsable() {
  return !!state.scale?.source && state.scale.source !== 'sede'
}

function renderLines() {
  const c = state.count
  const open = c.status === 'aperta'
  const lines = c.lines
  const showPieces = lines.some(l => itemOf(l)?.unit !== 'grammi') || c.family === 'gioielli'
  const showGrams = c.family === 'semilavorati'
  if (!lines.length) {
    $('linesTable').innerHTML = ''
    $('linesCount').textContent = open ? 'Ancora niente: leggi il primo codice.' : 'Nessun articolo contato.'
    return
  }
  $('linesTable').innerHTML = `
    <thead><tr>
      <th scope="col">Codice</th><th scope="col">Articolo</th>
      ${showPieces ? '<th scope="col" class="num">Pezzi</th>' : ''}${showGrams ? '<th scope="col" class="num">Peso</th>' : ''}
      <th scope="col">Chi</th>${open ? '<th scope="col"><span class="sr-only">Azioni</span></th>' : ''}
    </tr></thead>
    <tbody>${lines.map(l => {
      const item = itemOf(l) || { code: '?', name: '', unit: l.article_id ? 'montato' : 'pezzi' }
      const hasPieces = item.unit !== 'grammi'
      const hasGrams = item.unit === 'grammi' || item.unit === 'pezzi_grammi' || (item.unit === 'pezzi' && l.grams !== null)
      const pieces = !showPieces ? '' : `<td class="num">${!hasPieces ? '—' : open
        ? `<input class="field-input cnt-num" type="number" min="0" step="1" inputmode="numeric" data-line="${l.id}" data-field="pieces" value="${l.pieces ?? ''}" aria-label="Pezzi di ${esc(item.code)}">`
        : l.pieces}</td>`
      const gramsValue = l.grams === null ? '' : Number(l.grams).toFixed(1).replace('.', ',')
      const grams = !showGrams ? '' : `<td class="num">${!hasGrams && !open ? '' : open && item.unit !== 'montato'
        ? `<input class="field-input cnt-num" inputmode="decimal" data-line="${l.id}" data-field="grams" value="${esc(gramsValue)}" aria-label="Peso di ${esc(item.code)} in grammi"${l.weight_source === 'bilancia' ? ' readonly title="Dalla bilancia: cancella per scriverlo a mano"' : ''}>
           ${scaleUsable() ? `<button type="button" class="mov-link" data-scale="${l.id}">Bilancia</button>` : ''}
           ${l.weight_source === 'bilancia' ? '<div class="mov-note">dalla bilancia</div>' : ''}`
        : l.grams !== null ? gramsText(l.grams) : ''}</td>`
      return `<tr>
        <td class="cnt-code">${esc(item.code)}</td><td>${esc(item.name)}</td>${pieces}${grams}
        <td class="mov-note">${esc(operatorName(l.counted_by))}<br>${when(l.counted_at)}</td>
        ${open ? `<td><button type="button" class="mov-link" data-remove="${l.id}" aria-label="Togli ${esc(item.code)} dalla conta">Togli</button></td>` : ''}
      </tr>`
    }).join('')}</tbody>`
  $('linesCount').textContent = `${lines.length} ${lines.length === 1 ? 'articolo contato' : 'articoli contati'}`
}

function showRead(message, kind = 'ok') {
  const box = $('readResult')
  box.textContent = message
  box.className = `mov-result is-${kind}`
  box.hidden = false
}

// Un codice letto o scritto: se è uno dei nostri, un pezzo in più; altrimenti si cerca per codice o nome (REQ-B-08)
async function handleCode(raw) {
  const text = raw.trim()
  $('codeInput').value = ''
  $('matches').hidden = true
  if (!text) return
  const item = state.byCode.get(text.toUpperCase())
  if (item) return addReading(item)
  const needle = text.toLowerCase()
  const found = [...state.items.values()]
    .filter(i => inPerimeter(i) && (i.code?.toLowerCase().includes(needle) || i.name?.toLowerCase().includes(needle)))
    .slice(0, 12)
  if (found.length) {
    $('readResult').hidden = true
    $('matches').innerHTML = found.map(i => `<button type="button" class="cnt-match" data-key="${keyOf(i.kind === 'montato' ? i.id : null, i.kind === 'montato' ? null : i.id)}">
        <span class="cnt-code">${esc(i.code)}</span> ${esc(i.name)}</button>`).join('')
    $('matches').hidden = false
    return
  }
  const other = await findItemByCode(text.toUpperCase()).catch(() => null)
  showRead(other?.archived ? `Articolo archiviato: ${other.code}. Può riattivarlo l'amministrazione.`     // REQ-A-08
    : `Codice sconosciuto: ${text}`, 'error')                                                      // REQ-B-02
}

async function addReading(item) {
  if (!inPerimeter(item)) {
    return showRead(`${item.code} non entra in questa conta: è ${item.kind === 'montato' ? 'un gioiello' : 'un semilavorato'}` +
      `${item.kind === 'semilavorato' && state.count.category_id ? ' di un\'altra categoria' : ''}.`, 'error')
  }
  try {
    const line = await setStockCountLine({
      countId: state.count.id,
      articleId: item.kind === 'montato' ? item.id : null,
      rawItemId: item.kind === 'semilavorato' ? item.id : null,
      add: true,
    })
    await reloadLines()
    if (item.unit === 'grammi') {
      showRead(`${item.code} ${item.name}: si conta a grammi, scrivi il peso o leggilo dalla bilancia.`, 'warn')
      document.querySelector(`[data-line="${line.id}"][data-field="grams"]`)?.focus()
    } else {
      showRead(`+1 · ${item.code} ${item.name}: ${line.pieces} ${line.pieces === 1 ? 'pezzo' : 'pezzi'}`)
    }
  } catch (err) {
    showRead(err.message, 'error')
  }
}

async function reloadLines() {
  state.count = await getStockCount(state.count.id)
  renderCount()
}

// Pezzi e peso di una riga, come li ha scritti chi conta. 0 g vale: si è contato e non c'è niente
function readGrams(text) {
  const t = text.trim()
  if (t === '') return { ok: true, grams: null }
  if (/^0+([.,]0?)?$/.test(t)) return { ok: true, grams: 0 }
  const v = validaPeso(t)
  return v.ok ? { ok: true, grams: v.mg / 1000 } : { ok: false, error: v.error || v.message }
}

async function saveLine(lineId, changes = {}) {
  const line = state.count.lines.find(l => l.id === lineId)
  const item = itemOf(line)
  const piecesInput = document.querySelector(`[data-line="${lineId}"][data-field="pieces"]`)
  const gramsInput = document.querySelector(`[data-line="${lineId}"][data-field="grams"]`)
  const pieces = piecesInput ? (piecesInput.value === '' ? null : parseInt(piecesInput.value, 10)) : line.pieces
  let grams = line.grams, source = line.weight_source, scaleId = line.scale_id
  if ('grams' in changes) {
    ({ grams, source, scaleId } = changes)
  } else if (gramsInput && !gramsInput.readOnly) {
    const g = readGrams(gramsInput.value)
    if (!g.ok) return showRead(`${item.code}: ${g.error}`, 'error')
    grams = g.grams
    source = grams === null ? null : 'mano'
    scaleId = null
  }
  if (piecesInput && (pieces === null || pieces < 0 || Number.isNaN(pieces))) {
    return showRead(`${item.code}: scrivi quanti pezzi ci sono, anche 0.`, 'error')
  }
  try {
    await setStockCountLine({
      countId: state.count.id,
      articleId: line.article_id, rawItemId: line.raw_item_id,
      pieces: item.unit === 'grammi' ? null : pieces,
      grams: item.unit === 'montato' ? null : grams,
      weightSource: item.unit === 'montato' ? null : source,
      scaleId: source === 'bilancia' ? scaleId : null,
    })
    await reloadLines()
    showRead(`${item.code} salvato.`)
  } catch (err) {
    showRead(err.message, 'error')
  }
}

function getDriver() {
  if (!scaleUsable()) return null
  if (!state.driver) state.driver = createScale({ source: state.scale.source })
  return state.driver
}

// Peso dalla bilancia, solo stabile (REQ-I-03.1, I-04)
async function readScale(lineId, btn) {
  const driver = getDriver()
  if (!driver) return
  btn.disabled = true
  btn.textContent = 'Attendo il peso stabile…'
  try {
    const reading = await driver.readStable()
    if (reading.grams < 0) throw new Error('La bilancia segna un peso negativo: azzerala')
    await saveLine(lineId, { grams: reading.grams, source: 'bilancia', scaleId: state.scale.scale.id })
  } catch (err) {
    showRead(err.message, 'error')
    btn.disabled = false
    btn.textContent = 'Bilancia'
  }
}

// ─── Riepilogo e conferma: solo l'amministrazione ─────────────

const signed = (n, text) => (n > 0 ? '+' : n < 0 ? '−' : '') + text
function qty(unit, pieces, grams) {
  return [unit !== 'grammi' && pieces !== null && pieces !== undefined ? `${pieces} pz` : '',
          unit !== 'montato' && grams !== null && grams !== undefined ? gramsText(grams) : ''].filter(Boolean).join(' · ') || '—'
}
function diffText(r) {
  const parts = []
  if (r.diff_pieces) parts.push(signed(r.diff_pieces, `${Math.abs(r.diff_pieces)} pz`))
  if (r.unit !== 'montato' && Number(r.diff_grams)) parts.push(signed(Number(r.diff_grams), gramsText(Math.abs(r.diff_grams))))
  return parts.join(' · ')
}

async function showSummary() {
  try {
    state.summary = await getStockCountSummary(state.count.id)
  } catch (err) {
    return showRead(err.message, 'error')
  }
  const rows = state.summary.rows
  const changes = rows.filter(r => diffText(r))
  const problems = rows.filter(r => r.problem)
  $('summaryTable').innerHTML = rows.length ? `
    <thead><tr>
      <th scope="col">Codice</th><th scope="col">Articolo</th><th scope="col" class="num">Contato</th>
      <th scope="col" class="num">Risultava</th><th scope="col" class="num">Ora risulta</th><th scope="col" class="num">Differenza</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.problem ? 'cnt-problem' : ''}">
      <td class="cnt-code">${esc(r.code)}</td>
      <td>${esc(r.name)}${r.problem ? `<div class="cnt-problem-text">${esc(PROBLEMS[r.problem] || r.problem)}</div>` : ''}</td>
      <td class="num">${r.counted ? qty(r.unit, r.counted_pieces, r.counted_grams) : '<span class="mov-note">non contato: va a zero</span>'}</td>
      <td class="num">${qty(r.unit, r.recorded_pieces, r.recorded_grams)}</td>
      <td class="num">${qty(r.unit, r.current_pieces, r.current_grams)}</td>
      <td class="num cnt-diff">${diffText(r) || '<span class="mov-note">nessuna</span>'}</td>
    </tr>`).join('')}</tbody>` : ''
  const box = $('summaryResult')
  box.hidden = false
  box.className = `mov-result is-${problems.length ? 'error' : changes.length ? 'warn' : 'ok'}`
  box.textContent = problems.length
    ? `${problems.length} ${problems.length === 1 ? 'articolo ferma' : 'articoli fermano'} la conferma: guarda le righe in rosso.`
    : changes.length
      ? `${changes.length} ${changes.length === 1 ? 'rettifica' : 'rettifiche'} da registrare.`
      : 'Nessuna differenza: confermando, la conta si chiude senza rettifiche.'
  $('btnConfirm').disabled = problems.length > 0
  $('summaryCard').hidden = false
  $('summaryCard').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function confirmCount() {
  if (!state.device) {
    return showSummaryError('Scegli prima il dispositivo in Movimenti: la sua sigla entra nel codice delle rettifiche.')
  }
  const n = state.summary?.rows.filter(r => diffText(r)).length ?? 0
  if (!confirm(`Confermare la ${label(state.count)}?\n\n${n ? `Si registrano ${n} ${n === 1 ? 'rettifica' : 'rettifiche'}.` : 'Nessuna rettifica: la conta si chiude.'} Poi la conta non si cambia più; una rettifica si annulla dai Movimenti.`)) return
  $('btnConfirm').disabled = true
  try {
    const res = await confirmStockCount(state.count.id, state.device.id)
    showToast(`${res.label} confermata: ${res.movements} ${res.movements === 1 ? 'rettifica' : 'rettifiche'}`)
    $('summaryCard').hidden = true
    await reloadLines()
  } catch (err) {
    showSummaryError(err.message)
    $('btnConfirm').disabled = false
  }
}

function showSummaryError(message) {
  const box = $('summaryResult')
  box.className = 'mov-result is-error'
  box.textContent = message
  box.hidden = false
}

async function discardCount() {
  if (!confirm(`Buttare la ${label(state.count)}?\n\nLa giacenza non cambia, e la conta resta nell'elenco come buttata.`)) return
  try {
    await discardStockCount(state.count.id)
    location.href = '/conte.html'
  } catch (err) {
    showRead(err.message, 'error')
  }
}

// ─── Eventi ──────────────────────────────────────────────────

function setupListeners() {
  $('btnNew').addEventListener('click', () => { $('newForm').hidden = false; $('newLocation').focus() })
  $('btnNewCancel').addEventListener('click', () => { $('newForm').hidden = true })
  $('newFamily').addEventListener('change', () => { $('newCategoryField').hidden = $('newFamily').value !== 'semilavorati' })
  $('newForm').addEventListener('submit', submitNew)

  $('codeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleCode($('codeInput').value) }
  })
  $('matches').addEventListener('click', e => {
    const btn = e.target.closest('[data-key]')
    if (!btn) return
    $('matches').hidden = true
    addReading(state.items.get(btn.dataset.key))
  })
  $('btnCamera').addEventListener('click', async () => {
    if (cameraSupport() === 'https') {
      return showRead(`La fotocamera funziona solo in https. Apri https://${location.hostname}:8443.`, 'error')
    }
    const text = await scanQr()
    if (text) await handleCode(text)
  })

  $('linesTable').addEventListener('change', e => {
    const input = e.target.closest('[data-line]')
    if (input) saveLine(input.dataset.line)
  })
  $('linesTable').addEventListener('keydown', e => {
    const input = e.target.closest('[data-line]')
    if (input && e.key === 'Enter') { e.preventDefault(); input.blur() }
  })
  $('linesTable').addEventListener('click', async e => {
    const remove = e.target.closest('[data-remove]')
    if (remove) {
      try {
        await removeStockCountLine(remove.dataset.remove)
        await reloadLines()
      } catch (err) {
        showRead(err.message, 'error')
      }
      return
    }
    const scale = e.target.closest('[data-scale]')
    if (scale) return readScale(scale.dataset.scale, scale)
    // Un peso dalla bilancia non si modifica: si cancella e si scrive a mano (D-3)
    const input = e.target.closest('input[readonly][data-field="grams"]')
    if (input && confirm('Il peso viene dalla bilancia. Scriverlo a mano?')) {
      input.readOnly = false
      input.value = ''
      input.focus()
    }
  })

  $('btnSummary').addEventListener('click', showSummary)
  $('btnSummaryClose').addEventListener('click', () => { $('summaryCard').hidden = true })
  $('btnConfirm').addEventListener('click', confirmCount)
  $('btnDiscard').addEventListener('click', discardCount)
}

init().catch(err => {
  console.error(err)
  block(`Non riesco ad aprire le conte: ${err.message || err}`)
})
