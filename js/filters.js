// js/filters.js — Ricerca e filtri per campo sopra l'elenco (Montato e Semilavorato)
// Sul modello della barra filtri dell'inventario di maat: ricerca, tasto "Filtri"
// che apre i campi, e i filtri attivi come etichette rimovibili.
//
// Ogni campo è una tendina:  { key, label, all?, options(items) → [[valore, etichetta]], test(item, valore) }
// oppure un intervallo:      { key, label, range: true, unit, value(item) → numero }
import { debounce } from './utils.js'

const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const formatNum = n => n.toLocaleString('it-IT')

export function initFilters({ fields, text, onChange }) {
  const search = document.getElementById('searchInput')
  const toggle = document.getElementById('btnFilters')
  const box = document.getElementById('filterFields')
  const chipsBox = document.getElementById('filterChips')
  const badge = toggle.querySelector('.filter-count')
  const byId = id => document.getElementById(id)
  let chipActions = []

  box.innerHTML = fields.map(f => f.range ? `
    <div class="filter-field filter-range" role="group" aria-labelledby="flt_${f.key}_label">
      <span class="filter-label" id="flt_${f.key}_label">${f.label}${f.unit ? ` (${f.unit})` : ''}</span>
      <input type="number" class="field-input" id="flt_${f.key}_min" min="0" inputmode="decimal" placeholder="da" aria-label="${f.label} da">
      <span class="filter-range-sep" aria-hidden="true">–</span>
      <input type="number" class="field-input" id="flt_${f.key}_max" min="0" inputmode="decimal" placeholder="a" aria-label="${f.label} fino a">
    </div>` : `
    <div class="filter-field">
      <label class="filter-label" for="flt_${f.key}">${f.label}</label>
      <select class="field-input field-select" id="flt_${f.key}"><option value="">${f.all || 'Tutti'}</option></select>
    </div>`).join('')

  const num = el => (el.value.trim() === '' || Number.isNaN(Number(el.value)) ? null : Number(el.value))

  // Filtri attivi, letti dai campi
  function active() {
    return fields.map(f => {
      if (f.range) {
        const min = num(byId(`flt_${f.key}_min`)), max = num(byId(`flt_${f.key}_max`))
        return min === null && max === null ? null : { f, min, max }
      }
      const sel = byId(`flt_${f.key}`)
      return sel.value ? { f, value: sel.value, text: sel.selectedOptions[0]?.textContent || sel.value } : null
    }).filter(Boolean)
  }

  function passes(c, item) {
    if (!c.f.range) return c.f.test(item, c.value)
    const v = c.f.value(item)
    if (v === null || v === undefined) return false
    return (c.min === null || v >= c.min) && (c.max === null || v <= c.max)
  }

  function chipLabel(c) {
    if (!c.f.range) return `${c.f.label} · ${c.text}`
    const u = c.f.unit ? ` ${c.f.unit}` : ''
    if (c.min !== null && c.max !== null) return `${c.f.label} · ${formatNum(c.min)}–${formatNum(c.max)}${u}`
    return c.min !== null ? `${c.f.label} · da ${formatNum(c.min)}${u}` : `${c.f.label} · fino a ${formatNum(c.max)}${u}`
  }

  function clearField(f) {
    if (f.range) {
      byId(`flt_${f.key}_min`).value = ''
      byId(`flt_${f.key}_max`).value = ''
    } else {
      byId(`flt_${f.key}`).value = ''
    }
  }

  function renderChips() {
    const act = active()
    const q = search.value.trim()
    badge.textContent = act.length
    badge.hidden = !act.length
    toggle.setAttribute('aria-label', act.length ? `Filtri, ${act.length} ${act.length === 1 ? 'attivo' : 'attivi'}` : 'Filtri')

    chipActions = []
    if (q) chipActions.push({ label: `“${q}”`, clear: () => { search.value = '' } })
    act.forEach(c => chipActions.push({ label: chipLabel(c), clear: () => clearField(c.f) }))
    chipsBox.hidden = !chipActions.length
    chipsBox.innerHTML = chipActions.map((c, i) => `
      <button type="button" class="filter-chip" data-chip="${i}" aria-label="Rimuovi ${esc(c.label)}">${esc(c.label)}${ICON_X}</button>`).join('') +
      (chipActions.length ? '<button type="button" class="filter-reset" data-chip="all">Azzera tutto</button>' : '')
  }

  function update() {
    renderChips()
    onChange()
  }

  function reset() {
    search.value = ''
    fields.forEach(clearField)
    update()
  }

  search.addEventListener('input', debounce(update))
  box.addEventListener('change', e => { if (e.target.matches('select')) update() })
  box.addEventListener('input', debounce(e => { if (e.target.matches('input')) update() }))

  toggle.addEventListener('click', () => {
    const open = box.hidden
    box.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    if (open) box.querySelector('select, input')?.focus()
  })

  chipsBox.addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]')
    if (!chip) return
    if (chip.dataset.chip === 'all') {
      reset()
      return search.focus()
    }
    const i = Number(chip.dataset.chip)
    chipActions[i]?.clear()
    update()
    // Il focus passa all'etichetta successiva (o alla precedente), o alla ricerca se non ne restano
    ;(chipsBox.querySelector(`[data-chip="${i}"]`) || chipsBox.querySelector(`[data-chip="${i - 1}"]`) || search).focus()
  })

  return {
    // Elementi che passano ricerca e filtri
    apply(items) {
      const q = search.value.toLowerCase().trim()
      const act = active()
      return items.filter(item =>
        (!q || text(item).toLowerCase().includes(q)) && act.every(c => passes(c, item)))
    },
    // Le tendine mostrano solo i valori presenti negli elementi visibili (es. la collezione aperta),
    // più quello già scelto
    refresh(items) {
      for (const f of fields) {
        if (f.range) continue
        const sel = byId(`flt_${f.key}`)
        const cur = sel.value
        const opts = new Map(f.options(items))
        if (cur && !opts.has(cur)) opts.set(cur, sel.selectedOptions[0]?.textContent || cur)
        const html = `<option value="">${f.all || 'Tutti'}</option>` + [...opts]
          .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'it', { numeric: true }))
          .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')
        if (sel.dataset.options !== html) {
          sel.innerHTML = html
          sel.value = cur
          sel.dataset.options = html
        }
      }
    },
    reset,
    isActive: () => !!search.value.trim() || active().length > 0,
  }
}
