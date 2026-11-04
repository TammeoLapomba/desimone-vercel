// js/anagrafiche.js — Tipi, materiali e metalli con le lettere del codice (pacchetto 1.1, AN-01…AN-09).
// Li gestisce solo l'account dev di Dedalo: lo impone il database (033), la pagina lo dice e basta.
import { requireAuth, signOut, getAnagrafica, getAnagraficaUsage, saveAnagrafica, retireAnagrafica } from './supabase.js'
import { showToast, isCodeLetter, validateAnagrafica } from './utils.js'
import { initMobileNav, initHamburger, initPanelToggle, closeDrawer } from './pwa.js'

window.signOutUser = signOut

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slugify = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// hasCode: sigla degli SKU di oggi e posizione nel codice. preview: dove finisce la lettera nel codice di 14 caratteri (AC-04).
const LISTS = {
  product_types: {
    label: 'Tipi', one: 'tipo', article: 'il tipo', newLabel: 'Nuovo tipo', hasCode: false, hasColor: false,
    preview: f => [f.letter || 'T', 'MMMM', 'C', 'LLL', '#####'],
  },
  materials: {
    label: 'Materiali', one: 'materiale', article: 'il materiale', newLabel: 'Nuovo materiale', hasCode: true, hasColor: true,
    preview: f => ['T', `${f.letter || 'M'}MMM`, f.colorLetter || 'C', 'LLL', '#####'],
  },
  metals: {
    label: 'Metalli', one: 'metallo', article: 'il metallo', newLabel: 'Nuovo metallo', hasCode: true, hasColor: false,
    preview: f => ['T', `${f.letter || 'M'}MMM`, 'C', 'LLL', '#####'],
  },
}

const state = { list: 'product_types', voices: { product_types: [], materials: [], metals: [] }, usage: {}, editing: null }

const usedBy = (list, id) => state.usage[`${list}:${id}`] || 0
const articlesLabel = n => `${n} ${n === 1 ? 'articolo' : 'articoli'}`

async function init() {
  initPanelToggle()
  const session = await requireAuth()
  initHamburger()
  initMobileNav({ onNewArticle: () => openEditor() })

  if (session.user.app_metadata?.role !== 'dev') {
    $('btnNewVoice').style.display = 'none'
    $('voicesBox').innerHTML = '<p class="anag-block">Questa pagina è per gli account dev di Dedalo.</p>'
    return
  }

  setupListeners()
  await load()
}

async function load() {
  const [productTypes, materials, metals, usage] = await Promise.all([
    getAnagrafica('product_types'), getAnagrafica('materials'), getAnagrafica('metals'), getAnagraficaUsage(),
  ])
  state.voices = { product_types: productTypes, materials, metals }
  state.usage = usage
  render()
}

// ─── Elenchi e voci ───────────────────────────────────────────

function render() {
  $('listNav').innerHTML = Object.entries(LISTS).map(([key, l]) => `
    <div data-list="${key}" class="collection-item${key === state.list ? ' active' : ''}">
      <div class="collection-dot" style="background:var(--coral);"></div>
      <span class="collection-name">${l.label}</span>
      <span class="collection-count">${state.voices[key].filter(v => v.active).length}</span>
    </div>`).join('')

  const list = LISTS[state.list]
  $('breadcrumb').textContent = `Anagrafiche · ${list.label}`
  $('btnNewVoiceLabel').textContent = list.newLabel

  // In ordine alfabetico, le archiviate in fondo: la posizione vale solo per il codice (AN-09)
  const voices = [...state.voices[state.list]].sort((a, b) => Number(b.active) - Number(a.active))
  $('voiceCount').textContent = `${voices.length} ${voices.length === 1 ? 'voce' : 'voci'}`

  $('voicesBox').innerHTML = `
    <div class="table-card"><div class="table-scroll">
      <table class="articles-table anag-table">
        <thead><tr>
          <th scope="col">Nome</th>
          <th scope="col" class="col-short">Lettera</th>
          ${list.hasColor ? '<th scope="col" class="col-short">Colore</th>' : ''}
          ${list.hasCode ? '<th scope="col" class="col-short">Sigla</th><th scope="col" class="col-short num">Posizione</th>' : ''}
          <th scope="col" class="col-short num">Articoli</th>
          <th scope="col" class="col-actions" aria-label="Azioni"></th>
        </tr></thead>
        <tbody>
          ${voices.map(v => `
            <tr class="${v.active ? '' : 'is-archived'}">
              <td title="${esc(v.name)}"><span class="cell-title">${esc(v.name)}</span>${v.active ? '' : '<span class="anag-tag">Archiviata</span>'}</td>
              <td class="cell-code">${esc(v.letter || '—')}</td>
              ${list.hasColor ? `<td class="cell-code">${esc(v.color_letter || '—')}</td>` : ''}
              ${list.hasCode ? `<td>${esc(v.code)}</td><td class="num">${esc(v.code_position)}</td>` : ''}
              <td class="num">${usedBy(state.list, v.id)}</td>
              <td class="col-actions">
                <button type="button" class="row-action" data-menu="${v.id}" aria-label="Azioni per ${esc(v.name)}" aria-haspopup="menu" aria-expanded="false">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
                </button>
              </td>
            </tr>`).join('') || `<tr><td colspan="7" class="table-empty">Nessuna voce</td></tr>`}
        </tbody>
      </table>
    </div></div>`
}

// ─── Menu dei tre puntini ─────────────────────────────────────

let menuOpener = null

function toggleMenu(btn) {
  const menu = $('voiceMenu')
  if (!menu.hidden && menuOpener === btn) return closeMenu()
  closeMenu()
  const voice = state.voices[state.list].find(v => v.id === btn.dataset.menu)
  if (!voice) return
  menuOpener = btn
  menu.dataset.voiceId = voice.id
  menu.querySelector('[data-action="retire"]').hidden = !voice.active
  menu.querySelector('[data-action="restore"]').hidden = voice.active
  btn.setAttribute('aria-expanded', 'true')
  menu.hidden = false
  // Sotto il pulsante, allineato a destra, senza uscire dallo schermo
  const r = btn.getBoundingClientRect()
  const left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)
  const top = r.bottom + menu.offsetHeight + 4 > window.innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom
  menu.style.left = `${Math.max(8, left)}px`
  menu.style.top = `${Math.max(8, top)}px`
  menu.querySelector('button').focus()
}

function closeMenu({ restoreFocus = false } = {}) {
  const menu = $('voiceMenu')
  if (menu.hidden) return
  menu.hidden = true
  menuOpener?.setAttribute('aria-expanded', 'false')
  if (restoreFocus) menuOpener?.focus()
  menuOpener = null
}

// ─── Finestra nuova / modifica ────────────────────────────────

function openEditor(voice = null) {
  const list = LISTS[state.list]
  state.editing = voice
  $('voiceModalEyebrow').textContent = `Anagrafiche · ${list.label}`
  $('voiceModalTitle').textContent = voice ? `Modifica ${list.one}` : list.newLabel
  $('f_name').value = voice?.name || ''
  $('f_letter').value = voice?.letter || ''
  $('f_color_letter').value = voice?.color_letter || ''
  $('f_code').value = voice?.code || ''
  $('f_position').value = voice?.code_position ?? ''
  $('fieldColor').hidden = !list.hasColor
  $('fieldCode').hidden = !list.hasCode
  $('fieldPosition').hidden = !list.hasCode
  $('btnRetireVoice').hidden = !voice?.active
  $('voiceModal').classList.add('open')
  updateEditorNotes()
  $('f_name').focus()
}

const closeEditor = () => $('voiceModal').classList.remove('open')

// Nomi delle altre voci che usano la stessa lettera: si può, ma va saputo (AN-05)
function sameLetter(column, letter) {
  if (!isCodeLetter(letter)) return []
  return state.voices[state.list].filter(v => v.id !== state.editing?.id && v[column] === letter).map(v => v.name)
}

function letterNote(column, letter) {
  const names = sameLetter(column, letter)
  return names.length ? `Questa lettera la usa anche: ${names.join(', ')}.` : ''
}

function readForm() {
  return {
    name: $('f_name').value.trim(),
    letter: $('f_letter').value.trim().toUpperCase(),
    colorLetter: $('f_color_letter').value.trim().toUpperCase(),
    code: $('f_code').value.trim().toUpperCase(),
    position: $('f_position').value.trim(),
  }
}

function updateEditorNotes() {
  const list = LISTS[state.list]
  const form = readForm()
  $('letterNote').textContent = letterNote('letter', form.letter)
  $('colorNote').textContent = letterNote('color_letter', form.colorLetter)
  $('voicePreview').textContent = list.preview(form).join(' ')
}

// Metalli e materiali hanno un'unica numerazione: { posizione: nome } senza la voce che si sta modificando
function otherPositions() {
  const positions = {}
  for (const v of [...state.voices.metals, ...state.voices.materials]) {
    if (v.id !== state.editing?.id) positions[v.code_position] = v.name
  }
  return positions
}

async function saveVoice() {
  const list = LISTS[state.list]
  const form = readForm()
  const invalid = validateAnagrafica(form, {
    others: state.voices[state.list].filter(v => v.id !== state.editing?.id),
    positions: otherPositions(),
    needsCode: list.hasCode,
  })
  if (invalid) return showToast(invalid, 5000)

  const fields = { name: form.name, letter: form.letter || null }
  if (list.hasColor) fields.color_letter = form.colorLetter || null
  if (list.hasCode) {
    fields.code = form.code
    // Vuota: la successiva libera, la sceglie il database (033)
    if (form.position) fields.code_position = Number(form.position)
  }
  if (state.list === 'product_types' && !state.editing) fields.slug = slugify(form.name)

  const btn = $('btnSaveVoice')
  btn.disabled = true
  try {
    await saveAnagrafica(state.list, state.editing?.id, fields)
    closeEditor()
    showToast(`Voce salvata: ${form.name}`)
    await load()
  } catch (err) {
    console.error(err)
    showToast(`Errore: ${err.message}`, 6000)
  } finally {
    btn.disabled = false
  }
}

// ─── Archivia, elimina, riattiva ──────────────────────────────

async function retireVoice(voice) {
  const list = LISTS[state.list]
  const used = usedBy(state.list, voice.id)
  const msg = used
    ? `Stai per archiviare ${list.article} "${voice.name}".\n\nNon si proporrà più sugli articoli nuovi e resta sui ${articlesLabel(used)} che lo usano. Si può riattivare.\n\nVuoi procedere?`
    : `ATTENZIONE: stai per eliminare definitivamente ${list.article} "${voice.name}".\n\nNessun articolo lo usa. L'operazione non si può annullare.\n\nVuoi procedere?`
  if (!confirm(msg)) return
  try {
    const action = await retireAnagrafica(state.list, voice.id)
    closeEditor()
    showToast(`Voce ${action === 'deleted' ? 'eliminata' : 'archiviata'}: ${voice.name}`)
    await load()
  } catch (err) {
    console.error(err)
    showToast(`Errore: ${err.message}`, 6000)
  }
}

async function restoreVoice(voice) {
  try {
    await saveAnagrafica(state.list, voice.id, { active: true })
    showToast(`Voce riattivata: ${voice.name}`)
    await load()
  } catch (err) {
    console.error(err)
    showToast(`Errore: ${err.message}`, 6000)
  }
}

// ─── Listeners ────────────────────────────────────────────────

function setupListeners() {
  $('listNav').addEventListener('click', e => {
    const item = e.target.closest('[data-list]')
    if (!item) return
    state.list = item.dataset.list
    render()
    closeDrawer()
  })

  $('voicesBox').addEventListener('click', e => {
    const btn = e.target.closest('[data-menu]')
    if (btn) toggleMenu(btn)
  })

  $('voiceMenu').addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action
    const voice = state.voices[state.list].find(v => v.id === $('voiceMenu').dataset.voiceId)
    closeMenu()
    if (!voice) return
    if (action === 'edit') openEditor(voice)
    if (action === 'retire') retireVoice(voice)
    if (action === 'restore') restoreVoice(voice)
  })
  document.addEventListener('click', e => {
    if (!e.target.closest('#voiceMenu, [data-menu]')) closeMenu()
  })
  window.addEventListener('resize', () => closeMenu())
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (!$('voiceMenu').hidden) closeMenu({ restoreFocus: true })
    else closeEditor()
  })

  $('btnNewVoice').addEventListener('click', () => openEditor())
  $('btnSaveVoice').addEventListener('click', saveVoice)
  $('btnCloseVoice').addEventListener('click', closeEditor)
  $('btnRetireVoice').addEventListener('click', () => { if (state.editing) retireVoice(state.editing) })
  for (const id of ['f_letter', 'f_color_letter', 'f_name']) $(id).addEventListener('input', updateEditorNotes)
}

init().catch(err => {
  console.error(err)
  showToast(`Errore: ${err.message}`, 6000)
})
