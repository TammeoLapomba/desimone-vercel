// js/scheda.js — Ciò che le due schede hanno in comune: dove si trova, ultimi movimenti, storico delle modifiche, azioni.
// Montato e semilavorato sono due sezioni diverse, con una pagina ciascuna (scheda 2.4): catalog-scheda.js e
// semilavorato-scheda.js dicono quali dati mostrare e come si modifica. La scheda legge e basta (SC-05).
// Nella WBA: F-13 mostrare giacenze e storico su L-01, P-01 (REQ-001.1, M-01, M-08).
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getItemStock, getMovements, getItemChanges, findItemByCode,
  retirePreview, retireItem, restoreItem,
} from './supabase.js'
import { showToast, confirmRetire, getCoverPhoto, formatEuro } from './utils.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const TYPES = { C: 'Carico', S: 'Scarico', T: 'Trasferimento', R: 'Rettifica' }
const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const CHANGES_LIMIT = 100

const $ = id => document.getElementById(id)
export const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
const gramsText = g => `${num(g, 1)} g`
const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
  $('scheda').hidden = true
}

// La scheda è di un tipo solo: un codice dell'altra sezione porta alla pagina giusta
async function resolveId(config) {
  const query = new URLSearchParams(location.search)
  if (query.get('id')) return query.get('id')
  const code = query.get('codice')
  if (!code) return null
  const found = await findItemByCode(code)
  if (!found) return null
  if (found.kind !== config.kind) {
    location.replace(`${found.kind === 'montato' ? '/catalog-scheda.html' : '/semilavorato-scheda.html'}?id=${encodeURIComponent(found.id)}`)
    return undefined
  }
  return found.id
}

export async function openScheda(config) {
  await requireAuth()
  initMobileNav()
  const operator = await getMyOperator()
  if (!operator) return block('La scheda è per gli operatori: il tuo utente non è un operatore.')
  $('operatorChip').textContent = `${operator.name} · ${ROLE_LABELS[operator.role]}`
  const id = await resolveId(config)
  if (id === undefined) return   // si sta spostando sull'altra sezione
  if (!id) return block('Articolo non trovato.')

  const ctx = { config, id, isAdmin: operator.role === 'admin', setup: await getMovementSetup() }
  ctx.owner = config.kind === 'montato' ? { articleId: id } : { rawItemId: id }
  await render(ctx)
}

async function render(ctx) {
  const { config, isAdmin } = ctx
  const item = await config.load(ctx.id)
  if (!item) return block('Articolo non trovato: forse è stato eliminato.')
  // Un articolo archiviato lo vede solo l'amministrazione (decisione 8)
  if (item.deleted_at && !isAdmin) return block('Questo articolo è archiviato: lo vede solo l\'amministrazione.')
  ctx.item = item
  document.title = `De Simone OS — ${config.name(item)}`

  const stock = await renderStock(ctx)
  renderIdentity(ctx, stock)
  $('data').innerHTML = `<dl class="sch-data">${config.dataRows(item).filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>`
  $('scheda').hidden = false
  await Promise.all([renderMovements(ctx), renderChanges(ctx)])
}

// ─── Identità e azioni ────────────────────────────────────────

function renderIdentity(ctx, stock) {
  const { config, item, isAdmin } = ctx
  const cover = getCoverPhoto(config.photos(item))
  const code = item.sku
  const q = encodeURIComponent(code)
  const canShare = !!navigator.share
  const archived = !!item.deleted_at
  $('identity').innerHTML = `
    <div class="sch-cover">${cover ? `<img src="${esc(cover)}" alt="">` : '<span>Nessuna foto</span>'}</div>
    <div class="sch-group">${esc(config.group(item))}</div>
    <h1 class="sch-name">${esc(config.name(item))}</h1>
    ${archived ? '<p class="sch-archived">Archiviato</p>' : ''}
    <div class="sch-code">
      <code id="codeText">${esc(code)}</code>
      <span class="code-tag">${item.code_confirmed_at ? 'Definitivo' : 'Provvisorio'}</span>
    </div>
    <div class="sch-code-actions">
      <button type="button" class="btn-ghost" id="btnCopy">Copia il codice</button>
      ${canShare ? '<button type="button" class="btn-ghost" id="btnShare">Condividi</button>' : ''}
    </div>
    <div class="sch-actions">
      ${archived ? '' : `<a class="btn-primary" href="/movimenti.html?codice=${q}">Movimenta</a>`}
      ${archived ? '' : '<button type="button" class="btn-ghost" id="btnEdit">Modifica</button>'}
      ${isAdmin && !archived ? `<a class="btn-ghost" href="/movimenti.html?codice=${q}&correggi=1">Correggi la giacenza</a>` : ''}
      ${isAdmin && !archived ? '<button type="button" class="btn-danger" id="btnRetire">Archivia o elimina</button>' : ''}
      ${isAdmin && archived ? '<button type="button" class="btn-primary" id="btnRestore">Riattiva</button>' : ''}
    </div>`

  $('btnCopy').addEventListener('click', () => copyCode(code))
  $('btnShare')?.addEventListener('click', () => navigator.share({ title: config.name(item), text: code }).catch(() => {}))
  $('btnEdit')?.addEventListener('click', () => config.edit(item, stock, () => render(ctx)))
  $('btnRetire')?.addEventListener('click', e => retire(ctx, e.currentTarget))
  $('btnRestore')?.addEventListener('click', e => restore(ctx, e.currentTarget))
}

// Il pulsante vale anche in sede senza HTTPS, dove il browser non dà gli appunti: prima il vecchio comando,
// poi il codice selezionato, da copiare con la tastiera (SC-10)
async function copyCode(code) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('niente appunti')
    await navigator.clipboard.writeText(code)
    return showToast(`Copiato: ${code}`)
  } catch { /* si prova l'altro modo */ }
  const range = document.createRange()
  range.selectNodeContents($('codeText'))
  const selection = getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  let copied = false
  try { copied = document.execCommand('copy') } catch { /* resta selezionato */ }
  showToast(copied ? `Copiato: ${code}` : 'Codice selezionato: premi Ctrl + C', 4000)
}

async function retire(ctx, btn) {
  const { config, item, owner } = ctx
  btn.disabled = true
  try {
    if (!confirmRetire({ code: item.sku, name: config.name(item) }, await retirePreview(owner))) {
      btn.disabled = false
      return
    }
    const action = await retireItem(owner)
    showToast(`Articolo ${item.sku} ${action === 'deleted' ? 'eliminato' : 'archiviato'}`)
    setTimeout(() => { location.href = config.listHref }, 900)
  } catch (err) {
    console.error(err)
    showToast(err.message, 6000)
    btn.disabled = false
  }
}

async function restore(ctx, btn) {
  btn.disabled = true
  try {
    await restoreItem(ctx.owner)
    showToast('Articolo riattivato')
    await render(ctx)
  } catch (err) {
    console.error(err)
    showToast(err.message, 6000)
    btn.disabled = false
  }
}

// ─── Dove si trova ────────────────────────────────────────────

async function renderStock(ctx) {
  const { config, item, isAdmin, setup } = ctx
  const names = new Map(setup.locations.map(l => [l.id, l.name]))
  const unit = config.unit(item)
  const showPieces = unit !== 'grammi'
  const showGrams = unit !== 'pezzi'
  const rows = (await getItemStock(ctx.owner)).filter(r => Number(r.pieces) || Number(r.grams))
    .map(r => ({ name: names.get(r.location_id) || '—', pieces: Number(r.pieces) || 0, grams: Number(r.grams) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
  const total = rows.reduce((t, r) => ({ pieces: t.pieces + r.pieces, grams: t.grams + r.grams }), { pieces: 0, grams: 0 })
  const cells = r => `${showPieces ? `<td class="num">${num(r.pieces)}</td>` : ''}${showGrams ? `<td class="num">${gramsText(r.grams)}</td>` : ''}`
  const values = isAdmin ? config.values?.(item, total) || [] : []   // Il valore solo all'amministrazione (REQ-M-08)
  $('stock').innerHTML = (rows.length ? `
    <div class="mov-table-scroll"><table class="mov-table">
      <thead><tr><th scope="col">Luogo</th>${showPieces ? '<th scope="col" class="num">Pezzi</th>' : ''}${showGrams ? '<th scope="col" class="num">Peso</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td>${cells(r)}</tr>`).join('')}</tbody>
      ${rows.length > 1 ? `<tfoot><tr><th scope="row">Totale</th>${cells(total)}</tr></tfoot>` : ''}
    </table></div>` : '<p class="mov-empty">Nessuna giacenza registrata con i movimenti.</p>')
    + (values.length ? `<dl class="sch-data sch-values">${values.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '')
  return { stock: total.pieces, stock_grams: total.grams }
}

// ─── Ultimi movimenti ─────────────────────────────────────────

async function renderMovements(ctx) {
  const { item, setup, owner } = ctx
  const box = $('movements')
  try {
    const locations = new Map(setup.locations.map(l => [l.id, l.name]))
    const reasons = new Map(setup.reasons.map(r => [r.id, r.name]))
    const operators = new Map(setup.operators.map(o => [o.id, o.name]))
    const place = id => esc(locations.get(id) || '—')
    const sign = (m, value) => m.movement_type === 'R' ? (value < 0 ? '−' : '+') : m.movement_type === 'C' ? '+' : m.movement_type === 'S' ? '−' : ''
    const rows = await getMovements({ ...owner, withCancelled: true }, { limit: 10 })
    const all = `<a class="mov-link" href="/registro.html?codice=${encodeURIComponent(item.sku)}">Tutti i movimenti</a>`
    if (!rows.length) {
      box.innerHTML = '<p class="mov-empty">Nessun movimento.</p>'
      return
    }
    box.innerHTML = `
      <div class="mov-table-scroll"><table class="mov-table">
        <thead><tr><th scope="col">Quando</th><th scope="col">Movimento</th><th scope="col">Luogo</th><th scope="col" class="num">Pezzi</th><th scope="col" class="num">Peso</th><th scope="col">Chi</th></tr></thead>
        <tbody>${rows.map(m => `
          <tr class="${m.cancelled_at ? 'is-cancelled' : ''}">
            <td>${when(m.occurred_at)}</td>
            <td>${m.movement_type === 'R' ? '' : `${TYPES[m.movement_type]} · `}${esc(reasons.get(m.reason_id) || '')}${m.document_ref ? ` · ${esc(m.document_ref)}` : ''}${m.sale_price ? ` · ${formatEuro(m.sale_price)}` : ''}
              ${m.note ? `<div class="mov-note">${esc(m.note)}</div>` : ''}
              ${m.cancelled_at ? `<div class="mov-note">Annullato: ${esc(m.cancel_reason)}</div>` : ''}</td>
            <td>${m.movement_type === 'T' ? `${place(m.from_location_id)} → ${place(m.to_location_id)}` : place(m.from_location_id || m.to_location_id)}</td>
            <td class="num">${m.pieces ? sign(m, m.pieces) + num(Math.abs(m.pieces)) : ''}</td>
            <td class="num">${m.grams ? sign(m, Number(m.grams)) + gramsText(Math.abs(m.grams)) : ''}</td>
            <td>${esc(operators.get(m.operator_id) || '')}</td>
          </tr>`).join('')}</tbody>
      </table></div>${all}`
  } catch (err) {
    console.error(err)
    box.innerHTML = `<p class="mov-empty">Non riesco a leggere i movimenti: ${esc(err.message)}</p>`
  }
}

// ─── Storico delle modifiche: solo l'amministrazione (decisione 3, SC-06) ─────────

async function renderChanges(ctx) {
  const card = $('changesCard')
  card.hidden = !ctx.isAdmin
  if (!ctx.isAdmin) return
  const box = $('changes')
  try {
    const rows = await getItemChanges({ ...ctx.owner, limit: CHANGES_LIMIT })
    box.innerHTML = rows.length ? `
      <div class="mov-table-scroll"><table class="mov-table">
        <thead><tr><th scope="col">Quando</th><th scope="col">Chi</th><th scope="col">Cosa</th><th scope="col">Prima</th><th scope="col">Dopo</th></tr></thead>
        <tbody>${rows.map(c => `
          <tr><td>${when(c.changed_at)}</td><td>${esc(c.author)}</td><td>${esc(c.field)}</td><td>${esc(c.old_value ?? '—')}</td><td>${esc(c.new_value ?? '—')}</td></tr>`).join('')}</tbody>
      </table></div>
      ${rows.length === CHANGES_LIMIT ? `<p class="mov-note">Le ${CHANGES_LIMIT} modifiche più recenti.</p>` : ''}`
      : '<p class="mov-empty">Nessuna modifica registrata.</p>'
  } catch (err) {
    console.error(err)
    box.innerHTML = `<p class="mov-empty">Non riesco a leggere lo storico: ${esc(err.message)}</p>`
  }
}
