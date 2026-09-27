// js/material-picker.js — Materiali di un articolo: una tendina per materiale, "+" per aggiungerne altri

export function initMaterialPicker(container, materials, selectedIds = [], onChange = () => {}) {
  container.classList.add('material-picker')
  container.innerHTML = `
    <div class="material-list"></div>
    <button type="button" class="btn-ghost material-add">+ Aggiungi materiale</button>`
  const list = container.querySelector('.material-list')

  const selects = () => [...list.querySelectorAll('select')]

  // Un materiale già scelto in un'altra riga non si può scegliere di nuovo
  function refresh() {
    const chosen = selects().map(s => s.value).filter(Boolean)
    for (const sel of selects()) {
      for (const opt of sel.options) {
        opt.disabled = Boolean(opt.value) && opt.value !== sel.value && chosen.includes(opt.value)
      }
    }
    onChange()
  }

  function addRow(value = '') {
    const row = document.createElement('div')
    row.className = 'material-row'
    row.innerHTML = `
      <select class="field-select" aria-label="Materiale">
        <option value="">Seleziona…</option>
        ${materials.map(m => `<option value="${m.id}" data-code="${m.code}">${m.name}</option>`).join('')}
      </select>
      <button type="button" class="material-remove" aria-label="Rimuovi materiale" title="Rimuovi">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`
    const sel = row.querySelector('select')
    sel.value = value
    sel.addEventListener('change', refresh)
    row.querySelector('.material-remove').addEventListener('click', () => {
      // Resta sempre almeno una riga: sull'ultima la X svuota la scelta
      if (selects().length > 1) row.remove()
      else sel.value = ''
      refresh()
    })
    list.appendChild(row)
    return sel
  }

  for (const id of selectedIds) addRow(id)
  if (!selectedIds.length) addRow()
  container.querySelector('.material-add').addEventListener('click', () => {
    addRow().focus()
    refresh()
  })
  refresh()

  return {
    // Id scelti, nell'ordine delle righe
    getIds: () => selects().map(s => s.value).filter(Boolean),
    firstCode: () => selects().find(s => s.value)?.selectedOptions[0]?.dataset.code || ''
  }
}
