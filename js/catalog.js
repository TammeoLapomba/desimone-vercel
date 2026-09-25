// js/catalog.js
import { supabase, requireAuth, getCollections, getArticles, subscribeToArticleStatus, signOut } from './supabase.js'
import { formatPrice, statusLabel, statusClass, getCoverPhoto, showToast, debounce } from './utils.js'
import { openArticleModal } from './article-form.js'
import { initMobileNav, initHamburger, addDetailPanelCloseBtn, closeDrawer } from './pwa.js'

window.signOutUser = signOut

let allArticles = []
let currentCollections = []
let currentCollectionId = null
let isEditingCollection = false

async function init() {
  await requireAuth()
  await loadCollections()
  await loadArticles()
  setupRealtime()
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
  list.innerHTML = renderCollectionItem({ id: null, name: 'Tutti gli articoli', slug: 'all', color: '#C94030' }, true)

  collections.forEach(c => {
    const colorMap = { 'intreccio': '#C94030', 'abbraccio': '#E8A898', 'trame-di-corallo': '#D4C4B8', 'cielo-stellato': '#C8C8C8' }
    list.innerHTML += renderCollectionItem({ ...c, color: c.description_en || colorMap[c.slug] || '#C94030' }, false)
  })

  list.addEventListener('click', e => {
    const item = e.target.closest('[data-collection-id]')
    if (!item) return
    currentCollectionId = item.dataset.collectionId === 'null' ? null : item.dataset.collectionId
    
    // Toggle actions in topbar
    const actions = document.getElementById('collectionActions')
    if (actions) actions.style.display = currentCollectionId ? 'flex' : 'none'

    list.querySelectorAll('[data-collection-id]').forEach(el => el.classList.remove('active'))
    item.classList.add('active')
    document.getElementById('breadcrumb').textContent = `Catalogo · ${item.dataset.collectionName}`
    renderGrid(allArticles.filter(a => !currentCollectionId || a.collection_id === currentCollectionId))

    // Chiude il drawer su mobile dopo la selezione
    closeDrawer()
  })
}

function renderCollectionItem(c, isActive) {
  const countMatch = allArticles.filter(a => !c.id || a.collection_id === c.id).length
  return `
    <div data-collection-id="${c.id}" data-collection-name="${c.name}"
         class="collection-item${isActive ? ' active' : ''}">
      <div class="collection-dot" style="background:${c.color};"></div>
      <span class="collection-name">${c.name}</span>
      <span class="collection-count">${countMatch}</span>
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
  if (type === 'coral') {
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
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--serif);font-size:18px;color:var(--text-muted);">Nessun articolo trovato</div>`
    return
  }

  grid.innerHTML = articles.map((a, i) => {
    const cover = getCoverPhoto(a.photos)
    const collName = a.collections?.name || ''
    
    const pType = a.product_type || ''
    const pTypeName = pType ? pType.charAt(0).toUpperCase() + pType.slice(1) : ''
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
          <span class="status-badge ${statusClass(a.status)}">${statusLabel(a.status)}</span>
        </div>
        <div class="card-body">
          <div class="card-collection">${collName}</div>
          <div class="card-name">${dispName}</div>
          <div class="card-sku">${a.sku}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
            ${a.coral ? `<span style="padding:2px 6px;border-radius:2px;font-family:var(--editorial);font-size:10px;${getBadgeStyle(a.coral.name, 'coral')}">${a.coral.name}</span>` : ''}
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

  const pType = a.product_type || ''
  const pTypeName = pType ? pType.charAt(0).toUpperCase() + pType.slice(1) : ''
  const l = a.measurements?.length_cm ? ` ${a.measurements.length_cm}cm` : ''
  const computedName = `${pTypeName} ${a.collections?.name || ''}${l}`.trim()
  const dispName = computedName || a.name

  inner.innerHTML = `
    <div style="aspect-ratio:1;background:var(--ivory);overflow:hidden;flex-shrink:0;">
      ${cover ? `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;" alt="${dispName}">` : ''}
    </div>
    <div style="padding:20px;">
      <div style="font-family:var(--editorial);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--coral);margin-bottom:4px;">${a.collections?.name || ''}</div>
      <div style="font-family:var(--serif);font-size:18px;margin-bottom:4px;">${dispName}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:16px;">${a.sku}</div>
      ${detailRow('Corallo', a.coral?.name || '—')}
      ${detailRow('Metallo', a.metal?.name || '—')}
      ${detailRow('Prezzo retail', formatPrice(a.price_retail))}
      ${a.price_wholesale ? detailRow('Prezzo ingrosso', formatPrice(a.price_wholesale)) : ''}
      ${detailRow('Stock', (a.stock_retail + a.stock_wholesale) + ' pz')}
      ${detailRow('Stato', statusLabel(a.status))}
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--ivory-dark);display:flex;flex-direction:column;gap:8px;">
      <a href="/article.html?id=${a.id}" class="btn-primary" style="text-align:center;justify-content:center;">Modifica articolo</a>
    </div>`

  panel.classList.add('open')
}

function detailRow(key, val) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--ivory-dark);">
    <span style="font-family:var(--editorial);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);">${key}</span>
    <span style="font-family:var(--editorial);font-size:14px;color:var(--text-primary);text-align:right;">${val}</span>
  </div>`
}

function setupRealtime() {
  subscribeToArticleStatus((updated) => {
    const idx = allArticles.findIndex(a => a.id === updated.id)
    if (idx !== -1) {
      allArticles[idx] = { ...allArticles[idx], ...updated }
      const card = document.querySelector(`[data-article-id="${updated.id}"]`)
      if (card) {
        const badge = card.querySelector('.status-badge')
        if (badge) {
          badge.className = `status-badge ${statusClass(updated.status)}`
          badge.textContent = statusLabel(updated.status)
        }
      }
      if (updated.status === 'ready') showToast(`${updated.sku} — elaborazione completata`)
    }
  })
}

function setupListeners() {
  const openModal = () => openArticleModal({
    onSuccess: (article) => {
      const toast = document.getElementById('processingToast')
      document.getElementById('processingSkuLabel').textContent = article.sku
      toast.classList.add('visible')
      setTimeout(() => toast.classList.remove('visible'), 5000)
      allArticles.unshift(article)
      renderGrid(allArticles)
      showToast(`Articolo ${article.sku} creato — pipeline AI avviata`)
    }
  })

  document.getElementById('btnNewArticleTop').addEventListener('click', openModal)

  document.getElementById('btnNewCollection').addEventListener('click', () => {
    isEditingCollection = false
    document.getElementById('collectionModalTitle').textContent = 'Nuova Collezione'
    document.getElementById('f_coll_name').value = ''
    document.getElementById('f_coll_code').value = ''
    document.getElementById('f_coll_color').value = '#C94030'
    document.getElementById('collectionModal').classList.add('open')
  })

  const btnEditCollection = document.getElementById('btnEditCollection')
  if (btnEditCollection) {
    btnEditCollection.addEventListener('click', () => {
      const coll = currentCollections.find(c => c.id === currentCollectionId)
      if (!coll) return
      isEditingCollection = true
      document.getElementById('collectionModalTitle').textContent = 'Modifica Collezione'
      document.getElementById('f_coll_name').value = coll.name || ''
      document.getElementById('f_coll_code').value = coll.description_it || (coll.slug ? coll.slug.substring(0, 4).toUpperCase() : '')
      document.getElementById('f_coll_color').value = Object.keys(document.getElementById('f_coll_color').options).map(k=>document.getElementById('f_coll_color').options[k].value).includes(coll.description_en) ? coll.description_en : '#C94030'
      document.getElementById('collectionModal').classList.add('open')
    })
  }

  const btnDeleteCollection = document.getElementById('btnDeleteCollection')
  if (btnDeleteCollection) {
    btnDeleteCollection.addEventListener('click', async () => {
      if (!confirm('ATTENZIONE: Eliminando questa collezione, tutti gli articoli al suo interno verranno disabilitati in via definitiva (Soft-Delete). Vuoi procedere?')) return
      try {
        const relatedArticles = allArticles.filter(a => a.collection_id === currentCollectionId)
        const delDate = new Date().toISOString()
        for (const a of relatedArticles) {
          await supabase.from('articles').update({ deleted_at: delDate }).eq('id', a.id)
        }
        const coll = currentCollections.find(c => c.id === currentCollectionId)
        await supabase.from('collections').update({ 
          deleted_at: delDate, 
          slug: `${coll.slug}-del-${Date.now()}`
        }).eq('id', currentCollectionId)
        showToast('Collezione eliminata')
        currentCollectionId = null
        document.getElementById('collectionActions').style.display = 'none'
        document.getElementById('breadcrumb').textContent = 'Catalogo · Tutti gli articoli'
        await loadCollections()
        await loadArticles()
      } catch (err) {
        showToast("Errore durante l'eliminazione: " + err.message)
      }
    })
  }

  document.getElementById('btnSaveCollection').addEventListener('click', async () => {
    const name = document.getElementById('f_coll_name').value.trim()
    const code = document.getElementById('f_coll_code').value.trim().toUpperCase()
    const color = document.getElementById('f_coll_color').value

    if (!name || code.length !== 4) {
      showToast('Nome richiesto e codice di 4 lettere esatte')
      return
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const slug = `${code.toLowerCase()}-${baseSlug}`

    try {
      if (isEditingCollection) {
        if (!confirm('Avviso: Modificando la collezione, SKU e Nome di tutti i suoi articoli verranno ricalcolati e sovrascritti. Continuare?')) return
        const coll = currentCollections.find(c => c.id === currentCollectionId)
        const oldCode = coll.description_it || coll.slug.substring(0, 4).toUpperCase()

        const { error } = await supabase.from('collections').update({
          name, slug, description_en: color, description_it: code
        }).eq('id', currentCollectionId)
        if (error) throw error

        const relatedArticles = allArticles.filter(a => a.collection_id === currentCollectionId)
        for (const a of relatedArticles) {
          let updatedSku = a.sku
          if (code !== oldCode) {
            updatedSku = code + a.sku.substring(4)
          }
          const pType = a.product_type || ''
          const pTypeName = pType ? pType.charAt(0).toUpperCase() + pType.slice(1) : ''
          const l = a.measurements?.length_cm ? ` ${a.measurements.length_cm}cm` : ''
          const updatedName = `${pTypeName} ${name}${l}`.trim()

          if (updatedName !== a.name || updatedSku !== a.sku) {
            await supabase.from('articles').update({ name: updatedName, sku: updatedSku }).eq('id', a.id)
          }
        }
        showToast('Collezione aggiornata con successo')
      } else {
        const { error } = await supabase.from('collections').insert({
          name, slug, description_en: color, description_it: code
        })
        if (error) throw error
        showToast('Collezione creata con successo')
      }
      
      document.getElementById('collectionModal').classList.remove('open')
      await loadCollections()
      await loadArticles(currentCollectionId)
    } catch (err) {
      showToast('Errore: ' + err.message)
    }
  })

  // Filtri Avanzati
  const applyFilters = () => {
    const q = document.getElementById('searchInput').value.toLowerCase().trim()
    const fColl = document.getElementById('filterCollection')?.value
    const fType = document.getElementById('filterType')?.value
    const fCol  = document.getElementById('filterColor')?.value

    const filtered = allArticles.filter(a => {
      // 1. Keyword search
      let matchQ = true
      if (q) {
        matchQ = (
          a.name.toLowerCase().includes(q) ||
          a.sku.toLowerCase().includes(q) ||
          (a.collections?.name || '').toLowerCase().includes(q) ||
          (a.type || '').toLowerCase().includes(q) ||
          (a.color || '').toLowerCase().includes(q)
        )
      }
      
      // 2. Dropdown filters (And)
      let matchColl = true
      if (fColl) matchColl = (a.collection_id === fColl)

      let matchType = true
      if (fType) matchType = (a.type === fType)

      let matchCol = true
      if (fCol) matchCol = (a.color === fCol)

      return matchQ && matchColl && matchType && matchCol
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
    
    document.getElementById('filtersModal')?.classList.add('open')
  })

  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    applyFilters()
    document.getElementById('filtersModal')?.classList.remove('open')
  })
  
  // Applica in tempo reale
  document.getElementById('filterCollection')?.addEventListener('change', applyFilters)
  document.getElementById('filterType')?.addEventListener('change', applyFilters)
  document.getElementById('filterColor')?.addEventListener('change', applyFilters)
}

init().catch(console.error)
