// js/etichette.js — Coda e archivio delle etichette (scheda 3.2, I1…I4; migrazione 045)
//
// La coda: le etichette chieste e non ancora stampate, anche quelle andate in errore, con il motivo. Si stampano dal
// browser (una pagina da 62×29 mm per copia) e poi si segnano stampate; oppure si annullano. L'archivio: le stampate
// e le annullate, dalla più recente, con la ricerca per codice o nome e la ristampa (copie, prezzo e materiali di
// quella stampa si cambiano senza toccare l'articolo, come in STEP).
import { requireAuth, signOut, getMyOperator, getMovementSetup, getLabels, setLabelStatus, SEDE_PRINTER } from './supabase.js'
import { showToast, formatEuro, debounce } from './utils.js'
import { initMobileNav } from './pwa.js'
import { openLabelDialog, printAndMark } from './etichetta.js'

window.signOutUser = signOut

const PAGE = 50
const STATUS = { in_coda: 'In coda', in_stampa: 'In stampa', errore: 'Errore', stampata: 'Stampata', annullata: 'Annullata' }
const SOURCE = { movimento: 'Movimento', scheda: 'Scheda', ristampa: 'Ristampa' }
const state = { operators: new Map(), queue: [], archive: [], search: '', offset: 0 }
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = iso => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const who = id => state.operators.get(id) || '—'

function row(job, actions) {
  return `<tr>
    <td class="mov-item-code">${esc(job.code)}</td>
    <td>${esc(job.name)}${job.lines?.length ? `<div class="mov-note">${job.lines.map(esc).join(' · ')}</div>` : ''}</td>
    <td>${job.copies}</td>
    <td>${job.price != null ? esc(formatEuro(job.price)) : '—'}${job.weight_g != null ? `<div class="mov-note">${esc(String(job.weight_g).replace('.', ','))} g</div>` : ''}</td>
    <td>${STATUS[job.status]}${job.error ? `<div class="mov-note">${esc(job.error)}</div>` : ''}</td>
    <td>${esc(SOURCE[job.source])}<div class="mov-note">${esc(who(job.requested_by))} · ${when(job.done_at || job.requested_at)}</div></td>
    <td><div class="lbl-list-actions">${actions}</div></td>
  </tr>`
}

const HEAD = '<thead><tr><th>Codice</th><th>Etichetta</th><th>Copie</th><th>Prezzo e peso</th><th>Stato</th><th>Da</th><th></th></tr></thead>'

async function loadQueue() {
  state.queue = await getLabels({ archive: false, limit: 200 })
  $('queueTable').innerHTML = state.queue.length
    ? HEAD + `<tbody>${state.queue.map(j => row(j, `
        ${actions(j)}`)).join('')}</tbody>`
    : ''
  const copies = state.queue.reduce((n, j) => n + j.copies, 0)
  $('queueCount').textContent = state.queue.length ? `${state.queue.length} richieste, ${copies} etichette` : 'Niente da stampare.'
  $('btnPrintAll').hidden = SEDE_PRINTER || state.queue.length < 2
  // Con la QL-800 la coda cambia da sola: si guarda di nuovo finché c'è qualcosa da stampare
  clearTimeout(state.refresh)
  if (SEDE_PRINTER && state.queue.some(j => j.status !== 'errore')) {
    state.refresh = setTimeout(() => Promise.all([loadQueue(), loadArchive()]).catch(() => {}), 4000)
  }
}

// In stampa nessuno la tocca. Con la QL-800 il browser resta una via di riserva
function actions(j) {
  if (j.status === 'in_stampa') return '<span class="mov-note">Sulla QL-800…</span>'
  return `
    <button type="button" class="${SEDE_PRINTER ? 'btn-ghost' : 'btn-primary'}" data-print="${j.id}">${SEDE_PRINTER ? 'Dal browser' : 'Stampa'}</button>
    ${j.status === 'errore' ? `<button type="button" class="${SEDE_PRINTER ? 'btn-primary' : 'btn-ghost'}" data-retry="${j.id}">Rimetti in coda</button>` : ''}
    <button type="button" class="btn-ghost" data-cancel="${j.id}">Annulla</button>`
}

async function loadArchive(more = false) {
  state.offset = more ? state.offset + PAGE : 0
  const rows = await getLabels({ archive: true, search: state.search, offset: state.offset, limit: PAGE })
  state.archive = more ? [...state.archive, ...rows] : rows
  $('archiveTable').innerHTML = state.archive.length
    ? HEAD + `<tbody>${state.archive.map(j => row(j, `<button type="button" class="btn-ghost" data-reprint="${j.id}">Ristampa</button>`)).join('')}</tbody>`
    : `<tbody><tr><td class="mov-note">${state.search ? 'Nessuna etichetta con questo codice o nome.' : 'Nessuna etichetta stampata.'}</td></tr></tbody>`
  $('btnMore').hidden = rows.length < PAGE
}

async function print(jobs) {
  try {
    if (await printAndMark(jobs)) showToast(jobs.length === 1 ? 'Segnata stampata' : `${jobs.length} richieste segnate stampate`)
  } catch (err) {
    showToast(err.message, 5000)
  }
  await Promise.all([loadQueue(), loadArchive()])
}

async function act(fn, done) {
  try {
    await fn()
    if (done) showToast(done)
  } catch (err) {
    showToast(err.message, 5000)
  }
  await Promise.all([loadQueue(), loadArchive()])
}

function setupListeners() {
  $('queueTable').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    const find = id => state.queue.find(j => j.id === id)
    if (b.dataset.print) print([find(b.dataset.print)])
    if (b.dataset.retry) act(() => setLabelStatus(b.dataset.retry, 'in_coda'), 'Rimessa in coda')
    if (b.dataset.cancel) act(() => setLabelStatus(b.dataset.cancel, 'annullata'), 'Annullata')
  })
  $('btnPrintAll').addEventListener('click', () => print(state.queue))
  $('archiveTable').addEventListener('click', e => {
    const id = e.target.closest('[data-reprint]')?.dataset.reprint
    if (!id) return
    const job = state.archive.find(j => j.id === id)
    openLabelDialog({
      kind: job.template === 'gioiello' ? 'montato' : 'semilavorato', id: job.article_id || job.raw_item_id,
      code: job.code, name: job.name, source: 'scheda', reprint: job,
    }).then(saved => saved && Promise.all([loadQueue(), loadArchive()]))
      .catch(err => showToast(err.message, 5000))
  })
  $('archiveSearch').addEventListener('input', debounce(() => {
    state.search = $('archiveSearch').value
    loadArchive().catch(err => showToast(err.message, 5000))
  }, 300))
  $('btnMore').addEventListener('click', () => loadArchive(true).catch(err => showToast(err.message, 5000)))
}

async function init() {
  await requireAuth()
  initMobileNav()
  const operator = await getMyOperator()
  if (!operator) {
    $('blocked').textContent = 'Il tuo utente non è un operatore: le etichette le chiedono e le stampano gli operatori.'
    $('blocked').hidden = false
    return
  }
  $('operatorChip').textContent = operator.name
  const setup = await getMovementSetup()
  for (const o of setup.operators) state.operators.set(o.id, o.name)
  if (SEDE_PRINTER) $('intro').textContent = 'Le etichette chieste da Movimenti e dalle schede. Il servizio della sede le stampa da solo sulla QL-800; quelle in errore si rimettono in coda.'
  setupListeners()
  await Promise.all([loadQueue(), loadArchive()])
  $('labelsView').hidden = false
}

init().catch(err => {
  console.error(err)
  $('blocked').textContent = `Errore nel caricamento: ${err.message}`
  $('blocked').hidden = false
})
