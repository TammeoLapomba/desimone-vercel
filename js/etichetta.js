// js/etichetta.js — L'etichetta: richiesta, anteprima e stampa dal browser (scheda 3.2, migrazione 045)
//
// Come STEP: l'app non stampa da sola, mette in coda ciò che va sull'etichetta (codice, nome, righe dei materiali,
// prezzo se richiesto), che per quella stampa si può cambiare senza toccare l'articolo (I4). Nella sede la stamperà
// il servizio verso la QL-800 (3.3); per ora, e su Vercel sempre, la stampa il browser, una pagina per copia.
//
// Due modelli, sul rotolo DK-22251 da 62 mm (scheda 3.2, decisione 2):
//   - gioiello, come l'etichetta di STEP (foto di Lollino dell'08/11/2026): 62×29, stampata sulle due facce e piegata
//     a metà, in due riquadri da 31×29. Esterno: logo a sinistra, QR a destra. Interno: a sinistra tipo e linea,
//     descrizione e materiali, una riga ciascuno, e in fondo il codice; a destra prezzo (se richiesto) e peso.
//     In alto, vicino alla piega, i fori del filo: lì non si stampa;
//   - semilavorato: 62×29 singola, QR a sinistra, codice e contenuto a destra.
// Il QR contiene solo il codice (AC-05). Le misure stanno solo in LABEL_CSS: si correggono lì dopo la prova vera.
import { requestLabel, setLabelStatus, getCodeCheck, SEDE_PRINTER } from './supabase.js'
import { formatEuro, parseEuro, parseDecimal, formatDecimal, articleMaterials } from './utils.js'

const QR_SRC = '/js/vendor/qrcode-generator-1.4.4.js'
export const MAX_LINES = 8
const MAX_LINE = 40
// Il logo di STEP (corallo rosso e "ANTONINO DE SIMONE") non l'abbiamo come file: per ora il nome. Quando arriva in
// bianco e rosso, va in icons/ e qui un <img> (scheda 3.2, decisione 3)
const LOGO = '<div class="lbl-logo-mark" aria-hidden="true"></div><div class="lbl-logo-name">ANTONINO DE SIMONE</div>'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ─── QR ───────────────────────────────────────────────────────

let qrLoading = null
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode)
  qrLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = QR_SRC
    script.onload = () => resolve(window.qrcode)
    script.onerror = () => { qrLoading = null; reject(new Error('La libreria del QR non si carica: ricarica la pagina')) }
    document.head.appendChild(script)
  })
  return qrLoading
}

// Il QR come SVG, nero su bianco, con 2 moduli di margine: il resto lo dà il bianco dell'etichetta
export async function qrSvg(text) {
  const qrcode = await loadQr()
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const q = 2
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" role="img" aria-label="QR ${esc(text)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

// ─── Disegno ──────────────────────────────────────────────────

export const LABEL_CSS = `
.lbl { width: 62mm; height: 29mm; box-sizing: border-box; overflow: hidden; background: #fff; color: #000;
  font-family: Arial, Helvetica, sans-serif; line-height: 1.2; position: relative; }
.lbl svg { display: block; width: 100%; height: 100%; }
.lbl-face { display: flex; }
.lbl-panel { width: 31mm; height: 29mm; box-sizing: border-box; overflow: hidden; position: relative; }
.lbl-face .lbl-panel + .lbl-panel { border-left: .1mm dashed #ccc; }
.lbl-out-left { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.2mm; padding: 3mm 1.5mm 1.5mm; }
.lbl-logo-mark { width: 9mm; height: 6mm; border-bottom: .9mm dotted #c8352b; border-radius: 0 0 50% 50%; }
.lbl-logo-name { font-family: Georgia, 'Times New Roman', serif; font-size: 5.2pt; letter-spacing: .5pt; white-space: nowrap; }
.lbl-out-right { display: flex; align-items: center; justify-content: center; padding: 3mm 2mm 2mm; }
.lbl-out-right .lbl-qr { width: 22mm; height: 22mm; }
.lbl-in-left { padding: 3.5mm 1mm 1.5mm 2.5mm; display: flex; flex-direction: column; }
.lbl-in-left .lbl-line { font-size: 5.6pt; white-space: nowrap; overflow: hidden; }
.lbl-in-left .lbl-code { font-size: 5.6pt; margin-top: auto; padding-top: .8mm; white-space: nowrap; }
.lbl-in-right { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm 1.5mm 2mm; }
.lbl-price { font-size: 9pt; }
.lbl-weight { font-size: 6.5pt; }
.lbl-semilavorato { padding: 1.5mm 2mm; display: flex; align-items: center; gap: 2.5mm; }
.lbl-semilavorato .lbl-qr { width: 26mm; height: 26mm; flex: none; }
.lbl-semilavorato .lbl-text { min-width: 0; display: flex; flex-direction: column; gap: .8mm; }
.lbl-semilavorato .lbl-code { font-size: 12pt; font-weight: 700; word-break: break-all; }
.lbl-semilavorato .lbl-desc { font-size: 7pt; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.lbl-semilavorato .lbl-line { font-size: 6pt; }
@media print { .lbl-face .lbl-panel + .lbl-panel { border-left: none; } }
`

const weightText = g => `${Number(g).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} gr`

// Le facce di una copia. job: { template, code, name, lines, weight_g, price } come in print_jobs.
// Gioiello: [esterno, interno], come STEP; semilavorato: [unica]
export function labelPages(job, qr) {
  const lines = (job.lines || []).map(l => `<div class="lbl-line">${esc(l)}</div>`).join('')
  if (job.template === 'gioiello') {
    return [
      `<div class="lbl lbl-face lbl-esterno">
        <div class="lbl-panel lbl-out-left">${LOGO}</div>
        <div class="lbl-panel lbl-out-right"><div class="lbl-qr">${qr}</div></div>
      </div>`,
      `<div class="lbl lbl-face lbl-interno">
        <div class="lbl-panel lbl-in-left">${lines}<div class="lbl-code">${esc(job.code)}</div></div>
        <div class="lbl-panel lbl-in-right">
          ${job.price != null ? `<div class="lbl-price">${esc(formatEuro(job.price))}</div>` : ''}
          ${job.weight_g != null ? `<div class="lbl-weight">${esc(weightText(job.weight_g))}</div>` : ''}
        </div>
      </div>`,
    ]
  }
  return [`<div class="lbl lbl-semilavorato">
    <div class="lbl-qr">${qr}</div>
    <div class="lbl-text"><div class="lbl-code">${esc(job.code)}</div><div class="lbl-desc">${esc(job.name)}</div>${lines}</div>
  </div>`]
}

function ensureStyle() {
  if (document.getElementById('labelCss')) return
  const style = document.createElement('style')
  style.id = 'labelCss'
  style.textContent = LABEL_CSS
  document.head.appendChild(style)
}

// ─── Stampa dal browser: una pagina da 62×29 mm per faccia ────
// Il gioiello ha due facce: per ogni copia, l'esterno e poi l'interno (da provare con la QL-800 come si stampa il retro)

export async function printInBrowser(jobs) {
  const pages = []
  for (const job of jobs) {
    const qr = await qrSvg(job.code)
    for (let i = 0; i < job.copies; i++) pages.push(...labelPages(job, qr))
  }
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Etichette</title><style>${LABEL_CSS}
    @page { size: 62mm 29mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .lbl { break-after: page; page-break-after: always; }
    .lbl:last-child { break-after: auto; page-break-after: auto; }
    </style></head><body>${pages.join('')}</body></html>`)
  doc.close()
  await new Promise(r => setTimeout(r, 150))
  frame.contentWindow.focus()
  frame.contentWindow.print()
  setTimeout(() => frame.remove(), 2000)
}

// Dopo la stampa del browser: è uscita? Sì → stampata; no → resta in coda (o in errore, col motivo)
export function askPrinted(count) {
  return new Promise(resolve => {
    const box = document.createElement('div')
    box.className = 'modal-overlay open'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.innerHTML = `<div class="modal modal-compact">
      <div class="modal-header"><div><div class="modal-eyebrow">Etichette</div>
        <div class="modal-title">${count === 1 ? 'L\'etichetta è uscita bene?' : `Le ${count} etichette sono uscite bene?`}</div></div></div>
      <div class="modal-body"><p class="field-hint">Se no, restano in coda: si ristampano dalla pagina Etichette.</p></div>
      <div class="modal-footer">
        <button type="button" class="btn-ghost" data-answer="no">No, restano in coda</button>
        <button type="button" class="btn-primary" data-answer="si">Sì, stampate</button>
      </div></div>`
    document.body.appendChild(box)
    box.querySelector('[data-answer="si"]').focus()
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-answer]')
      if (!b) return
      box.remove()
      resolve(b.dataset.answer === 'si')
    })
  })
}

// Stampa dal browser e segna com'è andata. Risponde true se le ha segnate stampate
export async function printAndMark(jobs) {
  await printInBrowser(jobs)
  const ok = await askPrinted(jobs.reduce((n, j) => n + j.copies, 0))
  if (ok) for (const job of jobs) await setLabelStatus(job.id, 'stampata')
  return ok
}

// ─── La finestra della richiesta ──────────────────────────────

let modal = null
let current = null   // { opts, explain, resolve }

function build() {
  ensureStyle()
  modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'labelModal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'labelTitle')
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div><div class="modal-eyebrow" id="labelSub">Etichetta</div><div class="modal-title" id="labelTitle"></div></div>
        <button type="button" data-close aria-label="Chiudi" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form class="modal-body" id="labelForm" novalidate>
        <div id="labelCheck" hidden></div>
        <div class="form-row">
          <div class="form-field">
            <label class="field-label" for="labelCopies">Copie</label>
            <input type="number" class="field-input" id="labelCopies" min="1" max="200" step="1" inputmode="numeric">
            <button type="button" class="field-hint label-link" id="labelPerPiece" hidden></button>
          </div>
          <div class="form-field">
            <label class="field-label" for="labelName">Nome</label>
            <input type="text" class="field-input" id="labelName" maxlength="80" autocomplete="off">
            <span class="field-hint" id="labelNameHint"></span>
          </div>
        </div>
        <div class="form-row" id="labelJewelRow">
          <div class="form-field">
            <label class="field-label"><input type="checkbox" id="labelWithPrice"> Stampa il prezzo</label>
            <input type="text" class="field-input" id="labelPrice" inputmode="decimal" autocomplete="off" disabled>
          </div>
          <div class="form-field">
            <label class="field-label" for="labelWeight">Peso di un pezzo (g)</label>
            <input type="text" class="field-input" id="labelWeight" inputmode="decimal" autocomplete="off" placeholder="vuoto: non si stampa">
          </div>
        </div>
        <div class="form-row full"><div class="form-field">
          <label class="field-label" for="labelLines" id="labelLinesLabel"></label>
          <textarea class="field-input" id="labelLines" rows="6"></textarea>
          <span class="field-hint">Al massimo ${MAX_LINES} righe di ${MAX_LINE} caratteri; sull'etichetta del gioiello ne stanno circa 28 per riga. Valgono solo per questa stampa: l'articolo non cambia.</span>
        </div></div>
        <div class="field-label">Anteprima</div>
        <div class="label-preview" id="labelPreview" aria-live="polite"></div>
        <div class="field-error" id="labelError" role="alert"></div>
      </form>
      <div class="modal-footer">
        <button type="button" class="btn-ghost" data-close>Annulla</button>
        <button type="button" class="btn-ghost" id="labelQueue">Metti in coda</button>
        <button type="button" class="btn-primary" id="labelPrint">Stampa adesso</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  const $ = id => modal.querySelector(`#${id}`)
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) close(null) })
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(null) })
  for (const id of ['labelCopies', 'labelName', 'labelLines', 'labelPrice', 'labelWeight']) $(id).addEventListener('input', preview)
  $('labelWithPrice').addEventListener('change', () => { $('labelPrice').disabled = !$('labelWithPrice').checked; preview() })
  $('labelPerPiece').addEventListener('click', () => { $('labelCopies').value = current.opts.pieces; preview() })
  // Il punto vale come la virgola, e a schermo c'è sempre la virgola (decisione di Matteo, 08/11/2026)
  for (const id of ['labelPrice', 'labelWeight']) {
    $(id).addEventListener('input', e => { if (e.target.value.includes('.')) e.target.value = e.target.value.replace('.', ',') })
  }
  $('labelQueue').addEventListener('click', () => submit(false))
  $('labelPrint').addEventListener('click', () => submit(true))
}

function close(result) {
  modal.classList.remove('open')
  current?.resolve(result)
  current = null
}

// Ciò che si stamperebbe adesso, oppure { error }
function read() {
  const $ = id => modal.querySelector(`#${id}`)
  const { opts, explain } = current
  const copies = Number($('labelCopies').value)
  if (!Number.isInteger(copies) || copies < 1 || copies > 200) return { error: 'Le copie vanno da 1 a 200.' }
  const name = $('labelName').value.trim()
  if (!name) return { error: 'Scrivi il nome da stampare.' }
  const lines = $('labelLines').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length > MAX_LINES) return { error: `Al massimo ${MAX_LINES} righe.` }
  const long = lines.find(l => l.length > MAX_LINE)
  if (long) return { error: `Riga troppo lunga, al massimo ${MAX_LINE} caratteri: "${long}".` }
  let price = null
  if (opts.kind === 'montato' && $('labelWithPrice').checked) {
    const parsed = parseEuro($('labelPrice').value)
    if (!parsed.ok) return { error: `Prezzo: ${parsed.error}` }
    price = parsed.value
  }
  let weight_g = null
  if (opts.kind === 'montato') {
    const parsed = parseDecimal($('labelWeight').value, 2, 100000)
    if (!parsed.ok) return { error: 'Peso: scrivi i grammi di un pezzo, con al massimo 2 decimali, per esempio 65 oppure 3,25.' }
    weight_g = parsed.value
  }
  if (explain && !$('labelConfirm')?.checked) return { error: 'Controlla il codice e spunta la conferma: con la prima etichetta diventa definitivo.' }
  return { copies, name, lines, price, weight_g, template: opts.kind === 'montato' ? 'gioiello' : 'semilavorato', code: explain?.code || opts.code }
}

async function preview() {
  if (!current) return
  const $ = id => modal.querySelector(`#${id}`)
  const job = read()
  $('labelError').textContent = ''
  const shown = job.error ? { ...readLoose(), template: current.opts.kind === 'montato' ? 'gioiello' : 'semilavorato' } : job
  try {
    const pages = labelPages(shown, await qrSvg(shown.code))
    const captions = pages.length === 2 ? ['Esterno', 'Interno'] : ['']
    $('labelPreview').innerHTML = pages
      .map((page, i) => `${captions[i] ? `<div class="label-face-caption">${captions[i]}</div>` : ''}<div class="label-preview-face">${page}</div>`)
      .join('')
  } catch (err) {
    $('labelPreview').textContent = err.message
  }
}

// Per l'anteprima anche mentre un campo è sbagliato
function readLoose() {
  const $ = id => modal.querySelector(`#${id}`)
  const parsed = parseEuro($('labelPrice').value)
  return {
    code: current.explain?.code || current.opts.code,
    name: $('labelName').value.trim(),
    lines: $('labelLines').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, MAX_LINES),
    price: current.opts.kind === 'montato' && $('labelWithPrice').checked && parsed.ok ? parsed.value : null,
    weight_g: current.opts.kind === 'montato' ? (parseDecimal($('labelWeight').value, 2, 100000).value ?? null) : null,
  }
}

async function submit(printNow) {
  const $ = id => modal.querySelector(`#${id}`)
  const job = read()
  if (job.error) return void ($('labelError').textContent = job.error)
  const { opts, explain } = current
  for (const b of modal.querySelectorAll('.modal-footer button')) b.disabled = true
  try {
    const saved = await requestLabel({
      articleId: opts.kind === 'montato' ? opts.id : null,
      rawItemId: opts.kind === 'montato' ? null : opts.id,
      copies: job.copies, name: job.name, lines: job.lines, price: job.price, weight: job.weight_g,
      source: opts.source, movementId: opts.movementId, reprintOf: opts.reprint?.id,
      confirmCode: explain ? explain.code : null,
    })
    const resolve = current.resolve
    current = null
    modal.classList.remove('open')
    // Nella sede con la QL-800 la stampa il servizio, da solo, in pochi secondi; altrimenti il browser
    if (printNow && !SEDE_PRINTER) await printAndMark([saved])
    resolve(saved)
  } catch (err) {
    $('labelError').textContent = err.message
  } finally {
    for (const b of modal.querySelectorAll('.modal-footer button')) b.disabled = false
  }
}

// opts: { kind: 'montato'|'semilavorato', id, code, name, source: 'movimento'|'scheda', movementId, pieces, reprint }
// Risponde l'etichetta messa in coda, oppure null se si chiude senza
export async function openLabelDialog(opts) {
  if (!modal) build()
  const $ = id => modal.querySelector(`#${id}`)
  const isJewel = opts.kind === 'montato'
  let check = { explain: null, details: null }
  if (!opts.reprint) check = await getCodeCheck({ kind: opts.kind, id: opts.id })
  const d = check.details || {}
  const r = opts.reprint

  $('labelSub').textContent = r ? 'Ristampa' : isJewel ? 'Etichetta del gioiello' : 'Etichetta del semilavorato'
  $('labelTitle').textContent = `${check.explain?.code || opts.code} ${opts.name || ''}`
  $('labelCopies').value = r?.copies ?? 1                                         // REQ-I-01.1
  $('labelPerPiece').hidden = !(opts.pieces > 1)
  $('labelPerPiece').textContent = `Una per pezzo: ${opts.pieces}`                  // REQ-I-01.2
  const name = r?.name ?? (isJewel ? d.name : d.description) ?? opts.name ?? ''
  $('labelName').value = name
  $('labelNameHint').textContent = isJewel ? 'Per l\'archivio. Sull\'etichetta va nelle righe.' : 'Sotto il codice.'
  // Come STEP: "Collana - Linea Ciuffo", la descrizione, poi metallo e materiali, uno per riga
  const heading = [d.product_type?.name, d.collections?.name && `Linea ${d.collections.name}`].filter(Boolean).join(' - ')
  const lines = r?.lines ?? (isJewel ? [heading, name, d.metal?.name, ...articleMaterials(d).map(m => m.name)].filter(Boolean) : [])
  $('labelLines').value = [...new Set(lines)].slice(0, MAX_LINES).map(l => l.slice(0, MAX_LINE)).join('\n')
  $('labelLinesLabel').textContent = isJewel ? 'Righe dell\'interno, una ciascuna' : 'Righe sotto il nome (facoltative)'
  $('labelJewelRow').hidden = !isJewel
  const weight = r ? r.weight_g : d.measurements?.weight_g
  $('labelWeight').value = weight != null ? formatDecimal(weight) : ''
  const price = r ? r.price : d.price_retail
  $('labelWithPrice').checked = r ? r.price != null : false
  $('labelPrice').value = price != null ? String(price).replace('.', ',') : ''
  $('labelPrice').disabled = !$('labelWithPrice').checked
  $('labelError').textContent = ''

  // La prima etichetta è un primo uso: il codice si controlla e poi non cambia più (AC-03, REQ-A-09)
  const box = $('labelCheck')
  box.hidden = !check.explain
  box.innerHTML = check.explain ? `
    <div class="label-check">
      <div class="field-label">Codice provvisorio</div>
      <div class="code-check-code">${esc(check.explain.code)}</div>
      <table class="mov-table code-parts"><tbody>${check.explain.parts.map(p => `<tr><td class="mov-item-code">${esc(p.text)}</td><td>${esc(p.label)}</td><td>${esc(p.meaning)}</td></tr>`).join('')}</tbody></table>
      <label class="mov-check"><input type="checkbox" id="labelConfirm"> <span>Ho controllato il codice: con la prima etichetta diventa definitivo e non cambia più</span></label>
    </div>` : ''
  box.querySelector('#labelConfirm')?.addEventListener('change', preview)

  return new Promise(resolve => {
    current = { opts, explain: check.explain, resolve }
    modal.classList.add('open')
    preview()
    $('labelCopies').focus()
  })
}
