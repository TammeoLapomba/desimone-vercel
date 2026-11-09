// js/lettore.js — Il lettore di codici in ogni pagina (scheda 3.1, H1, H5)
//
// Il Datalogic scrive come una tastiera, molto più in fretta di una persona, e chiude con Invio. Quando il cursore
// non è in un campo, una scrittura così veloce è una lettura: la pagina la riceve come evento "lettura" e, se non la
// usa lei (Movimenti e Conta la prendono con preventDefault), si apre una finestra con l'articolo, la sua giacenza
// in ogni luogo (REQ-I-08) e dove andare. Il codice si riconosce con read_code (043): nostro, vecchio QR di STEP o
// protocollo scritto a mano (REQ-L-09); se non c'è, lo dice (REQ-B-02).
import { readCode, getItemStockByPlace, getMyRole } from './supabase.js'
import { gramsText } from './utils.js'

// Fra un carattere e l'altro: il lettore ne manda uno ogni pochi millisecondi, una persona uno ogni 100 o più
const MAX_GAP_MS = 60
const MIN_LENGTH = 3

let buffer = ''
let last = 0
let modal = null
let returnFocus = null
let role

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function editable(el) {
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

// Un'altra finestra aperta (non la nostra): la lettura resta fuori, come se il lettore non ci fosse
function otherModalOpen() {
  return [...document.querySelectorAll('.modal-overlay.open')].some(m => m !== modal)
}

document.addEventListener('keydown', e => {
  // AltGr, sulla tastiera italiana, arriva come Ctrl + Alt: con quello il lettore scrive, non è una scorciatoia
  const shortcut = (e.ctrlKey || e.altKey || e.metaKey) && !e.getModifierState?.('AltGraph')
  if (shortcut || editable(e.target)) {
    buffer = ''
    return
  }
  const now = performance.now()
  if (e.key === 'Enter') {
    const text = buffer
    buffer = ''
    if (text.length >= MIN_LENGTH && now - last <= MAX_GAP_MS && !otherModalOpen()) {
      e.preventDefault()
      e.stopPropagation()
      deliver(text)
    }
    return
  }
  if (e.key.length !== 1) return   // Maiuscole, Tab e simili: il lettore li usa per scrivere, non contano
  buffer = now - last > MAX_GAP_MS ? e.key : buffer + e.key
  last = now
  // Dentro una lettura i caratteri non vanno alla pagina: uno spazio di un vecchio QR premerebbe il pulsante col
  // cursore. Il primo carattere passa, perché ancora non si sa se è il lettore o una persona
  if (buffer.length > 1) e.preventDefault()
})

function deliver(text) {
  const event = new CustomEvent('lettura', { detail: { text }, cancelable: true })
  document.dispatchEvent(event)
  if (!event.defaultPrevented) show(text)
}

// ─── La finestra ──────────────────────────────────────────────

function build() {
  modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'readerModal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'readerTitle')
  modal.innerHTML = `
    <div class="modal modal-compact">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow" id="readerSub">Lettura</div>
          <div class="modal-title" id="readerTitle"></div>
        </div>
        <button type="button" data-close aria-label="Chiudi" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" id="readerBody" aria-live="polite"></div>
      <div class="modal-footer" id="readerActions"></div>
    </div>`
  document.body.appendChild(modal)
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) close() })
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
}

function close() {
  modal.classList.remove('open')
  returnFocus?.focus?.()
}

function render({ sub, title, body, actions = '' }) {
  modal.querySelector('#readerSub').textContent = sub
  modal.querySelector('#readerTitle').textContent = title
  modal.querySelector('#readerBody').innerHTML = body
  modal.querySelector('#readerActions').innerHTML = actions + '<button type="button" class="btn-ghost" data-close>Chiudi</button>'
}

const qty = (unit, pieces, grams) =>
  unit === 'grammi' ? gramsText(grams) : unit === 'pezzi_grammi' ? `${pieces} pz · ${gramsText(grams)}` : `${pieces} pz`

async function show(text) {
  if (!modal) build()
  if (!modal.classList.contains('open')) returnFocus = document.activeElement
  render({ sub: 'Lettura', title: text.trim(), body: '<p class="field-hint">Cerco il codice…</p>' })
  modal.classList.add('open')
  modal.querySelector('[data-close]').focus()

  let found
  try {
    found = await readCode(text)
  } catch (err) {
    return render({ sub: 'Lettura', title: text.trim(), body: `<p class="field-error">${esc(err.message)}</p>` })
  }
  if (!found) {
    return render({ sub: 'Lettura', title: 'Codice sconosciuto', body: `<p>Nessun articolo ha il codice <strong>${esc(text.trim())}</strong>.</p>` })
  }
  const kindLabel = found.kind === 'montato' ? 'Gioiello' : 'Semilavorato'
  const legacy = found.via !== 'codice' ? '<p class="field-hint">Vecchia etichetta di STEP.</p>' : ''
  if (found.archived) {
    return render({ sub: kindLabel, title: `${found.code} ${found.name || ''}`,
      body: `${legacy}<p>Articolo archiviato: può riattivarlo l'amministrazione.</p>` })
  }

  const code = encodeURIComponent(found.code)
  const card = found.kind === 'montato' ? `<a class="btn-ghost" href="/article.html?id=${encodeURIComponent(found.id)}">Scheda</a>` : ''
  // Il dev non è un operatore: giacenze, storico e movimenti non sono per lui (ruoli-e-permessi §4)
  role ??= await getMyRole()
  if (role === 'dev') {
    return render({ sub: kindLabel, title: `${found.code} ${found.name || ''}`,
      body: `${legacy}<p class="field-hint">Giacenza e movimenti sono per gli operatori.</p>`, actions: card })
  }
  const actions = card +
    `<a class="btn-ghost" href="/registro.html?codice=${code}">Storico</a>` +
    `<a class="btn-primary" href="/movimenti.html?codice=${code}">Movimento</a>`
  render({ sub: kindLabel, title: `${found.code} ${found.name || ''}`, body: `${legacy}<p class="field-hint">Giacenza…</p>`, actions })
  try {
    const rows = await getItemStockByPlace(found.kind === 'montato' ? { articleId: found.id } : { rawItemId: found.id })
    const total = rows.reduce((t, r) => ({ pieces: t.pieces + r.pieces, grams: t.grams + r.grams }), { pieces: 0, grams: 0 })
    const table = rows.length
      ? `<table class="reader-stock"><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(qty(found.unit, r.pieces, r.grams))}</td></tr>`).join('')}
         </tbody>${rows.length > 1 ? `<tfoot><tr><td>Totale</td><td>${esc(qty(found.unit, total.pieces, total.grams))}</td></tr></tfoot>` : ''}</table>`
      : '<p>Nessuna giacenza: non è in nessun luogo.</p>'
    modal.querySelector('#readerBody').innerHTML = legacy + table
  } catch (err) {
    modal.querySelector('#readerBody').innerHTML = `${legacy}<p class="field-error">Giacenza non disponibile: ${esc(err.message)}</p>`
  }
}
