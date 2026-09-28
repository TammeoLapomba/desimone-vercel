// js/color-select.js — Menu a tendina dei colori del pallino collezione, con l'anteprima del colore
// (un <select> nativo non può mostrare i cerchietti colorati)
import { COLLECTION_COLORS } from './utils.js'

let openInstance = null

export function initColorSelect(container, { labelId, value = COLLECTION_COLORS[0][0] } = {}) {
  const uid = container.id || `color-${Math.random().toString(36).slice(2, 8)}`
  container.classList.add('color-select')
  container.innerHTML = `
    <button type="button" class="field-select color-select-btn" id="${uid}-btn"
            aria-haspopup="listbox" aria-expanded="false" aria-controls="${uid}-list"
            aria-labelledby="${labelId ? `${labelId} ` : ''}${uid}-btn">
      <span class="color-dot"></span><span class="color-select-label"></span>
    </button>`

  // La lista sta nel body: dentro una finestra (che ha un transform) verrebbe tagliata
  document.getElementById(`${uid}-list`)?.remove()
  const list = document.createElement('ul')
  list.className = 'color-options'
  list.id = `${uid}-list`
  list.setAttribute('role', 'listbox')
  list.tabIndex = -1
  list.hidden = true
  if (labelId) list.setAttribute('aria-labelledby', labelId)
  list.innerHTML = COLLECTION_COLORS.map(([v, label], i) => `
    <li role="option" id="${uid}-opt-${i}" data-value="${v}" aria-selected="false">
      <span class="color-dot" style="background:${v};"></span>${label}
    </li>`).join('')
  document.body.appendChild(list)

  const btn = container.querySelector('.color-select-btn')
  const options = [...list.querySelectorAll('[role="option"]')]
  let current = value
  let active = 0

  function render() {
    const [v, label] = COLLECTION_COLORS.find(([cv]) => cv === current) || COLLECTION_COLORS[0]
    btn.querySelector('.color-dot').style.background = v
    btn.querySelector('.color-select-label').textContent = label
    options.forEach(o => o.setAttribute('aria-selected', String(o.dataset.value === v)))
  }

  function setActive(i) {
    active = (i + options.length) % options.length
    options.forEach((o, j) => o.classList.toggle('is-active', j === active))
    list.setAttribute('aria-activedescendant', options[active].id)
  }

  function open() {
    openInstance?.close()
    openInstance = api
    list.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    // Posizione fissa: la lista esce dalla finestra senza farla scorrere
    const r = btn.getBoundingClientRect()
    list.style.minWidth = `${r.width}px`
    const below = r.bottom + list.offsetHeight + 4 <= window.innerHeight
    list.style.left = `${Math.min(r.left, window.innerWidth - list.offsetWidth - 8)}px`
    list.style.top = `${below ? r.bottom + 4 : r.top - list.offsetHeight - 4}px`
    setActive(Math.max(0, options.findIndex(o => o.dataset.value === current)))
    list.focus()
  }

  function close({ focusButton = false } = {}) {
    if (list.hidden) return
    list.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    if (openInstance === api) openInstance = null
    if (focusButton) btn.focus()
  }

  function choose(i) {
    current = options[i].dataset.value
    render()
    close({ focusButton: true })
  }

  btn.addEventListener('click', () => (list.hidden ? open() : close()))
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open() }
  })
  list.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ focusButton: true }) }
    else if (e.key === 'Tab') close()
  })
  list.addEventListener('click', e => {
    const opt = e.target.closest('[role="option"]')
    if (opt) choose(options.indexOf(opt))
  })
  list.addEventListener('mousemove', e => {
    const opt = e.target.closest('[role="option"]')
    if (opt) setActive(options.indexOf(opt))
  })

  const api = {
    get value() { return current },
    setValue(v) {
      current = COLLECTION_COLORS.some(([cv]) => cv === v) ? v : COLLECTION_COLORS[0][0]
      render()
    },
    close,
  }
  render()
  return api
}

// Chiude la lista aperta cliccando fuori, scorrendo o ridimensionando la finestra
document.addEventListener('click', e => {
  if (openInstance && !e.target.closest('.color-select, .color-options')) openInstance.close()
})
window.addEventListener('resize', () => openInstance?.close())
document.addEventListener('scroll', e => {
  if (e.target.nodeType === 1 && e.target.closest('.color-options')) return
  openInstance?.close()
}, true)
