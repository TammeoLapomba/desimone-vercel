// js/article.js
import { supabase, requireAuth, getCollections, getMaterials, getMetals, getProductTypes, getArticleById, updateArticle, setArticleMaterials, deleteArticle } from './supabase.js'
import { showToast, isAppSku } from './utils.js'
import { initMaterialPicker } from './material-picker.js'

let articleId = null
let currentArticle = null
let collections = []
let materialPicker = null
let originalMaterialIds = []
let isAdmin = false

async function init() {
  const session = await requireAuth()
  // Solo l'admin può eliminare (lo impone anche il database)
  isAdmin = session.user.app_metadata?.role === 'admin'

  const params = new URLSearchParams(window.location.search)
  articleId = params.get('id')
  if (!articleId) {
    window.location.href = '/catalog.html'
    return
  }

  try {
    // Carica dipendenze
    const [productTypes, materials, metals] = await Promise.all([
      getProductTypes(),
      getMaterials(),
      getMetals()
    ])
    collections = await getCollections()

    populateSelect('f_collection', collections, 'id', 'name', 'Seleziona collezione…')
    populateSelect('f_type', productTypes, 'id', 'name', 'Seleziona…')
    populateSelect('f_metal', metals, 'id', 'name', 'Seleziona…', 'code')

    // Carica articolo
    currentArticle = await getArticleById(articleId)
    if (!currentArticle) throw new Error('Articolo non trovato')

    document.getElementById('headerName').textContent = currentArticle.name
    document.getElementById('headerSku').textContent = currentArticle.sku

    // Popola campi form
    document.getElementById('f_collection').value = currentArticle.collection_id
    document.getElementById('f_type').value = currentArticle.product_type_id
    document.getElementById('f_sku').value = currentArticle.sku
    document.getElementById('f_notes').value = currentArticle.notes || ''
    
    originalMaterialIds = (currentArticle.article_materials || [])
      .slice().sort((a, b) => a.sort_order - b.sort_order).map(am => am.material_id)
    materialPicker = initMaterialPicker(document.getElementById('f_materials'), materials, originalMaterialIds)
    document.getElementById('f_metal').value = currentArticle.metal_id || ''
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

  const btnDelete = document.getElementById('btnDelete')
  if (isAdmin) btnDelete.style.display = ''
  btnDelete.addEventListener('click', async () => {
    const msg = `ATTENZIONE: stai per eliminare definitivamente l'articolo "${currentArticle.name}" (${currentArticle.sku}).\n\n` +
      'Si perderà anche tutto ciò che lo riguarda: foto, materiali e movimenti di magazzino. ' +
      "L'operazione non si può annullare.\n\nVuoi procedere?"
    if (!confirm(msg)) return

    btnDelete.disabled = true
    try {
      await deleteArticle(articleId)
      showToast('Articolo eliminato')
      setTimeout(() => {
        window.location.href = '/catalog.html'
      }, 1000)
    } catch (err) {
      console.error(err)
      showToast("Errore durante l'eliminazione: " + err.message)
      btnDelete.disabled = false
    }
  })

  document.getElementById('btnSave').addEventListener('click', async () => {
    // Validazione base — materiale, metallo e prezzo servono a generate_sku solo per gli SKU dell'app
    const appSku = isAppSku(currentArticle.sku)
    const materialIds = materialPicker.getIds()
    if (!document.getElementById('f_collection').value) return showToast('Seleziona una collezione')
    if (!document.getElementById('f_type').value) return showToast('Seleziona il tipo prodotto')
    if (appSku && !materialIds.length) return showToast('Aggiungi almeno un materiale')
    if (appSku && !document.getElementById('f_metal').value) return showToast('Seleziona il tipo di metallo')
    if (appSku && !document.getElementById('f_price_retail').value) return showToast('Inserisci il prezzo retail')

    const confirmMsg = appSku
      ? 'ATTENZIONE: Stai per sovrascrivere in modo permanente i dati di questo articolo. Il nome a display verrà ricalcolato. Vuoi procedere?'
      : 'ATTENZIONE: Stai per sovrascrivere in modo permanente i dati di questo articolo. Codice e nome originali restano invariati. Vuoi procedere?'
    if (!confirm(confirmMsg)) {
      return
    }

    const btnSave = document.getElementById('btnSave')
    btnSave.textContent = 'Salvataggio...'
    btnSave.disabled = true

    try {
      const collSel = document.getElementById('f_collection')
      const collName = collSel.options[collSel.selectedIndex].text
      const typeSel = document.getElementById('f_type')
      const pTypeName = typeSel.options[typeSel.selectedIndex].text
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

      // SKU dell'app (COLL-MATERIALE-METALLO-NNN): si rigenera se cambiano collezione, primo materiale o metallo
      let sku = currentArticle.sku
      const newColl = document.getElementById('f_collection').value
      const newMetal = document.getElementById('f_metal').value

      if (appSku && (newColl !== currentArticle.collection_id || materialIds[0] !== originalMaterialIds[0] || newMetal !== currentArticle.metal_id)) {
         const { data: newSku, error: skuError } = await supabase.rpc('generate_sku', {
            p_collection_id: newColl,
            p_material_id: materialIds[0],
            p_metal_id: newMetal
         })
         if (skuError) throw skuError
         sku = newSku
      }

      const updates = {
        name: appSku ? dynamicName : currentArticle.name,
        product_type_id: typeSel.value,
        collection_id: newColl,
        metal_id: newMetal || null,
        sku: sku,
        notes: document.getElementById('f_notes').value.trim() || null,
        price_retail: Number(document.getElementById('f_price_retail').value) || null,
        price_wholesale: Number(document.getElementById('f_price_wholesale').value) || null,
        stock_retail: Number(document.getElementById('f_stock').value) || 0,
        stock_wholesale: 0, // Enforce single stock per request
        measurements: Object.keys(measurements).length ? measurements : null
      }

      await updateArticle(articleId, updates)
      await setArticleMaterials(articleId, materialIds)
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
