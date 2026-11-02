// js/utils.js

export function formatPrice(amount, currency = '€') {
  if (!amount) return '—'
  return `${currency} ${Number(amount).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// Importo al centesimo: 240.5 → "240,50 €"
export function formatEuro(amount) {
  return Number(amount).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}

// Importo scritto a mano, all'italiana: "240", "240,50", "240.50", "1.250", "1.250,50" (punto delle migliaia).
// Risponde { ok, value } oppure { ok: false, error }.
export function parseEuro(text) {
  const t = String(text ?? '').replace(/€|\s/g, '')
  let normalized = null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) normalized = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d+([.,]\d{1,2})?$/.test(t)) normalized = t.replace(',', '.')
  if (normalized === null) return { ok: false, error: 'Prezzo non valido: per esempio 120 oppure 120,50.' }
  const value = Number(normalized)
  if (!(value > 0)) return { ok: false, error: 'Il prezzo deve essere maggiore di zero.' }
  return { ok: true, value }
}

// SKU generato dall'app (generate_sku): CODICE-MATERIALE-METALLO-NNN. Una volta assegnato non cambia più (AC-03).
// Gli articoli importati dal sito hanno il codice originale: il loro titolo non segue il nome della collezione.
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

// Prima di togliere un articolo { code, name }: dice cosa succederà, secondo la risposta di retirePreview (CR10).
// Falso se ha ancora giacenza o se si rinuncia.
export function confirmRetire(item, preview) {
  if (preview.action === 'blocked') {
    showToast(`L'articolo ${item.code} ha ancora giacenza (${preview.stock}): scaricala prima di archiviarlo`, 6000)
    return false
  }
  const label = `"${item.name}" (${item.code})`
  return confirm(preview.action === 'delete'
    ? `ATTENZIONE: stai per eliminare definitivamente l'articolo ${label}.\n\n` +
      'Non è mai stato usato: spariscono anche le foto e il codice torna libero. ' +
      "L'operazione non si può annullare.\n\nVuoi procedere?"
    : `Stai per archiviare l'articolo ${label}.\n\n` +
      'Sparisce dalle liste. Restano codice, foto e storico dei movimenti, e si può riattivare da "Archiviati".\n\nVuoi procedere?')
}

// Giacenza di un articolo come la mostrano le pagine dell'inventario (stock e stock_grams da getArticles o
// getRawItems, somma dei movimenti): nell'unità del semilavorato (REQ-U-03), peso al decimo di grammo (REQ-U-08)
export function stockLabel(item) {
  const grams = `${Number(item.stock_grams || 0).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g`
  if (item.unit === 'grammi') return grams
  if (item.unit === 'pezzi_grammi') return `${item.stock || 0} pz · ${grams}`
  return `${item.stock || 0} pz`
}
