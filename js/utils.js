// js/utils.js

// Un prezzo nel suo campo e negli elenchi: 1250 → "1250", 120.5 → "120,50". Mai il punto delle migliaia
export function priceText(amount) {
  const n = Number(amount)
  return n.toLocaleString('it-IT', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2, useGrouping: false })
}

export function formatPrice(amount, currency = '€') {
  if (!amount) return '—'
  return `${currency} ${priceText(amount)}`
}

// Importo al centesimo: 240.5 → "240,50 €". Mai il punto delle migliaia
export function formatEuro(amount) {
  return Number(amount).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: false })
}

// Importo scritto a mano: "240", "240,50", "240.50". Il punto vale come la virgola e non separa mai le migliaia:
// "1.250" si rifiuta, non diventa né 1250 né 1,25 (decisione di Matteo, 08/11/2026). Al centesimo e sotto i 100
// milioni, come numeric(10,2) nel database. Risponde { ok, value } oppure { ok: false, error }.
export function parseEuro(text) {
  const t = String(text ?? '').replace('€', '').trim()
  if ((t.match(/[.,]/g) || []).length > 1) return { ok: false, error: 'Un solo separatore decimale: "1.250,50" non vale, scrivi "1250,50".' }
  if (/[.,]\d{3,}$/.test(t)) return { ok: false, error: 'Al massimo 2 decimali, e il punto non separa le migliaia: per 1250 € scrivi "1250".' }
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return { ok: false, error: 'Scrivi un importo, per esempio 120 oppure 120,50.' }
  const value = Number(t.replace(',', '.'))
  if (!(value > 0)) return { ok: false, error: 'Il prezzo deve essere maggiore di zero.' }
  if (value >= 1e8) return { ok: false, error: 'Prezzo troppo alto: al massimo 99999999,99.' }
  return { ok: true, value }
}

// Un campo di prezzo al salvataggio: vuoto vale null. { value } oppure { error, element }
export function readPrice(element, label) {
  if (!element.value.trim()) return { value: null }
  const parsed = parseEuro(element.value)
  return parsed.ok ? { value: parsed.value } : { error: `${label}: ${parsed.error}`, element }
}

// La copertina: il database ne garantisce una per articolo (039). Senza, la prima nell'ordine
export function getCoverPhoto(photos) {
  if (!photos?.length) return null
  const cover = photos.find(p => p.is_cover) || [...photos].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
  return cover?.public_url || null
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

const materialRows = article => (article.article_materials || []).slice().sort((a, b) => a.sort_order - b.sort_order)

// Materiali di un articolo (da getArticles) nell'ordine scelto, ognuno una volta sola anche se sta su più righe: [{ id, name, code }]
export function articleMaterials(article) {
  const seen = new Set()
  return materialRows(article)
    .filter(am => !seen.has(am.material_id) && seen.add(am.material_id))
    .map(am => ({ id: am.material_id, ...am.material }))
}

// ── Composizione: numeri con la virgola, con le regole del database (035, CO-01) ──

// "0,03" o "0.03": maggiore di zero, sotto max, con al massimo decimals decimali. Vuoto vale null. { ok, value } oppure { ok: false }
export function parseDecimal(text, decimals, max) {
  const t = String(text ?? '').trim()
  if (!t) return { ok: true, value: null }
  if (!new RegExp(`^\\d+${decimals ? `([.,]\\d{1,${decimals}})?` : ''}$`).test(t)) return { ok: false }
  const value = Number(t.replace(',', '.'))
  return value > 0 && value < max ? { ok: true, value } : { ok: false }
}

// Misura in cm scritta a mano: al decimo, come la lunghezza dei semilavorati (numeric(6,1)). Vuoto vale null.
// { ok, value } oppure { ok: false, error }
export function parseCm(text) {
  const parsed = parseDecimal(text, 1, 100000)
  return parsed.ok ? parsed : { ok: false, error: 'scrivi un numero maggiore di zero, con al massimo un decimale: per esempio 2,5. Il punto non separa le migliaia.' }
}

// Misura in mm scritta a mano: fino a 2 decimali e sotto i 10000, come numeric(6,2) nel database. Vuoto vale null.
// { ok, value } oppure { ok: false, error }
export function parseMm(text) {
  const parsed = parseDecimal(text, 2, 10000)
  return parsed.ok ? parsed : { ok: false, error: 'Scrivi un numero maggiore di zero, con al massimo 2 decimali: per esempio 7,5. Il punto non separa le migliaia.' }
}

// Un campo in cm al salvataggio. { value } oppure { error, element }
export function readCm(element, label) {
  const parsed = parseCm(element.value)
  return parsed.ok ? { value: parsed.value } : { error: `${label}: ${parsed.error}`, element }
}

// 0.035 → "0,035"; vuoto se non c'è
export function formatDecimal(value) {
  return value == null ? '' : Number(value).toLocaleString('it-IT', { maximumFractionDigits: 3, useGrouping: false })
}

// Valori di una riga dei materiali: "5 pz, ct 0,03", "mm 15 × 20, 0,6 g", "da mm 3 a 5"
function materialValues({ pieces, carats, size_mm: size, size2_mm: size2, size_mode: mode, grams }) {
  const n = formatDecimal
  const sizeText = size == null ? null
    : mode === 'to' ? `da mm ${n(size)} a ${n(size2)}`
    : mode === 'by' ? `mm ${n(size)} × ${n(size2)}`
    : `mm ${n(size)}`
  return [
    pieces != null && `${n(pieces)} pz`,
    carats != null && `ct ${n(carats)}`,
    sizeText,
    grams != null && `${n(grams)} g`,
  ].filter(Boolean).join(', ')
}

// Una riga per materiale, come nel pannello del catalogo: "Diamante: 5 pz, ct 0,03" (CO-09)
export function articleMaterialLines(article) {
  return materialRows(article).map(am => [am.material?.name, materialValues(am)].filter(Boolean).join(': '))
}

// Il metallo con il suo peso: "Oro Giallo 18k: 1,7 g"
export function articleMetalLine(article) {
  if (!article.metal?.name) return ''
  return article.metal_grams == null ? article.metal.name : `${article.metal.name}: ${formatDecimal(article.metal_grams)} g`
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

// null se la collezione va bene, altrimenti il messaggio da mostrare. Il codice è quello della linea di STEP (AC-10).
export function validateCollection({ name, code }, collections, editingId = null) {
  if (!name || !/^[A-Z0-9]{3}$/.test(code)) return 'Nome richiesto e codice di 3 caratteri esatti, lettere o cifre'
  if (code === 'ZZZ') return 'ZZZ è riservato ai vuoti del codice: scegline un altro'
  const clash = collections.find(c => c.id !== editingId && c.code === code)
  if (clash) return `Il codice ${code} è già usato dalla collezione ${clash.name}`
  return null
}

// ── Anagrafiche: regole uguali a quelle del database (033, 036, AN-04, AN-09) ──

// Lettera di un tipo, materiale o metallo: uno o due caratteri, Z è riservata ai vuoti del codice
export const isCodeLetter = v => /^[A-Y0-9]{1,2}$/.test(v)
// Lettera del colore: nel codice c'è posto per un carattere
export const isColorLetter = v => /^[A-Y0-9]$/.test(v)

// null se la voce va bene, altrimenti il messaggio. others: le altre voci dello stesso elenco;
// positions: { position: nome } di metalli e materiali, che hanno un'unica numerazione.
export function validateAnagrafica({ name, letter, hasColor, colorLetter, code, position }, { others, positions = {}, needsCode = false }) {
  if (!name) return 'Il nome è obbligatorio'
  const sameName = others.find(o => o.name.toLowerCase() === name.toLowerCase())
  if (sameName) return `Esiste già: ${sameName.name}`
  if (letter && !isCodeLetter(letter)) return 'La lettera è di uno o due caratteri, lettere o cifre, senza Z'
  if (hasColor && !colorLetter) return 'Scrivi la lettera del colore, o togli la casella'
  if (colorLetter && !isColorLetter(colorLetter)) return 'La lettera del colore è un carattere solo, lettera o cifra, diverso da Z'
  if (needsCode) {
    if (!/^[A-Z]{2,3}$/.test(code)) return 'La sigla ha 2 o 3 lettere: la usano gli import'
    const sameCode = others.find(o => o.code === code)
    if (sameCode) return `La sigla ${code} è già usata da ${sameCode.name}`
    if (position && !(Number.isInteger(Number(position)) && Number(position) > 0)) return 'La posizione è un numero intero maggiore di zero'
    if (position && positions[Number(position)]) return `La posizione ${position} è già usata da ${positions[Number(position)]}`
  }
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

// 12500.5 → "12500,5 g": al decimo di grammo, con la virgola e mai il punto delle migliaia (REQ-U-05, U-08)
export function gramsText(grams) {
  return `${Number(grams).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} g`
}

// Giacenza di un articolo come la mostrano le pagine dell'inventario (stock e stock_grams da getArticles o
// getRawItems, somma dei movimenti): nell'unità del semilavorato (REQ-U-03), peso al decimo di grammo (REQ-U-08)
export function stockLabel(item) {
  const grams = gramsText(item.stock_grams || 0)
  if (item.unit === 'grammi') return grams
  if (item.unit === 'pezzi_grammi') return `${item.stock || 0} pz · ${grams}`
  return `${item.stock || 0} pz`
}
