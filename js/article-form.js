// js/article-form.js
import { supabase, getCollections, getMaterials, insertArticle, uploadPhoto } from './supabase.js'
import { buildSkuPreview, showToast } from './utils.js'
import { initPhotoUpload } from './photo-upload.js'

let collections = []
let corals = []
let metals = []
let photoUploader = null
let onSuccessCallback = null

export async function openArticleModal({ onSuccess }) {
  onSuccessCallback = onSuccess

  // Load data if not already loaded
  if (!collections.length) {
    [collections, corals, metals] = await Promise.all([
      getCollections(),
      getMaterials('coral'),
      getMaterials('metal')
    ])
  }

  renderModal()
  document.getElementById('articleModal').classList.add('open')
  photoUploader = initPhotoUpload(document.getElementById('step3Content'))
  setupFormListeners()
}

function renderModal() {
  const root = document.getElementById('articleModalRoot')
  root.innerHTML = `
  <div class="modal-overlay" id="articleModal" role="dialog" aria-modal="true" aria-labelledby="articleModalTitle">
    <div class="modal">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow">Catalogo · Nuovo articolo</div>
          <div class="modal-title" id="articleModalTitle">Inserimento Articolo</div>
        </div>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;" onclick="document.getElementById('articleModal').classList.remove('open')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-steps">
        <div class="step-tab active" id="tab1">1 · Identità</div>
        <div class="step-tab" id="tab2">2 · Materiali & Prezzi</div>
        <div class="step-tab" id="tab3">3 · Foto</div>
      </div>

      <div class="modal-body">
        <div id="step1Content">
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Collezione <span class="field-required">*</span></label>
              <select class="field-select" id="f_collection">
                <option value="">Seleziona collezione…</option>
                ${collections.map(c => `<option value="${c.id}" data-slug="${c.slug}">${c.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Tipo prodotto <span class="field-required">*</span></label>
              <select class="field-select" id="f_type">
                <option value="">Seleziona…</option>
                ${['bracciale', 'collana', 'anello', 'orecchini', 'spilla', 'ciondolo', 'altro'].map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Nome <span style="color:var(--text-muted);font-style:italic;">— opzionale</span></label>
              <input type="text" class="field-input" id="f_name" placeholder="es. Fantasia, Mare, Etnico…">
              <span class="field-error" style="display:none;" id="namePreview"></span>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">SKU (anteprima)</label>
              <div class="sku-preview empty" id="skuPreview">—-—-—-###</div>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Note interne</label>
              <textarea class="field-input field-textarea" id="f_notes" rows="3" placeholder="Note per il team, riferimenti artigiano…"></textarea>
            </div>
          </div>
        </div>

        <div id="step2Content" style="display:none;">
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Corallo <span class="field-required">*</span></label>
              <select class="field-select" id="f_coral">
                <option value="">Seleziona…</option>
                ${corals.map(m => `<option value="${m.id}" data-code="${m.code}">${m.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label class="field-label">Materiale montatura <span class="field-required">*</span></label>
              <select class="field-select" id="f_metal">
                <option value="">Seleziona…</option>
                ${metals.map(m => `<option value="${m.id}" data-code="${m.code}">${m.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Prezzo retail (€) <span class="field-required">*</span></label>
              <input type="number" class="field-input" id="f_price_retail" placeholder="0" step="1" min="0">
            </div>
            <div class="form-field">
              <label class="field-label">Prezzo ingrosso (€)</label>
              <input type="number" class="field-input" id="f_price_wholesale" placeholder="0" step="1" min="0">
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Stock</label>
              <input type="number" class="field-input" id="f_stock" placeholder="0" min="0">
            </div>
            <div class="form-field">
              <label class="field-label">Peso (g)</label>
              <input type="number" class="field-input" id="f_weight" placeholder="0.0" step="0.1" min="0">
            </div>
          </div>
          <div class="form-row triple">
            <div class="form-field">
              <label class="field-label">Larghezza (cm)</label>
              <input type="number" class="field-input" id="f_width" placeholder="—">
            </div>
            <div class="form-field">
              <label class="field-label">Lunghezza (cm)</label>
              <input type="number" class="field-input" id="f_length" placeholder="—">
            </div>
            <div class="form-field">
              <label class="field-label">Altezza (cm)</label>
              <input type="number" class="field-input" id="f_height" placeholder="—">
            </div>
          </div>
          <div style="margin-top:8px;padding:10px 12px;background:var(--ivory);border-radius:3px;font-family:var(--mono);font-size:12px;color:var(--coral);" id="skuPreviewStep2"></div>
        </div>

        <div id="step3Content" style="display:none;">
          <p style="font-family:var(--editorial);font-style:italic;font-size:13px;color:var(--text-muted);margin-bottom:16px;">
            Le foto raw verranno elaborate automaticamente: rimozione sfondo e generazione descrizioni in IT/EN/FR.
          </p>

          <!-- Pulsante fotocamera — visibile solo su mobile via CSS -->
          <label id="btnCameraMobile" class="btn-camera-mobile" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scatta Foto
            <input type="file" accept="image/*" capture="environment" multiple
                   style="position:absolute;opacity:0;width:0;height:0;" id="cameraInput">
          </label>

          <div class="upload-zone">
            <svg style="width:40px;height:40px;margin:0 auto 12px;display:block;color:var(--text-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div style="font-family:var(--editorial);font-size:14px;color:var(--text-secondary);margin-bottom:4px;">Trascina le foto qui o clicca per sfogliare</div>
            <div style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;">JPG, PNG, HEIC — fino a 20MB per foto</div>
          </div>
          <div id="photoThumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"></div>
        </div>
      </div>

      <div class="modal-footer">
        <span style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;" id="stepLabel">Step 1 di 3 — Identità articolo</span>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost" id="btnBack" style="display:none;">← Indietro</button>
          <button class="btn-primary" id="btnNext">Avanti →</button>
        </div>
      </div>
    </div>
  </div>`
}

function setupFormListeners() {
  let step = 1
  const stepLabels = ['Identità articolo', 'Materiali & Prezzi', 'Foto prodotto']

  function updateStep() {
    [1, 2, 3].forEach(i => {
      document.getElementById(`step${i}Content`).style.display = i === step ? 'block' : 'none'
      const tab = document.getElementById(`tab${i}`)
      tab.className = 'step-tab' + (i === step ? ' active' : i < step ? ' done' : '')
    })
    document.getElementById('stepLabel').textContent = `Step ${step} di 3 — ${stepLabels[step - 1]}`
    document.getElementById('btnBack').style.display = step > 1 ? '' : 'none'
    document.getElementById('btnNext').textContent = step === 3 ? 'Salva & Avvia Pipeline ✦' : 'Avanti →'
    updateSkuPreview()
  }

  function updateSkuPreview() {
    const collSel = document.getElementById('f_collection')
    const coralSel = document.getElementById('f_coral')
    const metalSel = document.getElementById('f_metal')
    const collSlug = collSel.selectedOptions[0]?.dataset.slug || ''
    const coralCode = coralSel.selectedOptions[0]?.dataset.code || ''
    const metalCode = metalSel.selectedOptions[0]?.dataset.code || ''
    const preview = buildSkuPreview(collSlug, coralCode, metalCode)
    const el1 = document.getElementById('skuPreview')
    const el2 = document.getElementById('skuPreviewStep2')
    if (el1) { el1.textContent = preview; el1.classList.toggle('empty', !collSlug) }
    if (el2) el2.textContent = preview
  }

  document.getElementById('f_collection').addEventListener('change', updateSkuPreview)
  document.getElementById('f_coral')?.addEventListener('change', updateSkuPreview)
  document.getElementById('f_metal')?.addEventListener('change', updateSkuPreview)
  document.getElementById('f_type')?.addEventListener('change', updateNamePreview)
  document.getElementById('f_name')?.addEventListener('input', updateNamePreview)

  function updateNamePreview() {
    const collSel = document.getElementById('f_collection')
    const collName = collSel.options[collSel.selectedIndex]?.text || ''
    const pType = document.getElementById('f_type').value
    const pTypeName = pType ? pType.charAt(0).toUpperCase() + pType.slice(1) : ''
    const customName = document.getElementById('f_name')?.value.trim() || ''
    if (!pTypeName && !collName) return
    const preview = [pTypeName, collName, customName].filter(Boolean).join(' ')
    const el = document.getElementById('namePreview')
    if (el) {
      el.textContent = preview ? `Anteprima: “${preview}”` : ''
      el.style.display = preview ? 'block' : 'none'
      el.style.color = 'var(--text-muted)'
      el.style.fontStyle = 'italic'
    }
  }

  document.getElementById('btnNext').addEventListener('click', async () => {
    if (step < 3) {
      if (!validateStep(step)) return
      step++
      updateStep()
    } else {
      await submitForm()
    }
  })

  document.getElementById('btnBack').addEventListener('click', () => {
    if (step > 1) { step--; updateStep() }
  })

  function validateStep(s) {
    if (s === 1) {
      if (!document.getElementById('f_collection').value) { showToast('Seleziona una collezione'); return false }
      if (!document.getElementById('f_type').value) { showToast('Seleziona il tipo prodotto'); return false }
    }
    if (s === 2) {
      if (!document.getElementById('f_coral').value) { showToast('Seleziona il tipo di corallo'); return false }
      if (!document.getElementById('f_metal').value) { showToast('Seleziona il tipo di metallo'); return false }
      if (!document.getElementById('f_price_retail').value) { showToast('Inserisci il prezzo retail'); return false }
    }
    return true
  }

  async function submitForm() {
    const btn = document.getElementById('btnNext')
    btn.textContent = 'Salvataggio...'
    btn.disabled = true

    try {
      // 1. Genera SKU server-side via Supabase RPC
      const collId = document.getElementById('f_collection').value
      const coralId = document.getElementById('f_coral').value
      const metalId = document.getElementById('f_metal').value

      const { data: skuData, error: skuError } = await supabase.rpc('generate_sku', {
        p_collection_id: collId,
        p_coral_id: coralId,
        p_metal_id: metalId
      })
      if (skuError) throw skuError

      // 2. INSERT article
      const measurements = {}
      const w = document.getElementById('f_width').value
      const l = document.getElementById('f_length').value
      const h = document.getElementById('f_height').value
      const wt = document.getElementById('f_weight').value
      if (w) measurements.width_cm = Number(w)
      if (l) measurements.length_cm = Number(l)
      if (h) measurements.height_cm = Number(h)
      if (wt) measurements.weight_g = Number(wt)

      const collSel = document.getElementById('f_collection')
      const collName = collSel.options[collSel.selectedIndex].text
      const pType = document.getElementById('f_type').value
      const pTypeName = pType.charAt(0).toUpperCase() + pType.slice(1)
      const customName = document.getElementById('f_name')?.value.trim() || ''
      const dynamicName = [pTypeName, collName, customName].filter(Boolean).join(' ') +
        (l ? ` ${l}cm` : '')

      const article = await insertArticle({
        collection_id: collId,
        name: dynamicName,
        product_type: pType,
        coral_material_id: coralId,
        metal_material_id: metalId,
        sku: skuData,
        price_retail: Number(document.getElementById('f_price_retail').value) || null,
        price_wholesale: Number(document.getElementById('f_price_wholesale').value) || null,
        stock_retail: Number(document.getElementById('f_stock').value) || 0,
        stock_wholesale: 0,
        channel: 'both',
        notes: document.getElementById('f_notes').value.trim() || null,
        measurements: Object.keys(measurements).length ? measurements : null
      })

      // 3. Upload photos
      const files = photoUploader.getFiles()
      for (const file of files) {
        await uploadPhoto(file, article.id)
      }

      // 4. Close + callback
      document.getElementById('articleModal').classList.remove('open')
      if (onSuccessCallback) onSuccessCallback(article)

    } catch (e) {
      console.error(e)
      showToast('Errore durante il salvataggio: ' + e.message)
      btn.textContent = 'Salva & Avvia Pipeline ✦'
      btn.disabled = false
    }
  }
}
