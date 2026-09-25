// js/article.js
import { supabase, requireAuth, getCollections, getMaterials, getArticleById, updateArticle } from './supabase.js'
import { showToast } from './utils.js'

let articleId = null
let currentArticle = null
let collections = []

async function init() {
  await requireAuth()

  const params = new URLSearchParams(window.location.search)
  articleId = params.get('id')
  if (!articleId) {
    window.location.href = '/catalog.html'
    return
  }

  try {
    // Carica dipendenze
    const [corals, metals] = await Promise.all([
      getMaterials('coral'),
      getMaterials('metal')
    ])
    collections = await getCollections()

    populateSelect('f_collection', collections, 'id', 'name', 'Seleziona collezione…')
    populateSelect('f_coral', corals, 'id', 'name', 'Seleziona…', 'code')
    populateSelect('f_metal', metals, 'id', 'name', 'Seleziona…', 'code')

    // Carica articolo
    currentArticle = await getArticleById(articleId)
    if (!currentArticle) throw new Error('Articolo non trovato')

    document.getElementById('headerName').textContent = currentArticle.name
    document.getElementById('headerSku').textContent = currentArticle.sku

    // Popola campi form
    document.getElementById('f_collection').value = currentArticle.collection_id
    document.getElementById('f_type').value = currentArticle.product_type
    document.getElementById('f_sku').value = currentArticle.sku
    document.getElementById('f_notes').value = currentArticle.notes || ''
    
    document.getElementById('f_coral').value = currentArticle.coral_material_id
    document.getElementById('f_metal').value = currentArticle.metal_material_id
    document.getElementById('f_price_retail').value = currentArticle.price_retail || ''
    document.getElementById('f_price_wholesale').value = currentArticle.price_wholesale || ''

    document.getElementById('f_stock').value = currentArticle.stock_retail + (currentArticle.stock_wholesale || 0)
    
    const meas = currentArticle.measurements || {}
    document.getElementById('f_weight').value = meas.weight_g || ''
    document.getElementById('f_width').value = meas.width_cm || ''
    document.getElementById('f_length').value = meas.length_cm || ''
    document.getElementById('f_height').value = meas.height_cm || ''

    setupListeners()
  } catch (err) {
    showToast('Errore nel caricamento: ' + err.message)
    console.error(err)
  }
}

function populateSelect(id, items, valueKey, labelKey, emptyLabel = '', dataAttr = null) {
  const sel = document.getElementById(id)
  if (!sel) return
  const emptyOpt = emptyLabel ? `<option value="">${emptyLabel}</option>` : ''
  sel.innerHTML = emptyOpt + items.map(it => {
    const dataExtra = dataAttr ? ` data-${dataAttr}="${it[dataAttr]}"` : ''
    return `<option value="${it[valueKey]}"${dataExtra}>${it[labelKey]}</option>`
  }).join('')
}

function setupListeners() {
  document.getElementById('btnCancel').addEventListener('click', () => {
    window.location.href = '/catalog.html'
  })

  document.getElementById('btnSave').addEventListener('click', async () => {
    // Validazione base
    if (!document.getElementById('f_collection').value) return showToast('Seleziona una collezione')
    if (!document.getElementById('f_type').value) return showToast('Seleziona il tipo prodotto')
    if (!document.getElementById('f_coral').value) return showToast('Seleziona il tipo di corallo')
    if (!document.getElementById('f_metal').value) return showToast('Seleziona il tipo di metallo')
    if (!document.getElementById('f_price_retail').value) return showToast('Inserisci il prezzo retail')

    if (!confirm('ATTENZIONE: Stai per sovrascrivere in modo permanente i dati di questo articolo. Il nome a display verrà ricalcolato. Vuoi procedere?')) {
      return
    }

    const btnSave = document.getElementById('btnSave')
    btnSave.textContent = 'Salvataggio...'
    btnSave.disabled = true

    try {
      const collSel = document.getElementById('f_collection')
      const collName = collSel.options[collSel.selectedIndex].text
      const pType = document.getElementById('f_type').value
      const pTypeName = pType.charAt(0).toUpperCase() + pType.slice(1)
      const l = document.getElementById('f_length').value

      const dynamicName = `${pTypeName} ${collName}${l ? ' ' + l + 'cm' : ''}`

      const measurements = {}
      const w = document.getElementById('f_width').value
      const h = document.getElementById('f_height').value
      const wt = document.getElementById('f_weight').value
      if (w) measurements.width_cm = Number(w)
      if (l) measurements.length_cm = Number(l)
      if (h) measurements.height_cm = Number(h)
      if (wt) measurements.weight_g = Number(wt)

      // Attenzione: lo SKU non si modifica qui da form manuale. Lo SKU si modifica a cascata dalla modifica collezione o resta uguale. 
      // Se si cambia collezione o materiale, lo SKU andrebbe rigenerato. Ma in edit-articolo non cambiamo l'SKU se cambiano i materiali per evitare impatti, a meno che non chiamiamo generate_sku al volo.
      // Dalle richieste utente: "modificare tutti i campi ... popup conferma prima". Non menziona che cambiando colore cambia SKU, ma sarebbe l'atteso.
      
      let sku = currentArticle.sku
      // Se collezione, metallo o corallo sono stati cambiati, richiamiamo generate_sku? No, the user explicitly asked for modifying collection code changes all SKUs. When editing an individual article, its SKU is fixed unless the user changes it. Wait... if the user changes the collection of the article, its SKU prefix would be completely wrong! Let's prevent changing collection, or let's re-generate SKU. Let's re-generate SKU if any identity field changed.
      const newColl = document.getElementById('f_collection').value
      const newCoral = document.getElementById('f_coral').value
      const newMetal = document.getElementById('f_metal').value

      if (newColl !== currentArticle.collection_id || newCoral !== currentArticle.coral_material_id || newMetal !== currentArticle.metal_material_id) {
         const { data: newSku, error: skuError } = await supabase.rpc('generate_sku', {
            p_collection_id: newColl,
            p_coral_id: newCoral,
            p_metal_id: newMetal
         })
         if (skuError) throw skuError
         sku = newSku
      }

      const updates = {
        name: dynamicName,
        product_type: pType,
        collection_id: newColl,
        coral_material_id: newCoral,
        metal_material_id: newMetal,
        sku: sku,
        notes: document.getElementById('f_notes').value.trim() || null,
        price_retail: Number(document.getElementById('f_price_retail').value) || null,
        price_wholesale: Number(document.getElementById('f_price_wholesale').value) || null,
        stock_retail: Number(document.getElementById('f_stock').value) || 0,
        stock_wholesale: 0, // Enforce single stock per request
        measurements: Object.keys(measurements).length ? measurements : null
      }

      await updateArticle(articleId, updates)
      showToast('Articolo aggiornato con successo!')
      
      setTimeout(() => {
        window.location.href = '/catalog.html'
      }, 1000)

    } catch (err) {
      console.error(err)
      showToast('Errore durante il salvataggio: ' + err.message)
      btnSave.textContent = 'Salva Modifiche'
      btnSave.disabled = false
    }
  })
}

init().catch(console.error)
