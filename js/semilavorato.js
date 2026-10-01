// js/semilavorato.js
import { requireAuth, getRawCategories, getRawItems, getRawCodeRules, updateRawItem, signOut } from './supabase.js'
import { showToast } from './utils.js'
import { initFilters } from './filters.js'
import { openRawItemModal } from './raw-form.js'
import { initMobileNav, initHamburger, initPanelToggle, closeDrawer } from './pwa.js'

window.signOutUser = signOut

let allItems      = []
let allCategories = []
let rules = { shapes: [], groups: [], variants: [] }   // regole dei codici (raw_shapes, raw_code_groups, raw_variants)
let currentCategoryId  = null

// Filtri per campo (barra sopra gli articoli, vedi filters.js)
const distinct = (items, get) => [...new Set(items.map(get).filter(Boolean))]
const FILTER_FIELDS = [
  { key: 'shape', label: 'Forma', all: 'Tutte', options: items => distinct(items, i => i.raw_shapes?.name).map(v => [v, v]), test: (i, v) => i.raw_shapes?.name === v },
  { key: 'quality', label: 'Qualità', all: 'Tutte', options: items => distinct(items, i => i.quality).map(v => [v, v]), test: (i, v) => i.quality === v },
  { key: 'finish', label: 'Finitura', all: 'Tutte', options: items => distinct(items, i => i.finish).map(v => [v, v]), test: (i, v) => i.finish === v },
  { key: 'size', label: 'Misura', range: true, unit: 'mm', value: i => { const n = i.size_from_mm ?? i.width_mm; return n === null || n === undefined ? null : Number(n) } },
  { key: 'color', label: 'Colore', options: items => distinct(items, i => i.color).map(v => [v, v]), test: (i, v) => i.color === v },
  { key: 'stock', label: 'Disponibilità',
    options: () => [['si', 'Disponibili'], ['no', 'Esauriti']],
    test: (i, v) => (i.stock > 0) === (v === 'si') },
]
let filters = null

async function init() {
  initPanelToggle()
  await requireAuth()
  filters = initFilters({
    fields: FILTER_FIELDS,
    text: i => [i.sku, i.description, i.size, i.color, i.quality, i.finish, (i.variants || []).join(' '), i.raw_shapes?.name, i.raw_categories?.name, i.notes].join('\n'),
    onChange: () => renderCurrent(),
  })
  rules = await getRawCodeRules()
  await refresh()
  setupListeners()

  // Mobile PWA
  initHamburger()
  initMobileNav({
    onNewArticle: () => document.getElementById('btnNewItem')?.click(),
  })
}

// ─── Categorie ────────────────────────────────────────────────

async function loadCategories() {
  allCategories = await getRawCategories()
  const list = document.getElementById('categoryList')

  list.innerHTML = renderCategoryItem({ id: null, name: 'Tutti i semilavorati' }, !currentCategoryId)
  allCategories.forEach(c => { list.innerHTML += renderCategoryItem(c, c.id === currentCategoryId) })

  // onclick e non addEventListener: loadCategories viene richiamata a ogni aggiornamento
  list.onclick = e => {
    const item = e.target.closest('[data-category-id]')
    if (!item) return
    currentCategoryId = item.dataset.categoryId === 'null' ? null : item.dataset.categoryId

    list.querySelectorAll('[data-category-id]').forEach(el => el.classList.remove('active'))
    item.classList.add('active')
    document.getElementById('breadcrumb').textContent = `Semilavorato · ${item.dataset.categoryName}`
    renderCurrent()
    closeDrawer()
  }
}

function renderCategoryItem(c, isActive) {
  const count  = allItems.filter(i => !c.id || i.category_id === c.id).length
  const colors = { pallini: '#E8A898', spole: '#C9A84C', navette: '#B8B4AE' }
  const color  = colors[c.slug] || '#C94030'
  return `
    <div data-category-id="${c.id}" data-category-name="${c.name}"
         class="collection-item${isActive ? ' active' : ''}">
      <div class="collection-dot" style="background:${color};"></div>
      <span class="collection-name">${c.name}</span>
      <span class="collection-count">${count}</span>
    </div>`
}

// ─── Grid ─────────────────────────────────────────────────────

// Ordine del catalogo: categoria, gruppo del codice, misura, codice (i più recenti senza gruppo in fondo)
function sortItems(items) {
  const catOrder = new Map(allCategories.map(c => [c.id, c.sort_order]))
  const groupOrder = new Map(rules.groups.map(g => [g.code, g.sort_order]))
  const size = i => Number(i.size_from_mm ?? i.width_mm ?? 0)
  return [...items].sort((a, b) =>
    (catOrder.get(a.category_id) ?? 99) - (catOrder.get(b.category_id) ?? 99)
    || (groupOrder.get(a.group_code) ?? 999) - (groupOrder.get(b.group_code) ?? 999)
    || size(a) - size(b)
    || Number(a.length_mm ?? 0) - Number(b.length_mm ?? 0)
    || String(a.sku).localeCompare(String(b.sku), 'it', { numeric: true }))
}

// Articoli da mostrare: categoria selezionata, poi ricerca e filtri
function renderCurrent() {
  const inCategory = currentCategoryId ? allItems.filter(i => i.category_id === currentCategoryId) : allItems
  filters.refresh(inCategory)
  const shown = sortItems(filters.apply(inCategory))
  document.getElementById('itemCount').textContent = `${shown.length} ${shown.length === 1 ? 'articolo' : 'articoli'}`
  renderGrid(shown)
}

function getColorClass(color) {
  if (!color) return ''
  const c = color.toLowerCase()
  if (c.includes('rosso') || c.includes('sciacca')) return 'color-rosso'
  if (c.includes('rosa'))   return 'color-rosa'
  if (c.includes('bianco')) return 'color-bianco'
  return ''
}

function getQualityClass(quality) {
  if (!quality) return ''
  const q = quality.toLowerCase()
  if (q === 'i' || q.includes('extra') || q.includes('top')) return 'quality-top'
  return ''
}

function renderGrid(items) {
  const grid = document.getElementById('itemsGrid')
  if (items.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--editorial);font-size:18px;color:var(--text-muted);">Nessun articolo trovato</div>`
    return
  }

  grid.innerHTML = items.map((item, i) => {
    const catName    = item.raw_categories?.name || '—'
    const stockColor = item.stock === 0 ? 'color:var(--coral)' : item.stock < 5 ? 'color:#C9A84C' : 'color:var(--text-primary)'

    return `
      <div class="raw-item-card" data-item-id="${item.id}" role="listitem" tabindex="0" title="${(item.description || '').replace(/"/g, '&quot;')}"
           style="animation-delay:${Math.min(i, 12) * 0.04}s" aria-label="${catName} ${item.size || ''} — ${item.stock} pz">

        ${item.cover_url
          ? `<div style="aspect-ratio:4/3;overflow:hidden;border-radius:3px;margin:-16px -16px 0;">
               <img src="${item.cover_url}" alt="${catName}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.4s;">
             </div>`
          : ''}

        <div class="raw-item-category">${catName}</div>
        <button class="raw-edit-btn" aria-label="Modifica articolo" style="position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:4px;background:rgba(255,255,255,0.9);border:1px solid var(--ivory-dark);color:var(--text-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;box-shadow:0 2px 4px rgba(0,0,0,0.05);">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-bottom:4px;">${item.sku || 'N/D'}</div>
        <div class="raw-item-size">${item.size || '—'}</div>

        <div class="raw-item-badges">
          ${item.raw_shapes?.name ? `<span class="raw-badge">${item.raw_shapes.name}</span>` : ''}
          ${item.quality ? `<span class="raw-badge ${getQualityClass(item.quality)}">${item.quality}</span>` : ''}
          ${item.finish  ? `<span class="raw-badge quality-top">${item.finish}</span>` : ''}
          ${(item.variants || []).map(v => `<span class="raw-badge">${v}</span>`).join('')}
          ${item.color   ? `<span class="raw-badge ${getColorClass(item.color)}">${item.color}</span>`     : ''}
        </div>

        <div class="raw-item-stock-row">
          <div>
            <div class="raw-item-stock-num" id="stock-${item.id}" style="${stockColor}">${item.stock}</div>
            <div class="raw-item-stock-label">disponibili</div>
          </div>
        </div>

        <!-- Pulsante movimentazione stock -->
        <button class="raw-movimento-btn" data-id="${item.id}" aria-label="Movimenta stock">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Movimenta stock
        </button>
      </div>`
  }).join('')

  // Click bottone modifica (penna) → modale modifica
  grid.querySelectorAll('.raw-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const card = btn.closest('.raw-item-card')
      const item = allItems.find(x => x.id === card.dataset.itemId)
      if (item) openRawItemModal({ item, categories: allCategories, rules, onSuccess: refresh })
    })
  })

  // Click bottone movimenta → modale carico/scarico
  grid.querySelectorAll('.raw-movimento-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const item = allItems.find(x => x.id === btn.dataset.id)
      if (item) openStockModal(item)
    })
  })
}

// ─── Stock CSS per il bottone movimenta ───────────────────────

const moveStyle = document.createElement('style')
moveStyle.textContent = `
  .raw-movimento-btn {
    width: 100%;
    padding: 8px 12px;
    background: var(--ivory);
    border: 1.5px solid var(--ivory-dark);
    border-radius: 3px;
    font-family: var(--editorial);
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.15s;
    -webkit-tap-highlight-color: transparent;
  }
  .raw-movimento-btn:hover {
    border-color: var(--coral);
    color: var(--coral);
    background: rgba(201,64,48,0.04);
  }
`
document.head.appendChild(moveStyle)

// ─── Modale Carico / Scarico ──────────────────────────────────

function openStockModal(item) {
  document.getElementById('stockModal')?.remove()

  const catName = item.raw_categories?.name || ''

  const overlay = document.createElement('div')
  overlay.id = 'stockModal'
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow">${catName}${item.size ? ' · ' + item.size : ''}</div>
          <div class="modal-title">Movimentazione Stock</div>
        </div>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;"
                id="closeStockModal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="modal-body">

        <!-- Tipo operazione -->
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button class="stock-op-btn active" id="opCarico" data-op="carico"
                  style="flex:1;padding:10px;border-radius:4px;border:1.5px solid var(--coral);background:rgba(201,64,48,0.08);font-family:var(--editorial);font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--coral);cursor:pointer;transition:all 0.15s;">
            ↑ Carico
          </button>
          <button class="stock-op-btn" id="opScarico" data-op="scarico"
                  style="flex:1;padding:10px;border-radius:4px;border:1.5px solid var(--ivory-dark);background:white;font-family:var(--editorial);font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--text-secondary);cursor:pointer;transition:all 0.15s;">
            ↓ Scarico
          </button>
        </div>

        <!-- Stock attuale -->
        <div style="padding:12px 16px;background:var(--ivory);border-radius:4px;margin-bottom:16px;display:flex;align-items:baseline;gap:8px;">
          <span style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);">Stock attuale:</span>
          <span style="font-family:var(--editorial);font-size:22px;font-weight:700;color:var(--text-primary);" id="currentStockDisplay">${item.stock}</span>
          <span style="font-family:var(--editorial);font-size:11px;color:var(--text-muted);">pezzi</span>
        </div>

        <div class="form-row full">
          <div class="form-field">
            <label class="field-label">Quantità <span class="field-required">*</span></label>
            <input type="number" class="field-input" id="stockQty" min="1" step="1" value="1" placeholder="Inserisci quantità…">
          </div>
        </div>

        <!-- Anteprima nuovo stock -->
        <div style="padding:10px 14px;background:rgba(201,64,48,0.05);border:1px solid rgba(201,64,48,0.15);border-radius:4px;margin-top:4px;display:flex;align-items:baseline;gap:8px;">
          <span style="font-family:var(--editorial);font-size:11px;color:var(--text-muted);">Nuovo stock:</span>
          <span style="font-family:var(--editorial);font-size:20px;font-weight:700;color:var(--coral);" id="newStockPreview">${item.stock + 1}</span>
          <span style="font-family:var(--editorial);font-size:11px;color:var(--text-muted);">pezzi</span>
        </div>

        <div class="form-row full" style="margin-top:16px;">
          <div class="form-field">
            <label class="field-label">Motivo <span style="color:var(--text-muted);font-style:italic;">— opzionale</span></label>
            <input type="text" class="field-input" id="stockNote" placeholder="es. Consegna fornitore, Vendita fiera…">
          </div>
        </div>
      </div>

      <div class="modal-footer" style="justify-content:flex-end;gap:8px;">
        <button class="btn-ghost" id="cancelStockModal">Annulla</button>
        <button class="btn-primary" id="confirmStockBtn">Conferma</button>
      </div>
    </div>`

  document.body.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('open'))

  let currentOp = 'carico'

  function updatePreview() {
    const qty     = Math.max(0, Number(document.getElementById('stockQty').value) || 0)
    const delta   = currentOp === 'carico' ? qty : -qty
    const newStock = Math.max(0, item.stock + delta)
    document.getElementById('newStockPreview').textContent = newStock
  }

  // Toggle carico/scarico
  overlay.querySelectorAll('.stock-op-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentOp = btn.dataset.op
      overlay.querySelectorAll('.stock-op-btn').forEach(b => {
        const isActive = b.dataset.op === currentOp
        b.style.borderColor  = isActive ? 'var(--coral)' : 'var(--ivory-dark)'
        b.style.background   = isActive ? 'rgba(201,64,48,0.08)' : 'white'
        b.style.color        = isActive ? 'var(--coral)' : 'var(--text-secondary)'
      })
      updatePreview()
    })
  })

  document.getElementById('stockQty').addEventListener('input', updatePreview)

  // Chiudi
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 300) }
  document.getElementById('closeStockModal').addEventListener('click', close)
  document.getElementById('cancelStockModal').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  // Conferma
  document.getElementById('confirmStockBtn').addEventListener('click', async () => {
    const qty = Number(document.getElementById('stockQty').value)
    if (!qty || qty <= 0) { showToast('Inserisci una quantità valida'); return }

    const delta    = currentOp === 'carico' ? qty : -qty
    const newStock = Math.max(0, item.stock + delta)
    const note     = document.getElementById('stockNote').value.trim()

    const btn = document.getElementById('confirmStockBtn')
    btn.textContent = 'Salvataggio…'; btn.disabled = true

    try {
      await updateRawItem(item.id, { stock: newStock })
      item.stock = newStock

      // Aggiorna il numero nella griglia senza re-render completo
      const numEl = document.getElementById(`stock-${item.id}`)
      if (numEl) {
        numEl.textContent = newStock
        numEl.style.color = newStock === 0 ? 'var(--coral)' : newStock < 5 ? '#C9A84C' : 'var(--text-primary)'
        numEl.animate([
          { transform: 'scale(1.25)', opacity: 0.7 },
          { transform: 'scale(1)',    opacity: 1 }
        ], { duration: 250, easing: 'ease-out' })
      }

      const opLabel = currentOp === 'carico' ? 'Caricati' : 'Scaricati'
      showToast(`${opLabel} ${qty} pz${note ? ' — ' + note : ''}`)
      close()
    } catch (err) {
      showToast('Errore: ' + err.message)
      btn.textContent = 'Conferma'; btn.disabled = false
    }
  })
}

// ─── Refresh ──────────────────────────────────────────────────

// Prima gli articoli, poi le categorie (che ne mostrano il conteggio)
async function refresh() {
  allItems = await getRawItems()
  await loadCategories()
  renderCurrent()
}

// ─── Listeners ────────────────────────────────────────────────

function setupListeners() {
  // Nuovo pezzo
  document.getElementById('btnNewItem').addEventListener('click', () => {
    openRawItemModal({ categories: allCategories, rules, defaultCategoryId: currentCategoryId, onSuccess: refresh })
  })
}

init().catch(console.error)
