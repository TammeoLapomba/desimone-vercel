// js/raw-form.js — Modale inserimento/modifica filo smontato
import { insertRawItem, updateRawItem, uploadRawPhoto } from './supabase.js'
import { showToast } from './utils.js'
import { initPhotoUpload } from './photo-upload.js'

let onSuccessCallback = null
let photoUploader = null

export function openRawItemModal({ item = null, categories = [], defaultCategoryId = null, onSuccess }) {
  onSuccessCallback = onSuccess

  // Rimuovi modale precedente
  document.getElementById('rawItemModal')?.remove()

  const isEdit = !!item

  const root = document.getElementById('rawItemModalRoot')
  root.innerHTML = `
  <div class="modal-overlay" id="rawItemModal" role="dialog" aria-modal="true" aria-labelledby="rawItemModalTitle">
    <div class="modal" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow">Smontato · ${isEdit ? 'Modifica' : 'Nuovo'} filo</div>
          <div class="modal-title" id="rawItemModalTitle">${isEdit ? (item.raw_categories?.name || 'Filo') : 'Inserimento Filo'}</div>
        </div>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;"
                onclick="document.getElementById('rawItemModal').classList.remove('open')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="modal-steps">
        <div class="step-tab active" id="rtab1">1 · Identità</div>
        <div class="step-tab" id="rtab2">2 · Qualità &amp; Stock</div>
        <div class="step-tab" id="rtab3">3 · Foto</div>
      </div>

      <div class="modal-body">

        <!-- Step 1 — Identità -->
        <div id="rstep1Content">
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Categoria <span class="field-required">*</span></label>
              <select class="field-select" id="rf_category">
                <option value="">Seleziona categoria…</option>
                ${categories.map(c =>
                  `<option value="${c.id}" ${(defaultCategoryId === c.id || item?.category_id === c.id) ? 'selected' : ''}>${c.name}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Dimensione (mm)</label>
              <div style="position:relative;display:flex;align-items:center;">
                <input type="number" class="field-input" id="rf_size" min="0" step="0.1" value="${item?.size ? parseFloat(item.size) : ''}" style="padding-right:36px;">
                <span style="position:absolute;right:12px;font-family:var(--editorial);font-size:12px;color:var(--text-muted);">mm</span>
              </div>
            </div>
            <div class="form-field">
              <label class="field-label">Peso totale (g)</label>
              <div style="position:relative;display:flex;align-items:center;">
                <input type="number" class="field-input" id="rf_weight" min="0" step="0.01" value="${item?.weight || ''}" style="padding-right:30px;">
                <span style="position:absolute;right:12px;font-family:var(--editorial);font-size:12px;color:var(--text-muted);">g</span>
              </div>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Note interne</label>
              <textarea class="field-input field-textarea" id="rf_notes" rows="3"
                        placeholder="Note per il magazzino o per i fornitori…">${item?.notes || ''}</textarea>
            </div>
          </div>
        </div>

        <!-- Step 2 — Qualità & Stock -->
        <div id="rstep2Content" style="display:none;">
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Colore <span class="field-required">*</span></label>
              <select class="field-input field-select" id="rf_color">
                <option value="">Seleziona colore…</option>
                ${['Corallo Rosso del Mediterraneo', 'Corallo Rosa', 'Corallo Sciacca', 'Corallo Bianco', 'Altro'].map(c => 
                  `<option value="${c}" ${item?.color === c ? 'selected' : ''}>${c}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-field">
              <label class="field-label">Qualità <span class="field-required">*</span></label>
              <select class="field-input field-select" id="rf_quality">
                <option value="">Seleziona qualità…</option>
                ${['I', 'II', 'III'].map(q => 
                  `<option value="${q}" ${item?.quality === q ? 'selected' : ''}>${q}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Quantità (Stock iniziale) <span class="field-required">*</span></label>
              <input type="number" class="field-input" id="rf_stock"
                     min="0" step="1" value="${item?.stock ?? 0}">
            </div>
          </div>

          <!-- Anteprima card -->
          <div style="margin-top:16px;padding:16px;background:var(--ivory);border-radius:4px;border:1px solid var(--ivory-dark);">
            <div style="font-family:var(--editorial);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Anteprima card</div>
            <div id="rfPreview" style="background:white;border-radius:4px;padding:14px;max-width:200px;display:flex;flex-direction:column;gap:8px;">
              <div style="font-family:var(--editorial);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--coral);" id="rfp_cat">—</div>
              <div style="font-family:var(--serif);font-size:18px;" id="rfp_size">—</div>
              <div style="display:flex;gap:4px;" id="rfp_badges"></div>
              <div style="font-family:var(--serif);font-size:24px;font-weight:700;" id="rfp_stock">0</div>
            </div>
          </div>
        </div>

        <!-- Step 3 — Foto (senza pipeline AI) -->
        <div id="rstep3Content" style="display:none;">
          <p style="font-family:var(--editorial);font-style:italic;font-size:13px;color:var(--text-muted);margin-bottom:16px;">
            Le foto vengono salvate così come sono — nessuna elaborazione automatica.
          </p>

          <!-- Pulsante fotocamera mobile -->
          <label id="btnCameraMobileRaw" class="btn-camera-mobile" style="display:none;position:relative;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scatta Foto
            <input type="file" accept="image/*" capture="environment" multiple
                   style="position:absolute;opacity:0;width:0;height:0;" id="rawCameraInput">
          </label>

          <div class="upload-zone" id="rawUploadZone">
            <svg style="width:40px;height:40px;margin:0 auto 12px;display:block;color:var(--text-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            <div style="font-family:var(--editorial);font-size:14px;color:var(--text-secondary);margin-bottom:4px;">Trascina le foto qui o clicca per sfogliare</div>
            <div style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;">JPG, PNG, HEIC — fino a 20MB per foto</div>
          </div>
          <div id="rawPhotoThumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"></div>
        </div>

      </div>

      <div class="modal-footer">
        <span style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;" id="rstepLabel">Step 1 di 3 — Identità filo</span>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost" id="rbtnBack" style="display:none;">← Indietro</button>
          <button class="btn-primary" id="rbtnNext">Avanti →</button>
        </div>
      </div>
    </div>
  </div>`

  const modal = document.getElementById('rawItemModal')
  requestAnimationFrame(() => modal.classList.add('open'))

  let step = 1
  const stepLabels = ['Identità filo', 'Qualità & Stock', 'Foto prodotto']

  // Inizializza photo uploader allo step 3
  const step3El = document.getElementById('rstep3Content')
  photoUploader = initRawPhotoUpload(step3El)

  function updateStep() {
    ;[1, 2, 3].forEach(i => {
      document.getElementById(`rstep${i}Content`).style.display = i === step ? 'block' : 'none'
      const tab = document.getElementById(`rtab${i}`)
      tab.className = 'step-tab' + (i === step ? ' active' : i < step ? ' done' : '')
    })
    document.getElementById('rstepLabel').textContent = `Step ${step} di 3 — ${stepLabels[step - 1]}`
    document.getElementById('rbtnBack').style.display = step > 1 ? '' : 'none'
    document.getElementById('rbtnNext').textContent = step === 3
      ? (isEdit ? 'Salva Modifiche ✓' : 'Salva Filo ✓')
      : 'Avanti →'
    if (step === 2) updatePreview()
  }

  function updatePreview() {
    const catSel = document.getElementById('rf_category')
    const catName = catSel.options[catSel.selectedIndex]?.text || '—'
    const size    = document.getElementById('rf_size').value || '—'
    const wgt     = document.getElementById('rf_weight')?.value
    const color   = document.getElementById('rf_color')?.value || ''
    const quality = document.getElementById('rf_quality')?.value || ''
    const stock   = document.getElementById('rf_stock')?.value || '0'
    
    let sizeText = size !== '—' ? size + 'mm' : '—'
    if (wgt) sizeText += ` (${wgt}g)`

    document.getElementById('rfp_cat').textContent  = catName
    document.getElementById('rfp_size').textContent = sizeText
    document.getElementById('rfp_badges').innerHTML = [
      color   ? `<span style="padding:2px 7px;border-radius:2px;font-family:var(--editorial);font-size:10px;background:var(--ivory-dark);color:var(--text-secondary);">${color}</span>` : '',
      quality ? `<span style="padding:2px 7px;border-radius:2px;font-family:var(--editorial);font-size:10px;background:rgba(201,168,76,0.15);color:#8B7330;">${quality}</span>` : ''
    ].join('')
    const stockEl = document.getElementById('rfp_stock')
    stockEl.textContent  = stock
    stockEl.style.color  = Number(stock) === 0 ? 'var(--coral)' : Number(stock) < 5 ? '#C9A84C' : 'var(--text-primary)'
  }

  ;['rf_category', 'rf_size', 'rf_weight', 'rf_color', 'rf_quality', 'rf_stock'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updatePreview)
    document.getElementById(id)?.addEventListener('change', updatePreview)
  })

  document.getElementById('rbtnNext').addEventListener('click', async () => {
    if (step < 3) {
      if (step === 1 && !document.getElementById('rf_category').value) {
        showToast('Seleziona una categoria'); return
      }
      step++; updateStep()
    } else {
      await submitRawItem(isEdit, item?.id)
    }
  })

  document.getElementById('rbtnBack').addEventListener('click', () => {
    if (step > 1) { step--; updateStep() }
  })

  // Chiudi cliccando overlay
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('open')
  })
}

// ─── Photo upload semplificato per smontato (no pipeline) ─────

function initRawPhotoUpload(containerEl) {
  const files = []
  const zone  = containerEl.querySelector('#rawUploadZone')
  const thumbs = containerEl.querySelector('#rawPhotoThumbs')

  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over') })
  zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'))
  zone?.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over')
    handleFiles([...e.dataTransfer.files])
  })
  zone?.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.accept = 'image/*'
    input.onchange = e => handleFiles([...e.target.files])
    input.click()
  })

  // Fotocamera mobile
  const camInput = document.getElementById('rawCameraInput')
  camInput?.addEventListener('change', e => { handleFiles([...e.target.files]); camInput.value = '' })

  const isMobile = window.matchMedia('(max-width: 768px)').matches
  const camBtn = document.getElementById('btnCameraMobileRaw')
  if (camBtn && isMobile) camBtn.style.display = 'flex'

  function handleFiles(newFiles) {
    newFiles.filter(f => f.type.startsWith('image/')).forEach(f => {
      files.push(f)
      const reader = new FileReader()
      reader.onload = e => {
        const isFirst = files.length === 1
        const wrap = document.createElement('div')
        wrap.style.cssText = 'position:relative;display:inline-block;'
        wrap.innerHTML = `
          <img src="${e.target.result}" style="width:80px;height:80px;border-radius:3px;object-fit:cover;border:1.5px solid var(--ivory-dark);">
          ${isFirst ? '<span style="position:absolute;bottom:3px;left:3px;background:rgba(26,24,20,0.7);color:white;font-family:var(--mono);font-size:7px;padding:1px 4px;border-radius:1px;text-transform:uppercase;">Cover</span>' : ''}
          <button onclick="this.parentElement.remove()" style="position:absolute;top:-5px;right:-5px;width:20px;height:20px;background:var(--coral);border-radius:50%;border:none;color:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>`
        wrap.setAttribute('data-idx', files.length - 1)
        thumbs?.appendChild(wrap)
      }
      reader.readAsDataURL(f)
    })
  }

  return {
    getFiles: () => files,
    clear: () => { files.length = 0; if (thumbs) thumbs.innerHTML = '' }
  }
}

// ─── Submit ───────────────────────────────────────────────────

async function submitRawItem(isEdit, existingId) {
  const btn = document.getElementById('rbtnNext')
  btn.textContent = 'Salvataggio…'
  btn.disabled = true

  try {
    const fields = {
      category_id: document.getElementById('rf_category').value,
      size:    document.getElementById('rf_size').value ? document.getElementById('rf_size').value + 'mm' : null,
      color:   document.getElementById('rf_color').value || null,
      quality: document.getElementById('rf_quality').value || null,
      stock:   Number(document.getElementById('rf_stock').value)  || 0,
      weight:  document.getElementById('rf_weight').value ? Number(document.getElementById('rf_weight').value) : 0,
      notes:   document.getElementById('rf_notes').value.trim()   || null,
    }

    let savedItem
    if (isEdit) {
      savedItem = await updateRawItem(existingId, fields)
      showToast('Filo aggiornato')
    } else {
      savedItem = await insertRawItem(fields)
      showToast('Filo inserito')
    }

    // Upload foto (no pipeline — solo storage + DB)
    const photos = photoUploader?.getFiles() || []
    for (let i = 0; i < photos.length; i++) {
      const isCover = i === 0  // La prima foto diventa automaticamente la cover
      await uploadRawPhoto(photos[i], savedItem.id, isCover)
    }

    document.getElementById('rawItemModal').classList.remove('open')
    onSuccessCallback?.()

  } catch (err) {
    console.error(err)
    showToast('Errore: ' + err.message)
    btn.textContent = isEdit ? 'Salva Modifiche ✓' : 'Salva Filo ✓'
    btn.disabled = false
  }
}
