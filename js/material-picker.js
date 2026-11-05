// js/material-picker.js — Materiali di un articolo: una riga per materiale, con i campi di quel materiale (035, CO-05).
// Quali campi ha ogni voce si sceglie in Anagrafiche. Una casella tolta non nasconde ciò che è già scritto (CO-06).
import { parseDecimal, formatDecimal } from './utils.js'

// Regole uguali a quelle del database (035, CO-01)
const FIELDS = [
  { key: 'pieces',  flag: 'has_pieces', label: 'Numero (pz)', decimals: 0, max: 1000000, hint: 'un intero maggiore di zero, per esempio 5' },
  { key: 'carats',  flag: 'has_carats', label: 'Carati (ct)', decimals: 3, max: 1000, hint: 'fino a 3 decimali, per esempio 0,03' },
  { key: 'size_mm', flag: 'has_size',   label: 'Misura (mm)', decimals: 2, max: 1000, hint: 'fino a 2 decimali, per esempio 4,5' },
  { key: 'grams',   flag: 'has_grams',  label: 'Peso (g)',    decimals: 2, max: 100000, hint: 'fino a 2 decimali, per esempio 0,6' },
]
const SECOND_SIZE = { key: 'size2_mm', label: 'Seconda misura', decimals: 2, max: 1000, hint: 'fino a 2 decimali, per esempio 20' }
const METAL_WEIGHT = { decimals: 2, max: 100000 }

const numberInput = ({ key, decimals }, extra = '') =>
  `<input type="text" class="field-input" inputmode="${decimals ? 'decimal' : 'numeric'}" autocomplete="off" data-key="${key}" ${extra}>`

function fieldHtml(f) {
  if (f.key !== 'size_mm') {
    return `<div class="material-field" data-field="${f.key}">
      <span class="field-label">${f.label}</span>
      ${numberInput(f, `aria-label="${f.label}"`)}
    </div>`
  }
  return `<div class="material-field material-field-size" data-field="${f.key}">
    <span class="field-label">${f.label}</span>
    <div class="material-size">
      ${numberInput(f, `aria-label="${f.label}"`)}
      <select class="field-select" data-key="size_mode" aria-label="Seconda misura: nessuna, per oppure fino a">
        <option value="">—</option>
        <option value="by">×</option>
        <option value="to">fino a</option>
      </select>
      ${numberInput(SECOND_SIZE, `aria-label="${SECOND_SIZE.label} (mm)"`)}
    </div>
  </div>`
}

// rows: [{ id, material_id, pieces, carats, size_mm, size2_mm, size_mode, grams }]
export function initMaterialPicker(container, materials, rows = [], onChange = () => {}) {
  container.classList.add('material-picker')
  container.innerHTML = `
    <div class="material-list"></div>
    <button type="button" class="btn-ghost material-add">+ Aggiungi materiale</button>`
  const list = container.querySelector('.material-list')

  const selects = () => [...list.querySelectorAll('.material-select')]

  function addRow(data = {}) {
    const row = document.createElement('div')
    row.className = 'material-row'
    if (data.id) row.dataset.id = data.id
    row.innerHTML = `
      <div class="material-row-main">
        <select class="field-select material-select" aria-label="Materiale">
          <option value="">Seleziona…</option>
        </select>
        <button type="button" class="material-remove" aria-label="Rimuovi materiale" title="Rimuovi">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="material-fields" hidden>${FIELDS.map(fieldHtml).join('')}</div>`

    const sel = row.querySelector('.material-select')
    for (const m of materials) {
      sel.add(new Option(m.name, m.id))
    }
    sel.value = data.material_id || ''

    const input = key => row.querySelector(`[data-key="${key}"]`)
    const mode = input('size_mode')
    const clear = () => row.querySelectorAll('[data-key]').forEach(el => { el.value = '' })

    // Si vede ciò che il materiale prevede, più ciò che è già scritto. La seconda misura, solo se si è scelto × o "fino a"
    function showFields() {
      const material = materials.find(m => m.id === sel.value)
      let any = false
      for (const f of FIELDS) {
        const box = row.querySelector(`[data-field="${f.key}"]`)
        const written = [...box.querySelectorAll('[data-key]')].some(el => el.value)
        box.hidden = !(material?.[f.flag] || written)
        any ||= !box.hidden
      }
      row.querySelector('.material-fields').hidden = !any
      input('size2_mm').hidden = !mode.value
    }

    for (const f of [...FIELDS, SECOND_SIZE]) input(f.key).value = formatDecimal(data[f.key])
    mode.value = data.size_mode || ''
    showFields()

    // I valori erano del materiale di prima: cambiando il menu si riparte da vuoto
    sel.addEventListener('change', () => {
      clear()
      showFields()
      onChange()
    })
    mode.addEventListener('change', () => {
      if (!mode.value) input('size2_mm').value = ''
      showFields()
      if (mode.value) input('size2_mm').focus()
    })
    row.querySelector('.material-remove').addEventListener('click', () => {
      // Resta sempre almeno una riga: sull'ultima la X svuota la scelta
      if (selects().length > 1) row.remove()
      else {
        sel.value = ''
        clear()
        showFields()
      }
      onChange()
    })
    list.appendChild(row)
    return sel
  }

  // Controlla una riga e la risponde con i suoi numeri, oppure dice cosa non va
  function readRow(row, sel) {
    const name = sel.selectedOptions[0].text
    const input = key => row.querySelector(`[data-key="${key}"]`)
    const out = { material_id: sel.value }
    if (row.dataset.id) out.id = row.dataset.id
    for (const f of [...FIELDS, SECOND_SIZE]) {
      const parsed = parseDecimal(input(f.key).value, f.decimals, f.max)
      if (!parsed.ok) return { error: `${name}: ${f.label} non valida, scrivi ${f.hint}`, element: input(f.key) }
      out[f.key] = parsed.value
    }
    out.size_mode = input('size_mode').value || null
    if (out.size_mode && out.size2_mm == null) return { error: `${name}: scrivi la seconda misura, o togli "${input('size_mode').selectedOptions[0].text}"`, element: input('size2_mm') }
    if (out.size_mode && out.size_mm == null) return { error: `${name}: scrivi anche la prima misura`, element: input('size_mm') }
    if (out.size_mode === 'to' && out.size2_mm <= out.size_mm) return { error: `${name}: "fino a" deve essere più grande della prima misura`, element: input('size2_mm') }
    return { row: out }
  }

  for (const data of rows) addRow(data)
  if (!rows.length) addRow()
  container.querySelector('.material-add').addEventListener('click', () => {
    addRow().focus()
    onChange()
  })
  onChange()

  return {
    // Id scelti, nell'ordine delle righe
    getIds: () => selects().map(s => s.value).filter(Boolean),
    // Righe da salvare, nell'ordine: { rows } oppure { error, element } se un valore non va
    read() {
      const out = []
      for (const sel of selects()) {
        if (!sel.value) continue
        const result = readRow(sel.closest('.material-row'), sel)
        if (result.error) return result
        out.push(result.row)
      }
      return { rows: out }
    }
  }
}

// Peso del metallo, accanto al menu Metallo: compare se il metallo ha il peso attivo o se è già scritto (CO-03, CO-06).
// Cambiando metallo si svuota: era il peso di quello di prima.
export function initMetalWeight({ select, field, input, metals, value = null }) {
  const show = () => {
    field.hidden = !(metals.find(m => m.id === select.value)?.has_weight || input.value)
  }
  input.value = formatDecimal(value)
  show()
  select.addEventListener('change', () => {
    input.value = ''
    show()
  })
  return {
    // { value } oppure { error, element }
    read() {
      const parsed = parseDecimal(input.value, METAL_WEIGHT.decimals, METAL_WEIGHT.max)
      return parsed.ok ? { value: parsed.value } : { error: 'Peso del metallo non valido: fino a 2 decimali, per esempio 1,7', element: input }
    }
  }
}
