// js/clienti.js — Campi di cliente e sede, comuni alle pagine Vendite e Cliente (scheda 4.1)
//
// Le regole stanno nel database (048): qui solo i campi, i suggerimenti e i messaggi prima di inviare.

export const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CUSTOMER_FIELDS = [
  ['name', 'Ragione sociale', { required: true, max: 160, full: true }],
  ['vat_number', 'Partita IVA', { required: true, max: 20, hint: 'Per un cliente in Italia 11 cifre. Per l\'estero come la scrive il cliente, per esempio FR12345678901' }],
  ['tax_code', 'Codice fiscale', { max: 16, upper: true }],
  ['contact_name', 'Referente', { max: 80 }],
  ['phone', 'Telefono', { max: 40, mode: 'tel' }],
  ['email', 'Email', { max: 160, mode: 'email', full: true }],
  ['notes', 'Note', { max: 500, full: true, area: true }],
]

const SITE_FIELDS = [
  ['name', 'Nome della sede', { required: true, max: 80, full: true, placeholder: 'es. Negozio di Roma' }],
  ['address', 'Indirizzo', { required: true, max: 160, full: true }],
  ['postal_code', 'CAP', { max: 10, mode: 'numeric', italy: true }],
  ['city', 'Città', { required: true, max: 80 }],
  ['province', 'Provincia', { max: 2, upper: true, italy: true }],
  ['country', 'Paese', { required: true, max: 60 }],
  ['notes', 'Note per la consegna', { max: 500, full: true, area: true }],
]

function fieldHtml(prefix, [key, label, o]) {
  const id = `${prefix}_${key}`
  const attrs = `class="field-input" id="${id}" maxlength="${o.max}" autocomplete="off"${o.mode ? ` inputmode="${o.mode}"` : ''}${o.upper ? ' style="text-transform:uppercase;"' : ''}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}`
  const star = o.required ? ' <span class="field-required">*</span>' : o.italy ? ' <span class="field-required" title="Obbligatorio per l\'Italia">*</span>' : ''
  return `<div class="form-field${o.full ? ' cli-full' : ''}">
    <label class="field-label" for="${id}">${label}${star}</label>
    ${o.area ? `<textarea ${attrs} rows="2"></textarea>` : `<input type="text" ${attrs}>`}
    ${o.hint ? `<span class="field-hint">${esc(o.hint)}</span>` : ''}
  </div>`
}

export const customerFieldsHtml = prefix => `<div class="cli-grid">${CUSTOMER_FIELDS.map(f => fieldHtml(prefix, f)).join('')}</div>`
export const siteFieldsHtml = prefix => `<div class="cli-grid">${SITE_FIELDS.map(f => fieldHtml(prefix, f)).join('')}</div>
  <p class="field-hint">Per l'Italia servono CAP e provincia. Per un altro paese bastano indirizzo e città.</p>`

const read = (fields, prefix) => Object.fromEntries(fields.map(([key]) => [key, document.getElementById(`${prefix}_${key}`).value.trim()]))
const fill = (fields, prefix, row) => fields.forEach(([key]) => {
  document.getElementById(`${prefix}_${key}`).value = row?.[key] ?? (key === 'country' ? 'Italia' : '')
})

export const readCustomer = prefix => read(CUSTOMER_FIELDS, prefix)
export const readSite = prefix => read(SITE_FIELDS, prefix)
export const fillCustomer = (prefix, row) => fill(CUSTOMER_FIELDS, prefix, row)
export const fillSite = (prefix, row) => fill(SITE_FIELDS, prefix, row)

const isItaly = country => ['italia', 'italy', 'it'].includes(String(country).trim().toLowerCase())

// I controlli che si vedono subito; il database ripete tutto
export function customerProblem(c) {
  if (!c.name) return 'Scrivi la ragione sociale'
  if (!c.vat_number) return 'Scrivi la partita IVA'
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return 'Email non valida'
  return ''
}

export function siteProblem(s) {
  if (!s.name) return 'Scrivi il nome della sede'
  if (!s.address || !s.city) return 'Scrivi indirizzo e città della sede'
  if (!s.country) return 'Scrivi il paese'
  if (isItaly(s.country)) {
    if (!/^[0-9]{5}$/.test(s.postal_code.replace(/\s/g, ''))) return 'Il CAP ha 5 cifre'
    if (!/^[A-Za-z]{2}$/.test(s.province)) return 'La provincia ha 2 lettere, per esempio NA'
  }
  return ''
}

// Una riga di indirizzo: "Via Roma 1, 80100 Napoli (NA)" oppure "Rue de Rivoli 10, Paris, Francia"
export function siteAddress(s) {
  const place = [s.postal_code, s.city].filter(Boolean).join(' ') + (s.province ? ` (${s.province})` : '')
  return [s.address, place, s.country && s.country !== 'Italia' ? s.country : ''].filter(Boolean).join(', ')
}

export const legalSite = customer => (customer.customer_sites || []).find(s => s.is_legal)
