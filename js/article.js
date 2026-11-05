// js/article.js
import { requireAuth, getMyRole, getCollections, getMaterials, getMetals, getProductTypes, getArticleById, getItemStock, updateArticle, setArticleMaterials, retirePreview, retireItem, signOut } from './supabase.js'
import { showToast, confirmRetire } from './utils.js'
import { initMaterialPicker, initMetalWeight } from './material-picker.js'

window.signOutUser = signOut

let articleId = null
let currentArticle = null
let collections = []
let materialPicker = null
let metalWeight = null
let isAdmin = false
let backToMovements = false

// Dalla schermata di controllo si torna al carico, con il codice di adesso (CR11)
function leave(code) {
  window.location.href = backToMovements
    ? `/movimenti.html?codice=${encodeURIComponent(code)}&bozza=1`
    : '/catalog.html'
}

// Provvisorio o definitivo, accanto al codice (decisione 10)
function renderCodeStatus() {
  const provisional = !currentArticle.code_confirmed_at
  document.getElementById('headerCodeTag').hidden = !provisional
  document.getElementById('codeStatus').textContent = provisional
    ? 'Codice provvisorio: segue i dati fino al primo carico.'
    : 'Codice definitivo: non cambia più.'
}

async function init() {
  await requireAuth()
  // Solo l'admin può archiviare o eliminare (lo impone anche il database)
  isAdmin = (await getMyRole()) === 'admin'

  const params = new URLSearchParams(window.location.search)
  articleId = params.get('id')
  backToMovements = params.get('torna') === 'movimenti'
  if (!articleId) {
    window.location.href = '/catalog.html'
    return
  }

  try {
    // Carica articolo
    currentArticle = await getArticleById(articleId)
    if (!currentArticle) throw new Error('Articolo non trovato')

    // Carica dipendenze, con le voci archiviate che questo articolo usa già (AN-08)
    const [productTypes, materials, metals] = await Promise.all([
      getProductTypes([currentArticle.product_type_id]),
      getMaterials((currentArticle.article_materials || []).map(am => am.material_id)),
      getMetals(currentArticle.metal_id ? [currentArticle.metal_id] : [])
    ])
    collections = await getCollections()

    populateSelect('f_collection', collections, 'id', 'name', 'Seleziona collezione…')
    populateSelect('f_type', productTypes, 'id', 'name', 'Seleziona…')
    populateSelect('f_metal', metals, 'id', 'name', 'Nessuno')

    document.getElementById('headerName').textContent = currentArticle.name
    document.getElementById('f_title').value = currentArticle.name
    document.getElementById('headerSku').textContent = currentArticle.sku

    // Popola campi form
    document.getElementById('f_collection').value = currentArticle.collection_id
    document.getElementById('f_type').value = currentArticle.product_type_id
    document.getElementById('f_sku').value = currentArticle.sku
    renderCodeStatus()
    document.getElementById('f_notes').value = currentArticle.notes || ''
    
    const articleRows = (currentArticle.article_materials || []).slice().sort((a, b) => a.sort_order - b.sort_order)
    materialPicker = initMaterialPicker(document.getElementById('f_materials'), materials, articleRows)
    document.getElementById('f_metal').value = currentArticle.metal_id || ''
    metalWeight = initMetalWeight({
      select: document.getElementById('f_metal'),
      field: document.getElementById('f_metal_grams_field'),
      input: document.getElementById('f_metal_grams'),
      metals,
      value: currentArticle.metal_grams
    })
    document.getElementById('f_price_retail').value = currentArticle.price_retail || ''
    document.getElementById('f_price_wholesale').value = currentArticle.price_wholesale || ''

    // Giacenza: somma dei movimenti in tutti i luoghi (REQ-001.1, C-01), si cambia solo dalla schermata Movimenti
    getItemStock({ articleId }).then(rows => {
      document.getElementById('f_stock').value = `${rows.reduce((n, r) => n + r.pieces, 0)} pz`
    }).catch(() => { document.getElementById('f_stock').value = '—' })
    if (currentArticle.sku) document.getElementById('f_stock_link').href = `/movimenti.html?codice=${encodeURIComponent(currentArticle.sku)}`
    
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
  document.getElementById('btnCancel').addEventListener('click', () => leave(currentArticle.sku))

  // Mai usato: si elimina. Altrimenti si archivia (CR10): il pulsante dice quale delle due
  const btnDelete = document.getElementById('btnDelete')
  if (isAdmin) {
    btnDelete.style.display = ''
    retirePreview({ articleId }).then(p => {
      const label = p.action === 'delete' ? 'Elimina articolo' : 'Archivia articolo'
      document.getElementById('btnDeleteLabel').textContent = label
      btnDelete.setAttribute('aria-label', label)
    }).catch(console.error)
  }
  btnDelete.addEventListener('click', async () => {
    btnDelete.disabled = true
    try {
      if (!confirmRetire({ code: currentArticle.sku, name: currentArticle.name }, await retirePreview({ articleId }))) {
        btnDelete.disabled = false
        return
      }
      const action = await retireItem({ articleId })
      showToast(action === 'deleted' ? 'Articolo eliminato' : 'Articolo archiviato')
      setTimeout(() => {
        window.location.href = '/catalog.html'
      }, 1000)
    } catch (err) {
      console.error(err)
      showToast(err.message, 6000)
      btnDelete.disabled = false
    }
  })

  document.getElementById('btnSave').addEventListener('click', async () => {
    // Validazione base — materiale e prezzo restano obbligatori per gli articoli creati dall'app, come all'inserimento
    const fromApp = currentArticle.code_origin === 'app'
    const materialIds = materialPicker.getIds()
    const title = document.getElementById('f_title').value.trim()
    if (!title) return showToast("Inserisci il titolo dell'articolo")
    if (!document.getElementById('f_collection').value) return showToast('Seleziona una collezione')
    if (!document.getElementById('f_type').value) return showToast('Seleziona il tipo prodotto')
    if (fromApp && !materialIds.length) return showToast('Aggiungi almeno un materiale')
    if (fromApp && !document.getElementById('f_price_retail').value) return showToast('Inserisci il prezzo retail')
    // Il peso del modello serve a ogni movimento (028): obbligatorio per tutti, anche per gli articoli del sito
    if (!(Number(document.getElementById('f_weight').value) > 0)) return showToast('Inserisci il peso di un pezzo (g)')
    const materialCheck = materialPicker.read()
    const metalCheck = metalWeight.read()
    for (const check of [materialCheck, metalCheck]) {
      if (check.error) {
        showToast(check.error, 5000)
        check.element.focus()
        return
      }
    }

    const codeNote = currentArticle.code_confirmed_at ? 'Il codice resta invariato.' : 'Il codice provvisorio segue i dati.'
    if (!confirm(`ATTENZIONE: Stai per sovrascrivere in modo permanente i dati di questo articolo. ${codeNote} Vuoi procedere?`)) {
      return
    }

    const btnSave = document.getElementById('btnSave')
    btnSave.textContent = 'Salvataggio...'
    btnSave.disabled = true

    try {
      const typeSel = document.getElementById('f_type')
      const metalId = document.getElementById('f_metal').value || null
      const l = document.getElementById('f_length').value

      const measurements = {}
      const w = document.getElementById('f_width').value
      const h = document.getElementById('f_height').value
      const wt = document.getElementById('f_weight').value
      if (w) measurements.width_cm = Number(w)
      if (l) measurements.length_cm = Number(l)
      if (h) measurements.height_cm = Number(h)
      if (wt) measurements.weight_g = Number(wt)

      // Il codice non è tra i campi: lo tiene il database. Provvisorio segue i dati, definitivo non cambia più (AC-03)
      const updates = {
        name: title,
        product_type_id: typeSel.value,
        collection_id: document.getElementById('f_collection').value,
        metal_id: metalId,
        metal_grams: metalCheck.value,
        notes: document.getElementById('f_notes').value.trim() || null,
        price_retail: Number(document.getElementById('f_price_retail').value) || null,
        price_wholesale: Number(document.getElementById('f_price_wholesale').value) || null,
        measurements: Object.keys(measurements).length ? measurements : null
      }

      // Il testo di STEP parlava del metallo di prima (CO-10)
      if (metalId !== currentArticle.metal_id) updates.metal_step_text = null

      await updateArticle(articleId, updates)
      await setArticleMaterials(articleId, materialCheck.rows)
      const saved = await getArticleById(articleId)
      showToast(saved.sku === currentArticle.sku ? 'Articolo aggiornato con successo!' : `Articolo aggiornato. Il codice ora è ${saved.sku}`)

      setTimeout(() => leave(saved.sku), saved.sku === currentArticle.sku ? 1000 : 2000)

    } catch (err) {
      console.error(err)
      showToast('Errore durante il salvataggio: ' + err.message)
      btnSave.textContent = 'Salva Modifiche'
      btnSave.disabled = false
    }
  })
}

init().catch(console.error)
