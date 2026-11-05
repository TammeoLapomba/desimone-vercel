// js/raw-form.js — Modale inserimento/modifica semilavorato (pallini, spole)
// Il codice non si scrive: si sceglie tipo, forma, qualità, finitura, misura e varianti, e il database
// lo compone con lo standard del cliente (raw_item_preview, vedi 019_semilavorato_codici.sql).
import { insertRawItem, updateRawItem, getRawItemPhotos, previewRawItem, retirePreview, retireItem } from './supabase.js'
import { createGallery } from './gallery.js'
import { showToast, debounce, stockLabel, confirmRetire } from './utils.js'

let onSuccessCallback = null
let photoUploader = null

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmtNum = n => (n === null || n === undefined || n === '' ? '' : String(parseFloat(n)).replace('.', ','))

const SUFFIX_MM = `<span style="position:absolute;right:12px;font-family:var(--editorial);font-size:12px;color:var(--text-muted);">mm</span>`
const SUFFIX_CM = `<span style="position:absolute;right:12px;font-family:var(--editorial);font-size:12px;color:var(--text-muted);">cm</span>`

const numField = (id, label, suffix, { required = false, value = '', hint = '' } = {}) => `
  <div class="form-field">
    <label class="field-label" for="${id}">${label}${required ? ' <span class="field-required">*</span>' : ''}</label>
    <div style="position:relative;display:flex;align-items:center;">
      <input type="number" class="field-input" id="${id}" min="0" step="0.01" inputmode="decimal" value="${value}" style="padding-right:36px;">
      ${suffix}
    </div>
    ${hint ? `<span style="font-family:var(--editorial);font-size:11px;color:var(--text-muted);margin-top:4px;display:block;">${hint}</span>` : ''}
  </div>`

// rules = { shapes, groups, variants } da getRawCodeRules()
export function openRawItemModal({ item = null, categories = [], rules, defaultCategoryId = null, isAdmin = false, onSuccess }) {
  onSuccessCallback = onSuccess

  // Rimuovi modale precedente
  document.getElementById('rawItemModal')?.remove()

  const isEdit = !!item
  const shapeOf = id => rules.shapes.find(s => s.id === id)
  const baseId = shape => shape.base_shape_id || shape.id
  const groupsOf = (shape, tall) => rules.groups.filter(g => g.shape_id === baseId(shape) && g.is_tall === !!tall)
  const creatableShapes = categoryId => rules.shapes.filter(s => s.category_id === categoryId && s.creatable)
  const types = categories.filter(c => creatableShapes(c.id).length)

  const root = document.getElementById('rawItemModalRoot')
  root.innerHTML = `
  <div class="modal-overlay" id="rawItemModal" role="dialog" aria-modal="true" aria-labelledby="rawItemModalTitle">
    <div class="modal" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow">Semilavorato · ${isEdit ? 'Modifica' : 'Nuovo'} articolo</div>
          <div class="modal-title" id="rawItemModalTitle">${isEdit ? esc(item.sku || item.raw_categories?.name || 'Articolo') : 'Nuovo semilavorato'}</div>
        </div>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;" aria-label="Chiudi"
                onclick="document.getElementById('rawItemModal').classList.remove('open')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="modal-steps">
        <div class="step-tab active" id="rtab1">1 · Articolo</div>
        <div class="step-tab" id="rtab2">2 · Dettagli &amp; Stock</div>
        <div class="step-tab" id="rtab3">3 · Foto</div>
      </div>

      <div class="modal-body">

        <!-- Step 1 — Articolo: i campi che compongono il codice -->
        <div id="rstep1Content">
          ${isEdit ? renderReadOnlyIdentity(item, shapeOf(item.shape_id)) : `
          <div class="form-row">
            <div class="form-field">
              <label class="field-label" for="rf_type">Tipo <span class="field-required">*</span></label>
              <select class="field-select" id="rf_type">
                ${types.map(c => `<option value="${c.id}" ${c.id === defaultCategoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label class="field-label" for="rf_shape" id="rf_shape_label">Forma <span class="field-required">*</span></label>
              <select class="field-select" id="rf_shape"></select>
            </div>
          </div>
          <div class="form-row full" id="rf_tall_row" style="display:none;">
            <label style="display:flex;align-items:center;gap:8px;font-family:var(--editorial);font-size:14px;cursor:pointer;">
              <input type="checkbox" id="rf_tall"> Alta
            </label>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label" for="rf_quality">Qualità <span class="field-required">*</span></label>
              <select class="field-select" id="rf_quality"></select>
            </div>
            <div class="form-field">
              <label class="field-label" for="rf_finish">Finitura</label>
              <select class="field-select" id="rf_finish"></select>
            </div>
          </div>
          <div class="form-row" id="rf_size_row"></div>
          <div class="form-row full" id="rf_variants_row"></div>

          <div style="margin-top:4px;">
            <div class="field-label" style="margin-bottom:6px;">Codice</div>
            <div class="sku-preview empty" id="rfCode" aria-live="polite">—</div>
            <div id="rfCodeNote" style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);margin-top:6px;min-height:18px;">
              Scegli forma, qualità e misura: il codice si compone da solo.
            </div>
          </div>`}
        </div>

        <!-- Step 2 — Dettagli & Stock -->
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
              <label class="field-label">Giacenza</label>
              <input type="text" class="field-input" id="rf_stock" readonly
                     value="${isEdit ? stockLabel(item) : 'Si carica dai Movimenti'}"
                     title="Somma dei movimenti: si cambia solo con un movimento (Carico iniziale, Nuova produzione…)">
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Note interne</label>
              <textarea class="field-input field-textarea" id="rf_notes" rows="3"
                        placeholder="Note per il magazzino o per i fornitori…">${esc(item?.notes || '')}</textarea>
            </div>
          </div>

          <!-- Anteprima card -->
          <div style="margin-top:16px;padding:16px;background:var(--ivory);border-radius:4px;border:1px solid var(--ivory-dark);">
            <div style="font-family:var(--editorial);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Anteprima card</div>
            <div id="rfPreview" style="background:white;border-radius:4px;padding:14px;max-width:200px;display:flex;flex-direction:column;gap:8px;">
              <div style="font-family:var(--editorial);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--coral);" id="rfp_cat">—</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);" id="rfp_sku">—</div>
              <div style="font-family:var(--editorial);font-size:18px;" id="rfp_size">—</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;" id="rfp_badges"></div>
              <div style="font-family:var(--editorial);font-size:24px;font-weight:700;" id="rfp_stock">${isEdit ? stockLabel(item) : 0}</div>
            </div>
          </div>
        </div>

        <!-- Step 3 — Foto -->
        <div id="rstep3Content" style="display:none;">
          <div id="rawGallery"></div>
        </div>

      </div>

      <div class="modal-footer">
        <span style="font-family:var(--editorial);font-size:12px;color:var(--text-muted);font-style:italic;" id="rstepLabel">Step 1 di 3 — Articolo</span>
        <div style="display:flex;gap:8px;">
          ${isEdit && isAdmin ? '<button type="button" class="btn-danger" id="rbtnRetire">Archivia o elimina</button>' : ''}
          <button class="btn-ghost" id="rbtnBack" style="display:none;">← Indietro</button>
          <button class="btn-primary" id="rbtnNext">Avanti →</button>
        </div>
      </div>
    </div>
  </div>`

  const modal = document.getElementById('rawItemModal')
  requestAnimationFrame(() => modal.classList.add('open'))

  let step = 1
  const stepLabels = ['Articolo', 'Dettagli & Stock', 'Foto prodotto']
  const $ = id => document.getElementById(id)

  // Foto allo step 3: in modifica la galleria salva subito, per un pezzo nuovo si caricano dopo il salvataggio (scheda 1.6)
  if (isEdit) {
    photoUploader = null
    getRawItemPhotos(item.id)
      .then(photos => createGallery($('rawGallery'), { kind: 'raw', owner: item.id, photos, onChange: () => onSuccessCallback?.() }))
      .catch(err => { $('rawGallery').textContent = `Foto non disponibili: ${err.message}` })
  } else {
    photoUploader = createGallery($('rawGallery'), { kind: 'raw' })
  }

  // ─── Step 1 (nuovo articolo): campi del codice ───────────────

  let preview = null          // risposta di raw_item_preview, null se i campi non bastano
  let previewMsg = ''         // errore da mostrare (combinazione non prevista…)
  let previewSeq = 0

  const selected = () => ({
    shape: shapeOf($('rf_shape')?.value),
    category: categories.find(c => c.id === $('rf_type')?.value),
    tall: !!$('rf_tall')?.checked,
  })

  function fillShapes() {
    const shapes = creatableShapes($('rf_type').value)
    $('rf_shape').innerHTML = shapes.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
    const cat = categories.find(c => c.id === $('rf_type').value)
    $('rf_shape_label').innerHTML = (cat?.slug === 'spole' ? 'Tipo di spola' : 'Forma') + ' <span class="field-required">*</span>'
  }

  // «Alta» solo per le forme che la prevedono (spola ovale e tonda)
  function showTall() {
    const { shape } = selected()
    $('rf_tall_row').style.display = shape?.allows_tall ? '' : 'none'
    if (!shape?.allows_tall) $('rf_tall').checked = false
  }

  function fillQuality() {
    const { shape, tall } = selected()
    const prev = $('rf_quality').value
    const qualities = [...new Set(groupsOf(shape, tall).map(g => g.quality))]
    $('rf_quality').innerHTML = qualities.map(q => `<option value="${esc(q)}" ${q === prev ? 'selected' : ''}>${esc(q)}</option>`).join('')
  }

  // Nessuna / EX / EX EX sono sempre visibili; quelle senza un gruppo nello standard del cliente sono disattivate
  const FINISHES = [['', 'Nessuna'], ['EX', 'EX'], ['EX EX', 'EX EX']]
  function fillFinish() {
    const { shape, tall } = selected()
    const prev = $('rf_finish').value
    const available = groupsOf(shape, tall).filter(g => g.quality === $('rf_quality').value).map(g => g.finish)
    const pick = available.includes(prev) ? prev : available[0]
    $('rf_finish').innerHTML = FINISHES.map(([v, label]) => {
      const ok = available.includes(v)
      return `<option value="${v}" ${v === pick ? 'selected' : ''} ${ok ? '' : 'disabled'}>${label}${ok ? '' : ' — non previsto'}</option>`
    }).join('')
  }

  let sizeKind = null
  function renderSizeInputs() {
    const { shape } = selected()
    if (shape.size_kind === sizeKind) {
      const wrap = $('rf_length_cm_wrap')
      if (wrap) wrap.style.display = shape.has_length_cm ? '' : 'none'
      return
    }
    sizeKind = shape.size_kind
    const row = $('rf_size_row')
    if (sizeKind === 'base_height') {
      row.innerHTML = numField('rf_base', 'Base', SUFFIX_MM, { required: true }) +
                      numField('rf_height', 'Altezza', SUFFIX_MM, { required: true, hint: 'Base e altezza viste dall\'alto' })
    } else {
      row.innerHTML = numField('rf_size', 'Misura', SUFFIX_MM, { required: true }) +
                      numField('rf_size_to', 'Fino a', SUFFIX_MM, { hint: 'Solo se è un intervallo (es. 7 – 8 mm)' }) +
                      `<div id="rf_length_cm_wrap">${numField('rf_length_cm', 'Lunghezza', SUFFIX_CM, { hint: 'Facoltativa, non entra nel codice' })}</div>`
    }
    row.querySelectorAll('input').forEach(el => el.addEventListener('input', onFieldInput))
    if ($('rf_length_cm_wrap')) $('rf_length_cm_wrap').style.display = shape.has_length_cm ? '' : 'none'
  }

  function renderVariants() {
    const list = rules.variants.filter(v => v.creatable)
    $('rf_variants_row').innerHTML = list.length ? `
      <div class="form-field">
        <div class="field-label">Sigle <span style="color:var(--text-muted);font-style:italic;">— facoltative</span></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          ${list.map(v => `
            <label style="display:flex;align-items:center;gap:6px;font-family:var(--editorial);font-size:13px;cursor:pointer;" title="${esc(v.notes || '')}">
              <input type="checkbox" class="rf_variant" value="${esc(v.code)}"> ${esc(v.name)}
            </label>`).join('')}
        </div>
      </div>` : ''
    $('rf_variants_row').querySelectorAll('input').forEach(el => el.addEventListener('change', onFieldInput))
  }

  const val = id => {
    const v = $(id)?.value
    return v === undefined || v === '' ? null : Number(v)
  }

  function readFields() {
    const { shape, category } = selected()
    return {
      category_id: category?.id,
      shape_id: shape?.id,
      is_tall: !!shape?.allows_tall && $('rf_tall').checked,
      quality: $('rf_quality').value || null,
      finish: $('rf_finish').value || '',
      size_from_mm: shape?.size_kind === 'diameter' ? val('rf_size') : null,
      size_to_mm: shape?.size_kind === 'diameter' ? val('rf_size_to') : null,
      base_mm: shape?.size_kind === 'base_height' ? val('rf_base') : null,
      height_mm: shape?.size_kind === 'base_height' ? val('rf_height') : null,
      length_cm: shape?.has_length_cm ? val('rf_length_cm') : null,
      variants: [...document.querySelectorAll('.rf_variant:checked')].map(el => el.value),
    }
  }

  function readyForCode(f) {
    const { shape } = selected()
    if (!f.shape_id || !f.quality) return false
    if (shape.size_kind === 'base_height') return f.base_mm > 0 && f.height_mm > 0
    return f.size_from_mm > 0
  }

  function showPreview() {
    const code = $('rfCode'), note = $('rfCodeNote')
    code.textContent = preview ? preview.sku : '—'
    code.classList.toggle('empty', !preview)
    if (preview?.existing) {
      note.style.color = 'var(--coral)'
      note.textContent = `Esiste già: ${preview.existing.sku}${preview.existing.description ? ' — ' + preview.existing.description : ''}`
    } else if (preview) {
      note.style.color = 'var(--text-muted)'
      note.textContent = preview.description
    } else if (previewMsg) {
      note.style.color = 'var(--coral)'
      note.textContent = previewMsg
    } else {
      note.style.color = 'var(--text-muted)'
      note.textContent = 'Scegli forma, qualità e misura: il codice si compone da solo.'
    }
    updateNext()
  }

  async function refreshPreview() {
    const f = readFields()
    const seq = ++previewSeq
    if (!readyForCode(f)) { preview = null; previewMsg = ''; showPreview(); return }
    try {
      const r = await previewRawItem(f)
      if (seq !== previewSeq) return
      preview = r; previewMsg = ''
    } catch (err) {
      if (seq !== previewSeq) return
      preview = null; previewMsg = err.message
    }
    showPreview()
  }
  const schedulePreview = debounce(refreshPreview, 250)
  // Mentre si digita il codice mostrato non vale più: niente «Avanti» finché non arriva quello nuovo
  function onFieldInput() {
    previewSeq++; preview = null; previewMsg = ''
    updateNext()
    schedulePreview()
  }

  function onShapeChange() {
    showTall(); fillQuality(); fillFinish(); renderSizeInputs(); refreshPreview()
  }

  if (!isEdit) {
    $('rf_type').addEventListener('change', () => { fillShapes(); onShapeChange() })
    $('rf_shape').addEventListener('change', onShapeChange)
    $('rf_tall').addEventListener('change', () => { fillQuality(); fillFinish(); refreshPreview() })
    $('rf_quality').addEventListener('change', () => { fillFinish(); refreshPreview() })
    $('rf_finish').addEventListener('change', refreshPreview)
    fillShapes()
    renderVariants()
    onShapeChange()
  }

  // ─── Navigazione tra gli step ────────────────────────────────

  function blockedOnStep1() { return !isEdit && step === 1 && (!preview || !!preview.existing) }

  function updateNext() {
    const btn = $('rbtnNext')
    if (btn.dataset.saving) return
    btn.disabled = blockedOnStep1()
  }

  function updateStep() {
    ;[1, 2, 3].forEach(i => {
      $(`rstep${i}Content`).style.display = i === step ? 'block' : 'none'
      const tab = $(`rtab${i}`)
      tab.className = 'step-tab' + (i === step ? ' active' : i < step ? ' done' : '')
    })
    $('rstepLabel').textContent = `Step ${step} di 3 — ${stepLabels[step - 1]}`
    $('rbtnBack').style.display = step > 1 ? '' : 'none'
    $('rbtnNext').textContent = step === 3
      ? (isEdit ? 'Salva Modifiche ✓' : 'Salva Articolo ✓')
      : 'Avanti →'
    updateNext()
    if (step === 2) updateCardPreview()
  }

  function updateCardPreview() {
    const color = $('rf_color').value || ''
    const stock  = isEdit ? stockLabel(item) : '0'
    const amount = isEdit ? (item.unit === 'grammi' ? item.stock_grams : item.stock) : 0

    let catName, sku, sizeText, badges
    if (isEdit) {
      catName = item.raw_categories?.name || '—'
      sku = item.sku || '—'
      sizeText = item.size || '—'
      badges = [item.raw_shapes?.name, item.is_tall ? 'Alta' : '', item.quality, item.finish, ...(item.variants || [])]
    } else {
      const { shape, category } = selected()
      const f = readFields()
      catName = category?.name || '—'
      sku = preview?.sku || '—'
      sizeText = preview?.size_label || '—'
      badges = [shape?.name, f.is_tall ? 'Alta' : '', f.quality, f.finish, ...f.variants]
    }
    badges = [...badges.filter(Boolean), color].filter(Boolean)

    $('rfp_cat').textContent  = catName
    $('rfp_sku').textContent  = sku
    $('rfp_size').textContent = sizeText
    $('rfp_badges').innerHTML = badges.map(b =>
      `<span style="padding:2px 7px;border-radius:2px;font-family:var(--editorial);font-size:10px;background:var(--ivory-dark);color:var(--text-secondary);">${esc(b)}</span>`).join('')
    const stockEl = $('rfp_stock')
    stockEl.textContent  = stock
    stockEl.style.color  = amount === 0 ? 'var(--coral)' : item?.unit !== 'grammi' && amount < 5 ? '#C9A84C' : 'var(--text-primary)'
  }

  ;['rf_color'].forEach(id => {
    $(id)?.addEventListener('input', updateCardPreview)
    $(id)?.addEventListener('change', updateCardPreview)
  })

  $('rbtnNext').addEventListener('click', async () => {
    if (step < 3) {
      if (blockedOnStep1()) return
      step++; updateStep()
    } else {
      await submitRawItem(isEdit, item?.id, isEdit ? null : readFields())
    }
  })

  $('rbtnBack').addEventListener('click', () => {
    if (step > 1) { step--; updateStep() }
  })

  // Mai usato e rifacibile dall'app: si elimina. Altrimenti si archivia (CR10): lo decide il database
  $('rbtnRetire')?.addEventListener('click', async () => {
    const btn = $('rbtnRetire')
    btn.disabled = true
    try {
      if (!confirmRetire({ code: item.sku, name: item.description }, await retirePreview({ rawItemId: item.id }))) {
        btn.disabled = false
        return
      }
      const action = await retireItem({ rawItemId: item.id })
      modal.classList.remove('open')
      showToast(`Articolo ${item.sku} ${action === 'deleted' ? 'eliminato' : 'archiviato'}`)
      onSuccessCallback?.()
    } catch (err) {
      console.error(err)
      showToast(err.message, 6000)
      btn.disabled = false
    }
  })

  // Chiudi cliccando overlay
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('open')
  })
}

// Un articolo esistente non cambia codice: forma, qualità, misura e sigle si vedono ma non si modificano.
function renderReadOnlyIdentity(item, shape) {
  const rows = [
    ['Tipo', item.raw_categories?.name],
    [item.raw_categories?.slug === 'spole' ? 'Tipo di spola' : 'Forma', shape?.name],
    ['Alta', item.is_tall ? 'Sì' : null],
    ['Qualità', item.quality],
    ['Finitura', item.finish || (shape ? 'Nessuna' : null)],
    ['Misura', item.size],
    ['Lunghezza', item.length_cm ? fmtNum(item.length_cm) + ' cm' : null],
    ['Sigle', (item.variants || []).join(', ') || null],
  ].filter(([, v]) => v)
  return `
    <div style="padding:14px 16px;background:var(--ivory);border:1px solid var(--ivory-dark);border-radius:4px;">
      <div class="field-label" style="margin-bottom:6px;">Codice</div>
      <div class="sku-preview">${esc(item.sku || '—')}</div>
      ${item.description ? `<div style="font-family:var(--editorial);font-size:13px;color:var(--text-secondary);margin-top:8px;">${esc(item.description)}</div>` : ''}
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:12px 0 0;font-family:var(--editorial);font-size:13px;">
        ${rows.map(([k, v]) => `<dt style="color:var(--text-muted);">${k}</dt><dd style="margin:0;">${esc(v)}</dd>`).join('')}
      </dl>
    </div>
    <p style="font-family:var(--editorial);font-style:italic;font-size:12px;color:var(--text-muted);margin-top:12px;">
      Il codice non cambia mai. Per un'altra misura o qualità inserisci un nuovo articolo.
    </p>`
}

// ─── Submit ───────────────────────────────────────────────────

async function submitRawItem(isEdit, existingId, codeFields) {
  const btn = document.getElementById('rbtnNext')
  btn.textContent = 'Salvataggio…'
  btn.dataset.saving = '1'
  btn.disabled = true

  try {
    const details = {
      color:   document.getElementById('rf_color').value || null,
      notes:   document.getElementById('rf_notes').value.trim()   || null,
    }

    let savedItem
    if (isEdit) {
      savedItem = await updateRawItem(existingId, details)
      showToast('Articolo aggiornato')
    } else {
      // Il codice lo assegna il database dai campi scelti (trigger di raw_items)
      savedItem = await insertRawItem({ ...codeFields, ...details })
      showToast(`Inserito ${savedItem.sku}`)
    }

    // Le foto di un pezzo nuovo, una alla volta: se una non si carica il pezzo resta, e la si aggiunge modificandolo (FO-13)
    const failed = isEdit || !photoUploader ? [] : await photoUploader.uploadAll(savedItem.id)
    if (failed.length) showToast(`Salvato, ma ${failed.length === 1 ? 'una foto non si è caricata' : `${failed.length} foto non si sono caricate`}: ${failed.join(', ')}. Aggiungile modificandolo`)

    document.getElementById('rawItemModal').classList.remove('open')
    onSuccessCallback?.()

  } catch (err) {
    console.error(err)
    showToast('Errore: ' + err.message)
    btn.textContent = isEdit ? 'Salva Modifiche ✓' : 'Salva Articolo ✓'
    delete btn.dataset.saving
    btn.disabled = false
  }
}
