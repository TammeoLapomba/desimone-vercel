// js/utils.js

export function formatPrice(amount, currency = '€') {
  if (!amount) return '—'
  return `${currency} ${Number(amount).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function statusLabel(status) {
  const map = { draft: 'Bozza', processing: 'Processing', ready: 'Pronto', published: 'Pubblicato' }
  return map[status] || status
}

export function statusClass(status) {
  return `status-${status}`
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

export function buildSkuPreview(collectionSlug, coralCode, metalCode) {
  const collMap = {
    'intreccio': 'INTR',
    'abbraccio': 'ABBR',
    'trame-di-corallo': 'TRAM',
    'cielo-stellato': 'CIEL'
  }
  const coll = collMap[collectionSlug] || '—'
  const coral = coralCode || '—'
  const metal = metalCode || '—'
  return `${coll}-${coral}-${metal}-###`
}
