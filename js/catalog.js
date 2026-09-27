// js/catalog.js
import { supabase, requireAuth, getCollections, getArticles, insertCollection, deleteArticle, deleteCollection, signOut } from './supabase.js'
import { formatPrice, getCoverPhoto, showToast, debounce, isAppSku, articleMaterials, COLLECTION_COLORS, collectionColorOptions, collectionCode, validateCollection, confirmDeleteArticle } from './utils.js'
import { openArticleModal } from './article-form.js'
import { initMobileNav, initHamburger, addDetailPanelCloseBtn, closeDrawer } from './pwa.js'

window.signOutUser = signOut

let allArticles = []
let currentCollections = []
let currentCollectionId = null
let editingCollectionId = null // collezione aperta in "Modifica collezione"; null = nuova
let isAdmin = false

async function init() {
  const session = await requireAuth()
  // Modifica/eliminazione di collezioni e articoli: solo admin (lo impone anche il database)
  isAdmin = session.user.app_metadata?.role === 'admin'
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
    renderGrid(allArticles.filter(a => !currentCollectionId || a.collection_id === currentCollectionId))

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
  renderGrid(allArticles)
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

function renderGrid(articles) {
  const grid = document.getElementById('articlesGrid')
  if (articles.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--editorial);font-size:18px;color:var(--text-muted);">Nessun articolo trovato</div>`
    return
  }

  grid.innerHTML = articles.map((a, i) => {
    const cover = getCoverPhoto(a.photos)
    const collName = a.collections?.name || ''
    
    const pTypeName = a.product_type?.name || ''
    const l = a.measurements?.length_cm ? ` ${a.measurements.length_cm}cm` : ''
    const computedName = `${pTypeName} ${collName}${l}`.trim()
    const dispName = computedName || a.name

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
          <div class="card-name">${dispName}</div>
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

function openDetail(articleId) {
  const a = allArticles.find(x => x.id === articleId)
  if (!a) return
  const panel = document.getElementById('detailPanel')
  const inner = document.getElementById('detailInner')
  const cover = getCoverPhoto(a.photos)

  const pTypeName = a.product_type?.name || ''
  const l = a.measurements?.length_cm ? ` ${a.measurements.length_cm}cm` : ''
  const computedName = `${pTypeName} ${a.collections?.name || ''}${l}`.trim()
  const dispName = computedName || a.name

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
  renderGrid(allArticles.filter(a => !currentCollectionId || a.collection_id === currentCollectionId))
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
  document.getElementById('f_coll_color').value = COLLECTION_COLORS.some(([v]) => v === coll?.description_en) ? coll.description_en : COLLECTION_COLORS[0][0]
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
  document.getElementById('f_coll_color').innerHTML = collectionColorOptions()

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

  // Esc chiude il menu della collezione se è aperto, altrimenti l'anteprima dell'articolo
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (!document.getElementById('collectionMenu').hidden) closeCollectionMenu({ restoreFocus: true })
    else closeDetail()
  })

  document.getElementById('btnSaveCollection').addEventListener('click', async () => {
    const name = document.getElementById('f_coll_name').value.trim()
    const code = document.getElementById('f_coll_code').value.trim().toUpperCase()
    const color = document.getElementById('f_coll_color').value

    const invalid = validateCollection({ name, code }, currentCollections, editingCollectionId)
    if (invalid) {
      showToast(invalid)
      return
    }

    try {
      if (editingCollectionId) {
        const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const slug = `${code.toLowerCase()}-${baseSlug}`
        if (!confirm('Avviso: Modificando la collezione, SKU e Nome degli articoli creati dall\'app verranno ricalcolati e sovrascritti (gli articoli con codice originale restano invariati). Continuare?')) return
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
          const pTypeName = a.product_type?.name || ''
          const l = a.measurements?.length_cm ? ` ${a.measurements.length_cm}cm` : ''
          const updatedName = `${pTypeName} ${name}${l}`.trim()

          if (updatedName !== a.name || updatedSku !== a.sku) {
            await supabase.from('articles').update({ name: updatedName, sku: updatedSku }).eq('id', a.id)
          }
        }
        showToast('Collezione aggiornata con successo')
      } else {
        await insertCollection({ name, code, color })
        showToast('Collezione creata con successo')
      }
      
      document.getElementById('collectionModal').classList.remove('open')
      await refreshCatalog()
    } catch (err) {
      showToast('Errore: ' + err.message)
    }
  })

  // Filtri Avanzati
  const applyFilters = () => {
    const q = document.getElementById('searchInput').value.toLowerCase().trim()
    const fColl = document.getElementById('filterCollection')?.value
    const fType = document.getElementById('filterType')?.value
    const fMat  = document.getElementById('filterMaterial')?.value

    const filtered = allArticles.filter(a => {
      // 1. Keyword search
      let matchQ = true
      if (q) {
        matchQ = (
          a.name.toLowerCase().includes(q) ||
          a.sku.toLowerCase().includes(q) ||
          (a.collections?.name || '').toLowerCase().includes(q) ||
          (a.product_type?.name || '').toLowerCase().includes(q) ||
          articleMaterials(a).some(m => m.name.toLowerCase().includes(q))
        )
      }
      
      // 2. Dropdown filters (And)
      let matchColl = true
      if (fColl) matchColl = (a.collection_id === fColl)

      let matchType = true
      if (fType) matchType = (a.type === fType)

      let matchMat = true
      if (fMat) matchMat = articleMaterials(a).some(m => m.id === fMat)

      return matchQ && matchColl && matchType && matchMat
    })
    
    renderGrid(filtered)
  }

  document.getElementById('searchInput').addEventListener('input', debounce(applyFilters))

  document.getElementById('btnOpenFilters')?.addEventListener('click', () => {
    // Popola Collezioni
    const colSel = document.getElementById('filterCollection')
    if (colSel && colSel.options.length <= 1) {
      allCollections.forEach(c => {
        const o = document.createElement('option')
        o.value = c.id
        o.textContent = c.name
        colSel.appendChild(o)
      })
    }
    // Popola Tipi
    const typeSel = document.getElementById('filterType')
    if (typeSel && typeSel.options.length <= 1) {
      const types = [...new Set(allArticles.map(a => a.type).filter(Boolean))]
      types.forEach(t => {
        const o = document.createElement('option')
        o.value = t
        o.textContent = t
        typeSel.appendChild(o)
      })
    }
    
    // Popola Materiali (solo quelli usati da almeno un articolo)
    const matSel = document.getElementById('filterMaterial')
    if (matSel && matSel.options.length <= 1) {
      const used = [...new Map(allArticles.flatMap(articleMaterials).map(m => [m.id, m.name]))]
        .sort((x, y) => x[1].localeCompare(y[1], 'it'))
      used.forEach(([id, name]) => {
        const o = document.createElement('option')
        o.value = id
        o.textContent = name
        matSel.appendChild(o)
      })
    }

    document.getElementById('filtersModal')?.classList.add('open')
  })

  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    applyFilters()
    document.getElementById('filtersModal')?.classList.remove('open')
  })
  
  // Applica in tempo reale
  document.getElementById('filterCollection')?.addEventListener('change', applyFilters)
  document.getElementById('filterType')?.addEventListener('change', applyFilters)
  document.getElementById('filterMaterial')?.addEventListener('change', applyFilters)
}

init().catch(console.error)
