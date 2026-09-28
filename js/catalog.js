// js/catalog.js
import { supabase, requireAuth, getCollections, getArticles, insertCollection, deleteArticle, deleteCollection, signOut } from './supabase.js'
import { formatPrice, getCoverPhoto, showToast, isAppSku, articleMaterials, collectionCode, validateCollection, confirmDeleteArticle } from './utils.js'
import { initColorSelect } from './color-select.js'
import { initFilters } from './filters.js'
import { openArticleModal } from './article-form.js'
import { initMobileNav, initHamburger, initPanelToggle, addDetailPanelCloseBtn, closeDrawer } from './pwa.js'

window.signOutUser = signOut

let allArticles = []
let currentCollections = []
let currentCollectionId = null
let editingCollectionId = null // collezione aperta in "Modifica collezione"; null = nuova
let collColor = null           // menu colori della finestra collezione
let isAdmin = false

// Vista del catalogo: 'grid' (schede) o 'table'. Su telefono sempre schede.
const VIEW_KEY = 'desimone-os:vista-catalogo'
const mobileQuery = window.matchMedia('(max-width: 768px)')
let viewMode = 'grid'
try { if (localStorage.getItem(VIEW_KEY) === 'table') viewMode = 'table' } catch { /* storage non disponibile */ }
let shownArticles = []            // ultimo elenco mostrato (filtrato), per ridisegnarlo cambiando vista
let renderedView = null           // vista effettivamente disegnata
const effectiveView = () => (mobileQuery.matches ? 'grid' : viewMode)
let tableSort = { key: null, dir: 1 }
let selectedIds = new Set()       // selezione della tabella (solo admin: serve all'eliminazione multipla)

// Filtri per campo (barra sopra gli articoli, vedi filters.js)
const stockOf = a => (a.stock_retail || 0) + (a.stock_wholesale || 0)
const FILTER_FIELDS = [
  { key: 'type', label: 'Tipo',
    options: items => items.filter(a => a.product_type_id).map(a => [a.product_type_id, a.product_type?.name || '—']),
    test: (a, v) => a.product_type_id === v },
  { key: 'material', label: 'Materiale',
    options: items => items.flatMap(a => articleMaterials(a).map(m => [m.id, m.name])),
    test: (a, v) => articleMaterials(a).some(m => m.id === v) },
  { key: 'metal', label: 'Metallo',
    options: items => items.filter(a => a.metal_id).map(a => [a.metal_id, a.metal?.name || '—']),
    test: (a, v) => a.metal_id === v },
  { key: 'stock', label: 'Disponibilità',
    options: () => [['si', 'Disponibili'], ['no', 'Esauriti']],
    test: (a, v) => (stockOf(a) > 0) === (v === 'si') },
  { key: 'price', label: 'Prezzo', unit: '€', range: true, value: a => a.price_retail },
]
let filters = null

async function init() {
  initPanelToggle()
  const session = await requireAuth()
  // Modifica/eliminazione di collezioni e articoli: solo admin (lo impone anche il database)
  isAdmin = session.user.app_metadata?.role === 'admin'
  filters = initFilters({
    fields: FILTER_FIELDS,
    // Ricerca libera: titolo, codice, collezione, tipo e materiali
    text: a => [a.name, a.sku, a.collections?.name, a.product_type?.name, ...articleMaterials(a).map(m => m.name)].join('\n'),
    onChange: () => renderCurrent(),
  })
  await loadCollections()
  await loadArticles()
  setupListeners()

  // Mobile PWA
  initHamburger()
  addDetailPanelCloseBtn()
  initMobileNav({
    onNewArticle: () => document.getElementById('btnNewArticleTop')?.click(),
    onOpenDrawer: () => {} // già gestito da initMobileNav
  })
}

async function loadCollections() {
  const collections = await getCollections()
  currentCollections = collections
  const list = document.getElementById('collectionList')

  // "Tutti" item
  list.innerHTML = renderCollectionItem({ id: null, name: 'Tutti gli articoli', slug: 'all', color: '#C94030' }, !currentCollectionId)

  collections.forEach(c => {
    const colorMap = { 'intreccio': '#C94030', 'abbraccio': '#E8A898', 'trame-di-corallo': '#D4C4B8', 'cielo-stellato': '#C8C8C8' }
    list.innerHTML += renderCollectionItem({ ...c, color: c.description_en || colorMap[c.slug] || '#C94030' }, c.id === currentCollectionId)
  })

  // onclick e non addEventListener: loadCollections viene richiamata più volte
  list.onclick = e => {
    const menuBtn = e.target.closest('.collection-menu-btn')
    if (menuBtn) {
      toggleCollectionMenu(menuBtn)
      return
    }
    const item = e.target.closest('[data-collection-id]')
    if (!item) return
    currentCollectionId = item.dataset.collectionId === 'null' ? null : item.dataset.collectionId

    list.querySelectorAll('[data-collection-id]').forEach(el => el.classList.remove('active'))
    item.classList.add('active')
    document.getElementById('breadcrumb').textContent = `Catalogo · ${item.dataset.collectionName}`
    renderCurrent()

    // Chiude il drawer su mobile dopo la selezione
    closeDrawer()
  }
}

function renderCollectionItem(c, isActive) {
  return `
    <div data-collection-id="${c.id}" data-collection-name="${c.name}"
         class="collection-item${isActive ? ' active' : ''}">
      <div class="collection-dot" style="background:${c.color};"></div>
      <span class="collection-name">${c.name}</span>
      ${c.id && isAdmin ? `
      <button type="button" class="collection-menu-btn" data-menu-collection="${c.id}" aria-label="Azioni collezione ${c.name}" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
      </button>` : ''}
    </div>`
}

async function loadArticles(collectionId = null) {
  allArticles = await getArticles(collectionId)
  document.getElementById('articleCount').textContent = `${allArticles.length} articoli`
  renderCurrent()
}

function getBadgeStyle(name, type) {
  if (!name) return ''
  const n = name.toLowerCase()
  if (type === 'material') {
    if (n.includes('rosa')) return 'background:var(--coral-pink);color:white;'
    if (n.includes('bianco')) return 'background:#FCFCFC;color:var(--text-secondary);box-shadow:inset 0 0 0 1px #EAEAEA;'
    if (n.includes('rosso') || n.includes('sciacca')) return 'background:rgba(201,64,48,0.1);color:var(--coral-dark);'
  } else if (type === 'metal') {
    if (n.includes('giallo')) return 'background:rgba(201,168,76,0.15);color:#8B7330;'
    if (n.includes('bianco') || n.includes('argento')) return 'background:#F3F3F3;color:var(--text-secondary);'
    if (n.includes('rosa')) return 'background:var(--coral-pink);color:white;'
  }
  return 'background:var(--ivory);color:var(--text-secondary);'
}

// Articoli da mostrare: collezione selezionata, poi ricerca e filtri
function renderCurrent() {
  const inCollection = currentCollectionId ? allArticles.filter(a => a.collection_id === currentCollectionId) : allArticles
  filters.refresh(inCollection)
  renderArticles(filters.apply(inCollection))
}

// Elenco vuoto: se dipende da ricerca o filtri, si possono azzerare da qui
function emptyMessage() {
  return `Nessun articolo trovato${filters.isActive() ? '<br><button type="button" class="link-button empty-reset" data-reset-filters>Azzera ricerca e filtri</button>' : ''}`
}

// Mostra l'elenco nella vista scelta (griglia o tabella)
function renderArticles(articles) {
  shownArticles = articles
  document.getElementById('articleCount').textContent = `${articles.length} ${articles.length === 1 ? 'articolo' : 'articoli'}`
  const view = renderedView = effectiveView()
  document.getElementById('articlesGrid').style.display = view === 'grid' ? 'grid' : 'none'
  document.getElementById('articlesTable').hidden = view !== 'table'
  if (view === 'table') renderTable(articles)
  else renderGrid(articles)
}

function renderGrid(articles) {
  const grid = document.getElementById('articlesGrid')
  if (articles.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--editorial);font-size:18px;color:var(--text-muted);">${emptyMessage()}</div>`
    return
  }

  grid.innerHTML = articles.map((a, i) => {
    const cover = getCoverPhoto(a.photos)
    const collName = a.collections?.name || ''
    // Il titolo dell'articolo, modificabile in inserimento e in modifica
    const dispName = esc(a.name)

    return `
      <div class="article-card" data-article-id="${a.id}" role="listitem" tabindex="0" aria-label="${dispName} — ${collName}" style="animation-delay:${i * 0.05}s">
        <div class="card-photo">
          ${cover
            ? `<img src="${cover}" alt="${dispName}" loading="lazy">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--ivory-dark);">
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--coral-white)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
               </div>`}
        </div>
        <div class="card-body">
          <div class="card-collection">${collName}</div>
          <div class="card-name" title="${dispName}">${dispName}</div>
          <div class="card-sku">${a.sku}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
            ${articleMaterials(a).map(m => `<span style="padding:2px 6px;border-radius:2px;font-family:var(--editorial);font-size:10px;${getBadgeStyle(m.name, 'material')}">${m.name}</span>`).join('')}
            ${a.metal ? `<span style="padding:2px 6px;border-radius:2px;font-family:var(--editorial);font-size:10px;${getBadgeStyle(a.metal.name, 'metal')}">${a.metal.name}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;">
            <div style="font-family:var(--editorial);font-size:13px;font-style:italic;">
              ${formatPrice(a.price_retail)}
              ${a.price_wholesale ? `<span style="font-size:10px;color:var(--text-muted);font-style:normal;font-family:var(--mono);margin-left:6px;">${formatPrice(a.price_wholesale)} ingr.</span>` : ''}
            </div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);white-space:nowrap;">
              ${a.stock_retail + a.stock_wholesale > 0 ? `${a.stock_retail + a.stock_wholesale} pz disp.` : 'Esaurito'}
            </div>
          </div>
        </div>
      </div>`
  }).join('')

  grid.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.articleId))
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.articleId) }
    })
  })
}

// ── Vista tabella (sul modello della tabella inventario di maat) ──
const TABLE_COLUMNS = [
  { key: 'name', label: 'Articolo', value: a => a.name },
  { key: 'sku', label: 'Codice', value: a => a.sku },
  { key: 'collection', label: 'Collezione', value: a => a.collections?.name || '' },
  { key: 'materials', label: 'Materiali', value: a => articleMaterials(a).map(m => m.name).join(', ') },
  { key: 'metal', label: 'Metallo', value: a => a.metal?.name || '' },
  { key: 'price', label: 'Prezzo', num: true, value: a => a.price_retail ?? -1 },
  { key: 'wholesale', label: 'Ingrosso', num: true, value: a => a.price_wholesale ?? -1 },
  { key: 'stock', label: 'Stock', num: true, value: a => (a.stock_retail || 0) + (a.stock_wholesale || 0) },
]

const ICON_SORT = { 1: '<path d="M12 19V5M5 12l7-7 7 7"/>', '-1': '<path d="M12 5v14M5 12l7 7 7-7"/>' }
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'

// Testo sicuro dentro l'HTML della tabella (nomi con virgolette, ecc.)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// Dentro una collezione la colonna Collezione non serve: solo in "Tutti gli articoli"
function tableColumns() {
  return TABLE_COLUMNS.filter(c => c.key !== 'collection' || !currentCollectionId)
}

function sortedForTable(articles) {
  const col = tableColumns().find(c => c.key === tableSort.key)
  if (!col) return articles
  return [...articles].sort((a, b) => {
    const va = col.value(a), vb = col.value(b)
    const cmp = col.num ? va - vb : String(va).localeCompare(String(vb), 'it', { numeric: true })
    return cmp * tableSort.dir
  })
}

function renderTable(articles) {
  const box = document.getElementById('articlesTable')
  // La selezione resta solo sugli articoli ancora in elenco
  selectedIds = new Set([...selectedIds].filter(id => articles.some(a => a.id === id)))
  const rows = sortedForTable(articles)
  const selectable = isAdmin
  const allSelected = rows.length > 0 && rows.every(a => selectedIds.has(a.id))

  const selectionBar = selectable && selectedIds.size ? `
    <div class="table-selection-bar">
      <span><strong>${selectedIds.size}</strong> ${selectedIds.size === 1 ? 'selezionato' : 'selezionati'}</span>
      <button type="button" class="btn-danger" data-bulk="delete">${ICON_DELETE} Elimina</button>
      <button type="button" class="selection-clear" data-bulk="clear" aria-label="Deseleziona tutto" title="Deseleziona tutto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>` : ''

  const header = `
    <tr>
      ${selectable ? `<th class="col-check"><input type="checkbox" data-select="all" aria-label="Seleziona tutti" ${allSelected ? 'checked' : ''}></th>` : ''}
      ${tableColumns().map(c => {
        const active = tableSort.key === c.key
        const ariaSort = active ? (tableSort.dir === 1 ? 'ascending' : 'descending') : 'none'
        return `<th class="col-${c.key}${c.num ? ' num' : ''}" aria-sort="${ariaSort}">
          <button type="button" class="th-sort" data-sort="${c.key}">${c.label}${active ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">${ICON_SORT[tableSort.dir]}</svg>` : ''}</button>
        </th>`
      }).join('')}
    </tr>`

  const body = rows.length ? rows.map(a => {
    const cover = getCoverPhoto(a.photos)
    const stock = (a.stock_retail || 0) + (a.stock_wholesale || 0)
    const materials = articleMaterials(a).map(m => m.name).join(', ')
    return `
      <tr data-article-id="${a.id}" tabindex="0" class="${selectedIds.has(a.id) ? 'is-selected' : ''}">
        ${selectable ? `<td class="col-check"><input type="checkbox" data-select="${a.id}" aria-label="Seleziona ${esc(a.name)}" ${selectedIds.has(a.id) ? 'checked' : ''}></td>` : ''}
        <td>
          <div class="cell-article">
            <div class="cell-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ''}</div>
            <div class="cell-article-text">
              <div class="cell-title" title="${esc(a.name)}">${esc(a.name)}</div>
              <div class="cell-sub">${esc(a.product_type?.name)}</div>
            </div>
          </div>
        </td>
        <td class="cell-code" title="${esc(a.sku)}">${esc(a.sku)}</td>
        ${currentCollectionId ? '' : `<td title="${esc(a.collections?.name)}">${esc(a.collections?.name || '—')}</td>`}
        <td title="${esc(materials)}">${esc(materials || '—')}</td>
        <td title="${esc(a.metal?.name)}">${esc(a.metal?.name || '—')}</td>
        <td class="num">${formatPrice(a.price_retail)}</td>
        <td class="num">${formatPrice(a.price_wholesale)}</td>
        <td class="num col-last${stock ? '' : ' is-zero'}">
          ${stock}
          <div class="row-actions">
            <a class="row-action" href="/article.html?id=${a.id}" aria-label="Modifica ${esc(a.name)}" title="Modifica">${ICON_EDIT}</a>
            ${isAdmin ? `<button type="button" class="row-action danger" data-delete="${a.id}" aria-label="Elimina ${esc(a.name)}" title="Elimina">${ICON_DELETE}</button>` : ''}
          </div>
        </td>
      </tr>`
  }).join('') : `<tr><td class="table-empty" colspan="${tableColumns().length + (selectable ? 1 : 0)}">${emptyMessage()}</td></tr>`

  box.innerHTML = `
    <div class="table-card">
      ${selectionBar}
      <div class="table-scroll">
        <table class="articles-table">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`

  const selectAll = box.querySelector('[data-select="all"]')
  if (selectAll) selectAll.indeterminate = selectedIds.size > 0 && !allSelected
}

// Clic e tasti nella tabella: un solo gestore per tutto il contenitore
function setupTableEvents() {
  const box = document.getElementById('articlesTable')

  box.addEventListener('click', async e => {
    const sortBtn = e.target.closest('[data-sort]')
    if (sortBtn) {
      const key = sortBtn.dataset.sort
      tableSort = tableSort.key === key ? { key, dir: -tableSort.dir } : { key, dir: 1 }
      renderTable(shownArticles)
      return box.querySelector(`[data-sort="${key}"]`)?.focus()
    }

    const check = e.target.closest('[data-select]')
    if (check) {
      const id = check.dataset.select
      if (id === 'all') {
        selectedIds = check.checked ? new Set(shownArticles.map(a => a.id)) : new Set()
      } else if (check.checked) {
        selectedIds.add(id)
      } else {
        selectedIds.delete(id)
      }
      renderTable(shownArticles)
      return box.querySelector(`[data-select="${id}"]`)?.focus()
    }
    if (e.target.closest('.col-check')) return

    const bulk = e.target.closest('[data-bulk]')
    if (bulk?.dataset.bulk === 'clear') {
      selectedIds = new Set()
      return renderTable(shownArticles)
    }
    if (bulk?.dataset.bulk === 'delete') return removeSelectedArticles()

    const del = e.target.closest('[data-delete]')
    if (del) {
      const a = allArticles.find(x => x.id === del.dataset.delete)
      if (!a || !confirmDeleteArticle(a)) return
      try {
        await deleteArticle(a.id)
        closeDetail()
        await refreshCatalog()
        showToast(`Articolo ${a.sku} eliminato`)
      } catch (err) {
        console.error(err)
        showToast("Errore durante l'eliminazione: " + err.message)
      }
      return
    }
    if (e.target.closest('.row-action')) return // "Modifica" è un link: la pagina si apre da sola

    const row = e.target.closest('tr[data-article-id]')
    if (row) openDetail(row.dataset.articleId)
  })

  box.addEventListener('keydown', e => {
    const row = e.target.closest('tr[data-article-id]')
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      openDetail(row.dataset.articleId)
    }
  })
}

// Eliminazione definitiva degli articoli selezionati nella tabella
async function removeSelectedArticles() {
  const ids = [...selectedIds]
  if (!ids.length) return
  const msg = `ATTENZIONE: stai per eliminare definitivamente ${ids.length === 1 ? "l'articolo selezionato" : `${ids.length} articoli`}.\n\n` +
    'Si perderà anche tutto ciò che li riguarda: foto, materiali e movimenti di magazzino. ' +
    "L'operazione non si può annullare.\n\nVuoi procedere?"
  if (!confirm(msg)) return

  const failed = []
  for (const id of ids) {
    try {
      await deleteArticle(id)
      selectedIds.delete(id)
    } catch (err) {
      console.error(err)
      failed.push(allArticles.find(a => a.id === id)?.sku || id)
    }
  }
  closeDetail()
  await refreshCatalog()
  const done = ids.length - failed.length
  showToast(failed.length
    ? `${done} eliminati, ${failed.length} non eliminati: ${failed.join(', ')}`
    : `${done} ${done === 1 ? 'articolo eliminato' : 'articoli eliminati'}`)
}

// Selettore Griglia / Tabella nella barra in alto
function setupViewToggle() {
  const toggle = document.getElementById('viewToggle')
  const sync = () => toggle.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === viewMode)))
  sync()
  toggle.addEventListener('click', e => {
    const btn = e.target.closest('[data-view]')
    if (!btn || btn.dataset.view === viewMode) return
    viewMode = btn.dataset.view
    try { localStorage.setItem(VIEW_KEY, viewMode) } catch { /* storage non disponibile */ }
    sync()
    renderArticles(shownArticles)
  })
  // Passando da telefono a schermo largo (o viceversa) si ridisegna nella vista giusta
  const onBreakpoint = () => { if (effectiveView() !== renderedView) renderArticles(shownArticles) }
  mobileQuery.addEventListener('change', onBreakpoint)
  window.addEventListener('resize', onBreakpoint)
}

function openDetail(articleId) {
  const a = allArticles.find(x => x.id === articleId)
  if (!a) return
  const panel = document.getElementById('detailPanel')
  const inner = document.getElementById('detailInner')
  const cover = getCoverPhoto(a.photos)

  const dispName = esc(a.name)

  inner.innerHTML = `
    <button type="button" class="detail-x" id="btnDetailClose" aria-label="Chiudi anteprima" title="Chiudi">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div style="aspect-ratio:1;background:var(--ivory);overflow:hidden;flex-shrink:0;">
      ${cover ? `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;" alt="${dispName}">` : ''}
    </div>
    <div style="padding:20px;">
      <div style="font-family:var(--editorial);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--coral);margin-bottom:4px;">${a.collections?.name || ''}</div>
      <div style="font-family:var(--editorial);font-size:20px;font-weight:400;line-height:1.3;margin-bottom:4px;">${dispName}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:16px;">${a.sku}</div>
      ${detailRow('Materiali', articleMaterials(a).map(m => m.name).join(', ') || '—')}
      ${detailRow('Metallo', a.metal?.name || '—')}
      ${detailRow('Prezzo retail', formatPrice(a.price_retail))}
      ${a.price_wholesale ? detailRow('Prezzo ingrosso', formatPrice(a.price_wholesale)) : ''}
      ${detailRow('Stock', (a.stock_retail + a.stock_wholesale) + ' pz')}
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--ivory-dark);display:flex;flex-direction:column;gap:8px;">
      <a href="/article.html?id=${a.id}" class="btn-primary btn-success" style="text-align:center;justify-content:center;">Modifica articolo</a>
      ${isAdmin ? `<button type="button" class="btn-danger" id="btnDetailDelete" style="justify-content:center;">Elimina articolo</button>` : ''}
    </div>`

  document.getElementById('btnDetailClose').addEventListener('click', closeDetail)
  document.getElementById('btnDetailDelete')?.addEventListener('click', async e => {
    if (!confirmDeleteArticle(a)) return
    const btn = e.currentTarget
    btn.disabled = true
    try {
      await deleteArticle(a.id)
      closeDetail()
      await refreshCatalog()
      showToast(`Articolo ${a.sku} eliminato`)
    } catch (err) {
      console.error(err)
      showToast("Errore durante l'eliminazione: " + err.message)
      btn.disabled = false
    }
  })

  panel.classList.add('open')
}

function closeDetail() {
  document.getElementById('detailPanel').classList.remove('open')
}

// Ricarica articoli e collezioni mantenendo la collezione selezionata
async function refreshCatalog() {
  await loadArticles()
  await loadCollections()
  const coll = currentCollections.find(c => c.id === currentCollectionId)
  document.getElementById('breadcrumb').textContent = `Catalogo · ${coll ? coll.name : 'Tutti gli articoli'}`
  renderCurrent()
}

// ── Menu dei tre puntini di una collezione ──────────────────────
let menuOpener = null

function toggleCollectionMenu(btn) {
  const menu = document.getElementById('collectionMenu')
  if (!menu.hidden && menuOpener === btn) return closeCollectionMenu()
  closeCollectionMenu()
  menuOpener = btn
  menu.dataset.collectionId = btn.dataset.menuCollection
  btn.setAttribute('aria-expanded', 'true')
  menu.hidden = false
  // Sotto il pulsante, allineato a destra, senza uscire dallo schermo
  const r = btn.getBoundingClientRect()
  const left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)
  const top = r.bottom + menu.offsetHeight + 4 > window.innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4
  menu.style.left = `${Math.max(8, left)}px`
  menu.style.top = `${Math.max(8, top)}px`
  menu.querySelector('button').focus()
}

function closeCollectionMenu({ restoreFocus = false } = {}) {
  const menu = document.getElementById('collectionMenu')
  if (menu.hidden) return
  menu.hidden = true
  menuOpener?.setAttribute('aria-expanded', 'false')
  if (restoreFocus) menuOpener?.focus()
  menuOpener = null
}

function setupCollectionMenu() {
  const menu = document.getElementById('collectionMenu')
  menu.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action
    const coll = currentCollections.find(c => c.id === menu.dataset.collectionId)
    closeCollectionMenu()
    if (!coll) return
    if (action === 'edit') openCollectionEditor(coll)
    if (action === 'delete') removeCollection(coll)
  })
  // Chiude cliccando fuori, scorrendo la lista o ridimensionando la finestra (Esc: vedi setupListeners)
  document.addEventListener('click', e => {
    if (!e.target.closest('#collectionMenu, .collection-menu-btn')) closeCollectionMenu()
  })
  document.getElementById('collectionList').addEventListener('scroll', () => closeCollectionMenu())
  window.addEventListener('resize', () => closeCollectionMenu())
}

// Finestra "Nuova collezione" / "Modifica collezione"
function openCollectionEditor(coll = null) {
  editingCollectionId = coll?.id ?? null
  document.getElementById('collectionModalTitle').textContent = coll ? 'Modifica Collezione' : 'Nuova Collezione'
  document.getElementById('f_coll_name').value = coll?.name || ''
  document.getElementById('f_coll_code').value = coll ? collectionCode(coll) : ''
  collColor.setValue(coll?.description_en)
  document.getElementById('collectionModal').classList.add('open')
}

// Eliminazione definitiva: prima tutti gli articoli della collezione, poi la collezione
async function removeCollection(coll) {
  const count = allArticles.filter(a => a.collection_id === coll.id).length
  const msg = `ATTENZIONE: stai per eliminare definitivamente la collezione "${coll.name}".\n\n` +
    `Eliminando la collezione verranno eliminati anche tutti gli articoli al suo interno (${count}), ` +
    'con le loro foto, materiali e movimenti di magazzino. ' +
    "L'operazione non si può annullare.\n\nVuoi procedere?"
  if (!confirm(msg)) return
  try {
    await deleteCollection(coll.id)
    if (currentCollectionId === coll.id) currentCollectionId = null
    closeDetail()
    await refreshCatalog()
    showToast(`Collezione ${coll.name} eliminata`)
  } catch (err) {
    console.error(err)
    showToast("Errore durante l'eliminazione: " + err.message)
  }
}

function detailRow(key, val) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--ivory-dark);">
    <span style="font-family:var(--editorial);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);white-space:nowrap;">${key}</span>
    <span style="font-family:var(--editorial);font-size:14px;color:var(--text-primary);text-align:right;">${val}</span>
  </div>`
}

function setupListeners() {
  collColor = initColorSelect(document.getElementById('f_coll_color'), { labelId: 'f_coll_color_label' })

  const openModal = () => openArticleModal({
    // Ricarica per avere collezione, tipo e materiali del nuovo articolo
    onSuccess: async (article) => {
      await refreshCatalog()
      showToast(`Articolo ${article.sku} creato`)
    },
    // Collezione creata dalla finestra dell'articolo: compare subito nella barra laterale
    onCollectionCreated: () => loadCollections()
  })

  document.getElementById('btnNewArticleTop').addEventListener('click', openModal)

  document.getElementById('btnNewCollection').addEventListener('click', () => openCollectionEditor())
  setupCollectionMenu()
  setupViewToggle()
  setupTableEvents()

  // Esc chiude il menu della collezione se è aperto, altrimenti l'anteprima dell'articolo
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (!document.getElementById('collectionMenu').hidden) closeCollectionMenu({ restoreFocus: true })
    else closeDetail()
  })

  document.getElementById('btnSaveCollection').addEventListener('click', async () => {
    const name = document.getElementById('f_coll_name').value.trim()
    const code = document.getElementById('f_coll_code').value.trim().toUpperCase()
    const color = collColor.value

    const invalid = validateCollection({ name, code }, currentCollections, editingCollectionId)
    if (invalid) {
      showToast(invalid)
      return
    }

    try {
      if (editingCollectionId) {
        const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const slug = `${code.toLowerCase()}-${baseSlug}`
        if (!confirm("Avviso: negli articoli creati dall'app il codice SKU verrà aggiornato e il nome della collezione verrà sostituito nel titolo (gli articoli con codice originale restano invariati). Continuare?")) return
        const coll = currentCollections.find(c => c.id === editingCollectionId)
        const oldCode = collectionCode(coll)

        const { error } = await supabase.from('collections').update({
          name, slug, description_en: color, description_it: code
        }).eq('id', editingCollectionId)
        if (error) throw error

        const relatedArticles = allArticles.filter(a => a.collection_id === editingCollectionId)
        for (const a of relatedArticles) {
          if (!isAppSku(a.sku)) continue
          let updatedSku = a.sku
          if (code !== oldCode) {
            updatedSku = code + a.sku.substring(4)
          }
          // Nel titolo si sostituisce solo il nome della collezione: il resto, anche se scritto a mano, resta
          const updatedName = a.name.includes(coll.name) ? a.name.replace(coll.name, name) : a.name

          if (updatedName !== a.name || updatedSku !== a.sku) {
            await supabase.from('articles').update({ name: updatedName, sku: updatedSku }).eq('id', a.id)
          }
        }
        showToast('Collezione aggiornata con successo')
      } else {
        const created = await insertCollection({ name, code, color })
        // Si apre subito la pagina della nuova collezione
        currentCollectionId = created.id
        closeDrawer()
        showToast(`Collezione ${created.name} creata`)
      }
      
      document.getElementById('collectionModal').classList.remove('open')
      await refreshCatalog()
    } catch (err) {
      showToast('Errore: ' + err.message)
    }
  })

  // "Azzera ricerca e filtri" nell'elenco vuoto
  document.querySelector('.catalog-area').addEventListener('click', e => {
    if (!e.target.closest('[data-reset-filters]')) return
    filters.reset()
    document.getElementById('searchInput').focus()
  })
}

init().catch(console.error)
