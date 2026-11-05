// js/gallery.js — Le foto di un articolo (scheda 1.6: C1, C2, E5, FO-01…FO-15)
//
// Un solo componente per gioielli e semilavorati, in due modi:
//   - con owner: le foto sono già salvate, e ogni azione va subito al database (scheda del gioiello, modifica del semilavorato);
//   - senza owner: l'articolo non esiste ancora. Le foto restano qui e le carica uploadAll dopo il salvataggio
//     (Nuovo articolo, Nuovo semilavorato). La prima è la copertina.
// Le foto si riducono qui, nel browser: il servizio della sede usa solo moduli di Node.js e non lavora le immagini.
// I permessi li decide il database: qui si mostrano solo i comandi del proprio ruolo.
import {
  uploadPhoto, uploadRawPhoto, getArticlePhotos, getRawItemPhotos, setPhotoCover, reorderPhotos, removePhoto, getMyRole,
} from './supabase.js'
import { showToast } from './utils.js'

const MAX_SIDE = 1600                        // il lato lungo. Le foto del sito sono da 1000 a 1200 px
const JPEG_QUALITY = 0.85
const MAX_INPUT_BYTES = 50 * 1024 * 1024     // le macchine fotografiche fanno file grandi; dopo la riduzione sono piccoli
const KEEP_AS_IS_BYTES = 1024 * 1024
const KEEP_AS_IS_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isTouch = () => window.matchMedia('(pointer: coarse)').matches
const fileKey = f => `${f.name}|${f.size}|${f.lastModified}`

// Il file da caricare: ridotto, dritto e senza dati nascosti. Una foto già piccola si tiene com'è (FO-10, FO-11, FO-12)
export async function prepareImage(file) {
  if (file.size > MAX_INPUT_BYTES) throw new Error('pesa più di 50 MB')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('questo formato non si apre: salvala in JPG. I file grezzi delle macchine fotografiche e gli HEIC non si leggono qui')
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES && KEEP_AS_IS_TYPES.includes(file.type)) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'                   // il JPEG non ha il trasparente
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('non sono riuscito a ridurla')
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'foto'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

// ─── La foto grande, sopra a tutto ───────────────────────────

let lightbox = null
function openLightbox(urls, start) {
  if (!lightbox) {
    lightbox = document.createElement('dialog')
    lightbox.className = 'gal-lightbox'
    lightbox.innerHTML = `
      <button type="button" class="gal-btn gal-lightbox-close" aria-label="Chiudi">×</button>
      <button type="button" class="gal-btn gal-lightbox-prev" aria-label="Foto precedente">‹</button>
      <img alt="">
      <button type="button" class="gal-btn gal-lightbox-next" aria-label="Foto successiva">›</button>`
    document.body.appendChild(lightbox)
    lightbox.addEventListener('click', e => {
      if (e.target === lightbox || e.target.closest('.gal-lightbox-close')) lightbox.close()
      if (e.target.closest('.gal-lightbox-prev')) lightbox.step(-1)
      if (e.target.closest('.gal-lightbox-next')) lightbox.step(1)
    })
    lightbox.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') lightbox.step(-1)
      if (e.key === 'ArrowRight') lightbox.step(1)
    })
  }
  let index = start
  const show = () => { lightbox.querySelector('img').src = urls[index] }
  lightbox.step = delta => { index = (index + delta + urls.length) % urls.length; show() }
  for (const b of lightbox.querySelectorAll('.gal-lightbox-prev, .gal-lightbox-next')) b.hidden = urls.length < 2
  show()
  lightbox.showModal()
}

// ─── La galleria ─────────────────────────────────────────────

export function createGallery(container, { kind, owner = null, photos = [], large = false, onChange = null }) {
  const saved = owner !== null
  const fromPhoto = p => ({ id: p.id, url: p.public_url, cover: p.is_cover, photo: p })
  let items = saved ? [...photos].sort((a, b) => a.sort_order - b.sort_order).map(fromPhoto) : []
  let canEdit = !saved       // chi crea un articolo sceglie le sue foto
  let canRemove = !saved     // una foto non ancora salvata si toglie sempre
  let selectedId = null
  let busy = false
  let suppressClick = false

  container.classList.add('gal')
  container.innerHTML = `
    <div class="gal-main" hidden><img alt=""></div>
    <div class="gal-grid" role="list"></div>
    <p class="field-hint gal-hint" hidden></p>
    <div class="gal-add" hidden>
      <label class="btn-camera-mobile" style="display:none;position:relative;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Scatta foto
        <input type="file" accept="image/*" capture="environment" style="position:absolute;opacity:0;width:0;height:0;">
      </label>
      <div class="upload-zone" role="button" tabindex="0">
        <div style="font-family:var(--editorial);font-size:14px;color:var(--text-secondary);margin-bottom:4px;">Trascina le foto qui o clicca per sceglierle</div>
        <div style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;">JPG, PNG o WebP, fino a 50 MB l'una. Si riducono a 1600 px</div>
      </div>
    </div>
    <div class="gal-status" role="status" aria-live="polite"></div>
    <div class="field-error gal-errors" role="alert"></div>`
  const $ = selector => container.querySelector(selector)
  const grid = $('.gal-grid')
  const main = $('.gal-main')

  const reload = async () => {
    const fresh = await (kind === 'raw' ? getRawItemPhotos(owner) : getArticlePhotos(owner))
    items = fresh.map(fromPhoto)
    render()
  }
  const changed = () => { if (saved) onChange?.() }
  const isCover = (item, index) => saved ? item.cover : index === 0

  function render() {
    grid.innerHTML = items.map((item, i) => {
      const cover = isCover(item, i)
      return `
        <div class="gal-item${cover ? ' is-cover' : ''}${item.id === selectedId ? ' is-selected' : ''}" data-id="${esc(item.id)}" role="listitem">
          <button type="button" class="gal-open" aria-label="Apri la foto ${i + 1}"><img src="${esc(item.url)}" alt="" draggable="false" loading="lazy"></button>
          ${cover ? '<span class="gal-tag">Copertina</span>' : ''}
          ${canEdit && !cover ? '<button type="button" class="gal-btn gal-star" aria-label="Rendi copertina" title="Rendi copertina">★</button>' : ''}
          ${canRemove ? '<button type="button" class="gal-btn gal-remove" aria-label="Togli la foto" title="Togli la foto">×</button>' : ''}
          ${canEdit && items.length > 1 ? '<button type="button" class="gal-btn gal-handle" aria-label="Sposta la foto: trascina, o usa le frecce" title="Trascina per spostare">⠿</button>' : ''}
        </div>`
    }).join('') || (canEdit ? '' : '<p class="mov-empty">Nessuna foto</p>')

    if (large) {
      const shown = items.find(i => i.id === selectedId) || items.find(i => i.cover) || items[0]
      main.hidden = !shown
      if (shown) main.querySelector('img').src = shown.url
    }
    $('.gal-add').hidden = !canEdit
    const hint = $('.gal-hint')
    hint.hidden = !canEdit || !items.length
    const move = items.length > 1 ? (isTouch() ? ' Per cambiare l\'ordine, trascina dalla maniglia.' : ' Trascina per cambiare l\'ordine.') : ''
    hint.textContent = saved ? `Si salvano subito. La stella sceglie la copertina.${move}` : `La prima è la copertina.${move}`
  }

  // ─── Aggiungere ─────────────────────────────────────────────

  async function addFiles(files) {
    const list = []
    const seen = new Set(saved ? [] : items.map(i => i.key))
    for (const f of files) {
      if (seen.has(fileKey(f))) continue
      seen.add(fileKey(f))
      list.push(f)
    }
    if (!list.length || busy) return
    busy = true
    const errors = []
    let added = false
    const status = $('.gal-status')
    $('.gal-errors').textContent = ''
    for (const [i, file] of list.entries()) {
      status.textContent = list.length > 1 ? `Foto ${i + 1} di ${list.length}…` : 'Foto in preparazione…'
      try {
        const ready = await prepareImage(file)
        if (saved) {
          const photo = await (kind === 'raw' ? uploadRawPhoto(ready, owner) : uploadPhoto(ready, owner))
          items.push(fromPhoto(photo))
        } else {
          items.push({ id: `nuova-${fileKey(file)}`, key: fileKey(file), url: URL.createObjectURL(ready), file: ready })
        }
        added = true
        render()
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`)       // le altre vanno avanti (FO-13)
      }
    }
    status.textContent = ''
    $('.gal-errors').innerHTML = errors.map(esc).join('<br>')
    busy = false
    if (added) changed()
  }

  const zone = $('.upload-zone')
  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*'
    input.onchange = e => addFiles([...e.target.files])
    input.click()
  }
  zone.addEventListener('click', pick)
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } })
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'))
  zone.addEventListener('drop', e => {
    e.preventDefault()
    zone.classList.remove('drag-over')
    addFiles([...e.dataTransfer.files])
  })
  const camera = $('.btn-camera-mobile')
  if (isTouch()) camera.style.display = 'flex'
  camera.querySelector('input').addEventListener('change', e => {
    addFiles([...e.target.files])
    e.target.value = ''
  })

  // ─── Copertina, togliere, aprire ────────────────────────────

  async function setCover(id) {
    if (!saved) {
      items = [items.find(i => i.id === id), ...items.filter(i => i.id !== id)]
      return render()
    }
    try {
      await setPhotoCover(kind, id)
      for (const item of items) item.cover = item.id === id
      render()
      changed()
    } catch (err) {
      showToast(err.message || 'Copertina non cambiata')
    }
  }

  async function removeItem(id) {
    const item = items.find(i => i.id === id)
    if (!item) return
    if (!saved) {
      URL.revokeObjectURL(item.url)
      items = items.filter(i => i.id !== id)
      return render()
    }
    if (!confirm('Togliere questa foto?\n\nNell\'app non si potrà riavere. Resta nelle copie di sicurezza della sede.')) return
    try {
      await removePhoto(kind, item.photo)
      if (selectedId === id) selectedId = null
      await reload()       // se era la copertina, lo è diventata la prossima
      changed()
      showToast('Foto tolta')
    } catch (err) {
      showToast(err.message || 'Foto non tolta')
    }
  }

  grid.addEventListener('click', e => {
    if (suppressClick) return
    const el = e.target.closest('.gal-item')
    if (!el) return
    const id = el.dataset.id
    if (e.target.closest('.gal-star')) return setCover(id)
    if (e.target.closest('.gal-remove')) return removeItem(id)
    if (!e.target.closest('.gal-open')) return
    if (large) {
      selectedId = id
      render()
    } else {
      openLightbox(items.map(i => i.url), items.findIndex(i => i.id === id))
    }
  })
  main.addEventListener('click', () => {
    const shownUrl = main.querySelector('img').src
    const start = Math.max(0, items.findIndex(i => new URL(i.url, location.href).href === shownUrl))
    openLightbox(items.map(i => i.url), start)
  })

  // ─── Ordine: si trascina ────────────────────────────────────
  // Col mouse la foto, col dito la maniglia: un tocco sulla foto deve poter scorrere la pagina. Durante il trascinamento
  // le altre foto si spostano subito, e l'ordine si salva quando si lascia. Con la tastiera, le frecce sulla maniglia.

  async function saveOrder(ids) {
    if (ids.join() === items.map(i => i.id).join()) return
    items = ids.map(id => items.find(i => i.id === id))
    render()
    if (!saved) return
    try {
      await reorderPhotos(kind, owner, ids)
      changed()
    } catch (err) {
      showToast(err.message || 'Ordine non salvato')
      reload().catch(console.error)
    }
  }

  grid.addEventListener('pointerdown', e => {
    if (!canEdit || items.length < 2 || e.button !== 0) return
    const dragged = e.target.closest('.gal-item')
    if (!dragged || e.target.closest('.gal-star, .gal-remove')) return
    if (e.pointerType !== 'mouse' && !e.target.closest('.gal-handle')) return

    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMove = ev => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
        dragging = true
        dragged.classList.add('gal-dragging')
        document.body.classList.add('gal-sorting')
      }
      ev.preventDefault()
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.gal-item')
      if (!under || under === dragged || under.parentElement !== grid) return
      const box = under.getBoundingClientRect()
      const after = ev.clientY > box.bottom || (ev.clientY >= box.top && ev.clientX > box.left + box.width / 2)
      under[after ? 'after' : 'before'](dragged)
    }
    const onEnd = ev => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onEnd)
      document.removeEventListener('pointercancel', onEnd)
      dragged.classList.remove('gal-dragging')
      document.body.classList.remove('gal-sorting')
      if (!dragging) return
      // Il clic che segue il rilascio non deve aprire la foto
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 0)
      if (ev.type === 'pointercancel') return render()
      saveOrder([...grid.querySelectorAll('.gal-item')].map(el => el.dataset.id))
    }
    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onEnd)
    document.addEventListener('pointercancel', onEnd)
  })

  grid.addEventListener('keydown', e => {
    const handle = e.target.closest('.gal-handle')
    if (!handle) return
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
    if (!delta) return
    e.preventDefault()
    const id = handle.closest('.gal-item').dataset.id
    const ids = items.map(i => i.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    // saveOrder ridisegna subito, prima di salvare: il fuoco torna sulla maniglia prima del tasto successivo
    saveOrder(ids)
    ;[...grid.querySelectorAll('.gal-item')].find(el => el.dataset.id === id)?.querySelector('.gal-handle')?.focus()
  })

  if (saved) {
    getMyRole().then(role => {
      canEdit = !!role && role !== 'dev'
      canRemove = role === 'admin'
      render()
    }).catch(console.error)
  }
  render()

  return {
    // Dopo aver creato l'articolo. Una foto che non si carica non ferma le altre: risponde i nomi di quelle rimaste fuori
    async uploadAll(ownerId) {
      const failed = []
      for (const [i, item] of items.entries()) {
        $('.gal-status').textContent = `Foto ${i + 1} di ${items.length}…`
        try {
          await (kind === 'raw' ? uploadRawPhoto(item.file, ownerId) : uploadPhoto(item.file, ownerId))
        } catch (err) {
          console.error(err)
          failed.push(item.file.name)
        }
      }
      $('.gal-status').textContent = ''
      return failed
    },
    clear() {
      for (const item of items) if (item.file) URL.revokeObjectURL(item.url)
      items = []
      $('.gal-errors').textContent = ''
      render()
    },
  }
}
