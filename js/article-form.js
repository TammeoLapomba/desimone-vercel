// js/article-form.js
import { getCollections, insertCollection, getMaterials, getMetals, getProductTypes, createArticle, articleCodePreview } from './supabase.js'
import { debounce, showToast, validateCollection, readPrice, readCm } from './utils.js'
import { initColorSelect } from './color-select.js'
import { createGallery } from './gallery.js'
import { initMaterialPicker, initMetalWeight } from './material-picker.js'

const { validaPeso } = window.Pesi

let collections = []
let productTypes = []
let materials = []
let metals = []
let photoUploader = null
let materialPicker = null
let metalWeight = null
let onSuccessCallback = null
let onCollectionCreatedCallback = null
let canCreateCollection = false

// Tipi, materiali e metalli li aggiunge l'account dev di Dedalo (033): qui non si creano
const MISSING_HINT = 'Se manca una voce, chiedi a Dedalo di aggiungerla.'
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function openArticleModal({ onSuccess, onCollectionCreated, canCreateCollection: canCreate = false }) {
  onSuccessCallback = onSuccess
  onCollectionCreatedCallback = onCollectionCreated
  canCreateCollection = canCreate

  // Le collezioni si ricaricano ogni volta (possono essere state create nel frattempo), il resto una volta sola
  const lists = productTypes.length ? [] : [getProductTypes(), getMaterials(), getMetals()]
  const [freshCollections, ...loaded] = await Promise.all([getCollections(), ...lists])
  collections = freshCollections
  if (loaded.length) [productTypes, materials, metals] = loaded

  renderModal()
  document.getElementById('articleModal').classList.add('open')
  photoUploader = createGallery(document.getElementById('articleGallery'), { kind: 'article' })
  setupFormListeners()
}

// Opzioni del menu collezioni: getCollections le dà già in ordine alfabetico
function collectionOptions() {
  return '<option value="">Seleziona collezione…</option>' +
    collections.map(c => `<option value="${c.id}" data-slug="${c.slug}">${c.name}</option>`).join('')
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
                ${collectionOptions()}
              </select>
              <button type="button" class="btn-ghost" id="btnNewCollectionInline" style="align-self:flex-start;${canCreateCollection ? '' : 'display:none;'}">+ Nuova collezione</button>
            </div>
          </div>
          <div class="inline-panel" id="newCollectionPanel" style="display:none;">
            <div class="inline-panel-title">Nuova collezione</div>
            <div class="form-row full">
              <div class="form-field">
                <label class="field-label" for="f_newcoll_name">Nome collezione <span class="field-required">*</span></label>
                <input type="text" class="field-input" id="f_newcoll_name" placeholder="es. Estate">
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="field-label" for="f_newcoll_code">Codice (3 caratteri) <span class="field-required">*</span></label>
                <input type="text" class="field-input" id="f_newcoll_code" maxlength="3" placeholder="es. EST" style="text-transform:uppercase;">
                <span class="field-hint">Entra nel codice dei gioielli: controllalo bene, dopo non si potrà più cambiare.</span>
              </div>
              <div class="form-field">
                <label class="field-label" id="f_newcoll_color_label">Colore badge <span class="field-required">*</span></label>
                <div id="f_newcoll_color"></div>
              </div>
            </div>
            <div class="inline-panel-actions">
              <button type="button" class="btn-ghost" id="btnNewCollectionCancel">Annulla</button>
              <button type="button" class="btn-primary btn-success" id="btnNewCollectionSave">Crea collezione</button>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Tipo prodotto <span class="field-required">*</span></label>
              <select class="field-select" id="f_type">
                <option value="">Seleziona…</option>
                ${productTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
              <span class="field-hint">${MISSING_HINT}</span>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label" for="f_title">Titolo <span class="field-required">*</span></label>
              <input type="text" class="field-input" id="f_title" placeholder="Si compone da tipo, collezione e lunghezza">
              <span class="field-hint" id="titleHint">Si compone da tipo, collezione e lunghezza: puoi modificarlo come vuoi.</span>
              <button type="button" class="link-button" id="btnTitleAuto" hidden>Torna al titolo automatico</button>
            </div>
          </div>
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Codice (anteprima)</label>
              <div class="sku-preview empty" id="skuPreview">—</div>
              <span class="field-hint">Provvisorio: segue i dati fino al primo carico, poi non cambia più.</span>
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
          <div class="form-row full">
            <div class="form-field">
              <label class="field-label">Materiali <span class="field-required">*</span></label>
              <div id="f_materials"></div>
              <span class="field-hint">${MISSING_HINT}</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Metallo</label>
              <select class="field-select" id="f_metal">
                <option value="">Nessuno</option>
                ${metals.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
              </select>
              <span class="field-hint">${MISSING_HINT}</span>
            </div>
            <div class="form-field" id="f_metal_grams_field" hidden>
              <label class="field-label" for="f_metal_grams">Peso del metallo (g)</label>
              <input type="text" class="field-input" id="f_metal_grams" inputmode="decimal" autocomplete="off" data-virgola>
              <span class="field-hint">Per il cartellino. Non cambia il peso totale.</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Prezzo retail (€) <span class="field-required">*</span></label>
              <input type="text" class="field-input" id="f_price_retail" inputmode="decimal" autocomplete="off" placeholder="0" data-virgola>
            </div>
            <div class="form-field">
              <label class="field-label">Prezzo ingrosso (€)</label>
              <input type="text" class="field-input" id="f_price_wholesale" inputmode="decimal" autocomplete="off" placeholder="0" data-virgola>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Peso totale di un pezzo (g) <span class="field-required">*</span></label>
              <input type="text" class="field-input" id="f_weight" inputmode="decimal" autocomplete="off" placeholder="0,0" data-virgola>
              <div class="field-hint">I movimenti pesano pezzi × questo peso.</div>
            </div>
          </div>
          <div class="form-row triple">
            <div class="form-field">
              <label class="field-label">Larghezza (cm)</label>
              <input type="text" class="field-input" id="f_width" inputmode="decimal" autocomplete="off" placeholder="—" data-virgola>
            </div>
            <div class="form-field">
              <label class="field-label">Lunghezza (cm)</label>
              <input type="text" class="field-input" id="f_length" inputmode="decimal" autocomplete="off" placeholder="—" data-virgola>
            </div>
            <div class="form-field">
              <label class="field-label">Altezza (cm)</label>
              <input type="text" class="field-input" id="f_height" inputmode="decimal" autocomplete="off" placeholder="—" data-virgola>
            </div>
          </div>
          <div style="margin-top:8px;padding:10px 12px;background:var(--ivory);border-radius:3px;font-family:var(--mono);font-size:12px;color:var(--coral);" id="skuPreviewStep2"></div>
          <div class="code-similar" id="codeSimilar" hidden></div>
        </div>

        <div id="step3Content" style="display:none;">
          <div id="articleGallery"></div>
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
    document.getElementById('btnNext').textContent = step === 3 ? 'Salva articolo' : 'Avanti →'
    updateCodePreview()
  }

  // Anteprima del codice e modelli uguali (CD-13, AC-07): la regola sta nel database. Una risposta vecchia non conta.
  let previewRequest = 0
  let lastPreview = null

  async function refreshCodePreview() {
    const typeId = document.getElementById('f_type').value
    const collectionId = document.getElementById('f_collection').value
    const request = ++previewRequest
    const preview = typeId && collectionId
      ? await articleCodePreview({
          typeId,
          collectionId,
          metalId: document.getElementById('f_metal').value || null,
          materialIds: materialPicker?.getIds() || []
        }).catch(err => ({ missing: err.message, similar: [] }))
      : null
    if (request !== previewRequest) return
    lastPreview = preview

    const el1 = document.getElementById('skuPreview')
    const el2 = document.getElementById('skuPreviewStep2')
    if (!el1) return
    el1.textContent = preview?.code || '—'
    el1.classList.toggle('empty', !preview?.code)
    el2.textContent = preview?.code || preview?.missing || '—'

    // Avvisa e non blocca: possono essere modelli diversi (decisione 7)
    const similar = preview?.similar || []
    const box = document.getElementById('codeSimilar')
    box.hidden = !similar.length
    box.innerHTML = similar.length ? `
      <b>${similar.length === 1 ? 'Ce n\'è già uno' : `Ce ne sono già ${similar.length}`} con gli stessi dati.</b>
      Se è lo stesso modello, altri pezzi si aggiungono con un carico.
      <ul>${similar.map(a => `<li><a href="/article.html?id=${esc(a.id)}" target="_blank" rel="noopener">${esc(a.sku)}</a> ${esc(a.name)}</li>`).join('')}</ul>` : ''
  }
  const updateCodePreview = debounce(refreshCodePreview, 200)

  materialPicker = initMaterialPicker(document.getElementById('f_materials'), materials, [], updateCodePreview)
  metalWeight = initMetalWeight({
    select: document.getElementById('f_metal'),
    field: document.getElementById('f_metal_grams_field'),
    input: document.getElementById('f_metal_grams'),
    metals
  })
  for (const id of ['f_collection', 'f_type', 'f_metal']) document.getElementById(id).addEventListener('change', updateCodePreview)

  // ── Titolo: si compone da solo finché non lo si modifica a mano ──
  const titleInput = document.getElementById('f_title')
  const btnTitleAuto = document.getElementById('btnTitleAuto')
  let titleEdited = false

  function autoTitle() {
    const selText = id => {
      const sel = document.getElementById(id)
      return sel.value ? sel.options[sel.selectedIndex].text : ''
    }
    const l = document.getElementById('f_length').value
    return [selText('f_type'), selText('f_collection')].filter(Boolean).join(' ') + (l ? ` ${l}cm` : '')
  }
  function updateTitle() {
    if (!titleEdited) titleInput.value = autoTitle()
  }
  titleInput.addEventListener('input', () => {
    titleEdited = titleInput.value.trim() !== autoTitle()
    btnTitleAuto.hidden = !titleEdited
  })
  btnTitleAuto.addEventListener('click', () => {
    titleEdited = false
    btnTitleAuto.hidden = true
    updateTitle()
    titleInput.focus()
  })
  document.getElementById('f_collection').addEventListener('change', updateTitle)
  document.getElementById('f_type').addEventListener('change', updateTitle)
  document.getElementById('f_length').addEventListener('input', updateTitle)

  // ── Nuova collezione senza uscire dall'inserimento articolo ──
  // Si salva subito con il suo pulsante e viene selezionata: al salvataggio l'articolo la trova già nel DB
  const collPanel = document.getElementById('newCollectionPanel')
  const newCollColor = initColorSelect(document.getElementById('f_newcoll_color'), { labelId: 'f_newcoll_color_label' })
  const btnNewColl = document.getElementById('btnNewCollectionInline')
  const isCollPanelOpen = () => collPanel.style.display !== 'none'

  function showCollectionPanel(open) {
    collPanel.style.display = open ? '' : 'none'
    btnNewColl.style.display = open ? 'none' : ''
    if (open) {
      document.getElementById('f_newcoll_name').focus()
    } else {
      document.getElementById('f_newcoll_name').value = ''
      document.getElementById('f_newcoll_code').value = ''
      newCollColor.setValue()
    }
  }

  btnNewColl.addEventListener('click', () => showCollectionPanel(true))
  document.getElementById('btnNewCollectionCancel').addEventListener('click', () => showCollectionPanel(false))
  document.getElementById('btnNewCollectionSave').addEventListener('click', async e => {
    const btn = e.currentTarget
    const name = document.getElementById('f_newcoll_name').value.trim()
    const code = document.getElementById('f_newcoll_code').value.trim().toUpperCase()
    const color = newCollColor.value
    const invalid = validateCollection({ name, code }, collections)
    if (invalid) { showToast(invalid); return }

    btn.disabled = true
    try {
      const created = await insertCollection({ name, code, color })
      collections.push(created)
      collections.sort((a, b) => a.name.localeCompare(b.name, 'it'))
      const sel = document.getElementById('f_collection')
      sel.innerHTML = collectionOptions()
      sel.value = created.id
      sel.dispatchEvent(new Event('change'))
      showCollectionPanel(false)
      showToast(`Collezione ${created.name} creata`)
      onCollectionCreatedCallback?.(created)
    } catch (err) {
      showToast('Errore durante la creazione della collezione: ' + err.message)
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('btnNext').addEventListener('click', async () => {
    if (step < 3) {
      if (step === 2) await refreshCodePreview()
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

  // Prezzi e misure in cm dello step 2: { value } oppure { error, element }
  function pricesAndSizes() {
    const field = id => document.getElementById(id)
    return {
      retail: readPrice(field('f_price_retail'), 'Prezzo retail'),
      wholesale: readPrice(field('f_price_wholesale'), 'Prezzo ingrosso'),
      width: readCm(field('f_width'), 'Larghezza'),
      length: readCm(field('f_length'), 'Lunghezza'),
      height: readCm(field('f_height'), 'Altezza'),
    }
  }

  function validateStep(s) {
    if (s === 1) {
      if (isCollPanelOpen()) { showToast('Crea la nuova collezione o annulla prima di proseguire'); return false }
      if (!document.getElementById('f_collection').value) { showToast('Seleziona una collezione'); return false }
      if (!document.getElementById('f_type').value) { showToast('Seleziona il tipo prodotto'); return false }
      if (!titleInput.value.trim()) { showToast("Inserisci il titolo dell'articolo"); titleInput.focus(); return false }
    }
    if (s === 2) {
      if (!materialPicker.getIds().length) { showToast('Aggiungi almeno un materiale'); return false }
      for (const check of [materialPicker.read(), metalWeight.read()]) {
        if (check.error) { showToast(check.error, 5000); check.element.focus(); return false }
      }
      // Una lettera che manca blocca il salvataggio: meglio dirlo subito (CD-04)
      if (lastPreview?.missing) { showToast(lastPreview.missing, 6000); return false }
      if (!document.getElementById('f_price_retail').value) { showToast('Inserisci il prezzo retail'); return false }
      for (const check of Object.values(pricesAndSizes())) {
        if (check.error) { showToast(check.error, 5000); check.element.focus(); return false }
      }
      const weightInput = document.getElementById('f_weight')
      const weight = validaPeso(weightInput.value)
      if (!weight.ok) { showToast(`Peso di un pezzo: ${weight.error}`, 5000); weightInput.focus(); return false }
    }
    return true
  }

  async function submitForm() {
    const btn = document.getElementById('btnNext')
    btn.textContent = 'Salvataggio...'
    btn.disabled = true

    try {
      const { rows: materialRows } = materialPicker.read()

      // 1. L'articolo con i suoi materiali: il codice lo assegna il server (AC-09)
      const { retail, wholesale, width, length, height } = pricesAndSizes()   // controllati allo step 2
      const measurements = {}
      if (width.value) measurements.width_cm = width.value
      if (length.value) measurements.length_cm = length.value
      if (height.value) measurements.height_cm = height.value
      measurements.weight_g = validaPeso(document.getElementById('f_weight').value).mg / 1000   // controllato allo step 2

      const article = await createArticle({
        collectionId: document.getElementById('f_collection').value,
        productTypeId: document.getElementById('f_type').value,
        name: titleInput.value.trim(),
        metalId: document.getElementById('f_metal').value || null,
        metalGrams: metalWeight.read().value,
        priceRetail: retail.value,
        priceWholesale: wholesale.value,
        notes: document.getElementById('f_notes').value.trim() || null,
        measurements: Object.keys(measurements).length ? measurements : null
      }, materialRows)

      // 2. Le foto, una alla volta: se una non si carica l'articolo resta, e la si aggiunge dalla scheda (FO-13)
      btn.textContent = 'Foto…'
      const failed = await photoUploader.uploadAll(article.id)
      if (failed.length) showToast(`Articolo creato, ma ${failed.length === 1 ? 'una foto non si è caricata' : `${failed.length} foto non si sono caricate`}: ${failed.join(', ')}. Aggiungile dalla scheda dell'articolo`)

      // 3. Close + callback
      document.getElementById('articleModal').classList.remove('open')
      if (onSuccessCallback) onSuccessCallback(article)

    } catch (e) {
      console.error(e)
      showToast('Errore durante il salvataggio: ' + e.message)
      btn.textContent = 'Salva articolo'
      btn.disabled = false
    }
  }
}
