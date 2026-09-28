// js/utils.js

export function formatPrice(amount, currency = '€') {
  if (!amount) return '—'
  return `${currency} ${Number(amount).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// SKU generato dall'app (generate_sku): CODICE-MATERIALE-METALLO-NNN.
// Gli articoli importati dal sito hanno il codice originale: SKU e nome non vanno ricalcolati.
export function isAppSku(sku) {
  return /^[A-Z0-9]{4}-[A-Z]{2,3}-[A-Z]{2,3}-\d{3}$/.test(sku || '')
}

export function getCoverPhoto(photos) {
  if (!photos || photos.length === 0) return null
  const processed = photos.filter(p => p.photo_type === 'processed')
  const cover = processed.find(p => p.is_cover) || processed[0]
  if (cover) return cover.public_url
  const raw = photos.find(p => p.is_cover && p.photo_type === 'raw') || photos[0]
  return raw?.public_url || null
}

export function showToast(message, duration = 3000) {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.classList.add('visible')
  setTimeout(() => el.classList.remove('visible'), duration)
}

export function debounce(fn, delay = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function buildSkuPreview(collectionSlug, materialCode, metalCode) {
  const collMap = {
    'intreccio': 'INTR',
    'abbraccio': 'ABBR',
    'trame-di-corallo': 'TRAM',
    'cielo-stellato': 'CIEL'
  }
  // Come generate_sku: i vecchi slug hanno un codice fisso, gli altri iniziano con il codice della collezione
  const coll = collMap[collectionSlug] || collectionSlug?.slice(0, 4).toUpperCase() || '—'
  const material = materialCode || '—'
  const metal = metalCode || '—'
  return `${coll}-${material}-${metal}-###`
}

// Materiali di un articolo (da getArticles) nell'ordine scelto: [{ id, name, code }]
export function articleMaterials(article) {
  return (article.article_materials || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(am => ({ id: am.material_id, ...am.material }))
}

// ── Collezioni: regole uguali nella finestra "Nuova collezione" e nell'inserimento articolo ──

// Colori del pallino collezione [valore, etichetta]
export const COLLECTION_COLORS = [
  ['#C94030', 'Rosso Corallo'],
  ['#A8331F', 'Rosso Scuro'],
  ['#E8A898', 'Rosa Pastel'],
  ['#D4C4B8', 'Beige / Chiaro'],
  ['#C9A84C', 'Oro'],
  ['#B8B4AE', 'Argento / Grigio'],
  ['#2A2620', 'Ebano / Scuro'],
]

// Codice di 4 lettere della collezione, quello che entra negli SKU dell'app
export function collectionCode(collection) {
  return collection.description_it || (collection.slug ? collection.slug.substring(0, 4).toUpperCase() : '')
}

// null se la collezione va bene, altrimenti il messaggio da mostrare
export function validateCollection({ name, code }, collections, editingId = null) {
  if (!name || !/^[A-Z]{4}$/.test(code)) return 'Nome richiesto e codice di 4 lettere esatte'
  const clash = collections.find(c => c.id !== editingId && collectionCode(c) === code)
  if (clash) return `Il codice ${code} è già usato dalla collezione ${clash.name}`
  return null
}

// Conferma dell'eliminazione definitiva di un articolo: stesso messaggio in anteprima e in modifica
export function confirmDeleteArticle(article) {
  return confirm(`ATTENZIONE: stai per eliminare definitivamente l'articolo "${article.name}" (${article.sku}).\n\n` +
    'Si perderà anche tutto ciò che lo riguarda: foto, materiali e movimenti di magazzino. ' +
    "L'operazione non si può annullare.\n\nVuoi procedere?")
}
