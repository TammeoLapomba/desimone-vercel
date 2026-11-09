// js/supabase.js
// Dove sono i dati lo dice config.js: Supabase (sviluppo su Vercel) oppure il PC server della sede (WBA v0.5,
// D-1), il cui servizio risponde con SEDE. Il client è nel repository, non da internet (REQ-003).
import { createClient } from './vendor/supabase-2.117.3.mjs'
import { createSedeClient } from './sede-client.js'

export const IN_SEDE = typeof SEDE !== 'undefined'
// Nella sede con la QL-800 (installa.js --stampante): le etichette in coda le stampa il servizio (pacchetto 3.3)
export const SEDE_PRINTER = IN_SEDE && !!SEDE.stampante
export const supabase = IN_SEDE ? createSedeClient(SEDE.url) : createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Auth helpers
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    window.location.replace('/login.html')
    // Blocca l'init della pagina finché avviene il redirect
    return new Promise(() => {})
  }
  // Un account disattivato torna all'accesso subito, anche con una sessione aperta (REQ-P-09).
  // Se il database non risponde la pagina si apre comunque, e mostra il suo errore quando chiede i dati.
  await getMyAccount().catch(async err => {
    if (err.code !== ACCOUNT_DISABLED) return
    await supabase.auth.signOut()
    window.location.replace('/login.html?motivo=disattivato')
    return new Promise(() => {})
  })
  return session
}

// Chi sono adesso: ruolo e stato li dice il database, perché il token resta vecchio per ore (scheda 1.4, decisione 7).
// Una volta per pagina. role: admin, laboratorio, negozio, fiere, dev, o null senza permessi.
export const ACCOUNT_DISABLED = 'PT401'
let myAccount = null
export function getMyAccount() {
  myAccount ??= supabase.rpc('my_account').then(({ data, error }) => {
    if (error) throw error
    return data
  }).catch(err => {
    myAccount = null
    throw err
  })
  return myAccount
}

// Solo per mostrare o nascondere i comandi: le regole vere stanno nel database
export async function getMyRole() {
  try {
    return (await getMyAccount())?.role ?? null
  } catch (err) {
    console.warn('Ruolo non disponibile', err)
    return null
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = '/login.html'
}

// Solo nella sede: su Supabase la password si cambia dal pannello (scheda 1.4, decisione 9)
export async function changeMyPassword(login, password, newPassword) {
  const { error } = await supabase.auth.changePassword({ email: login, password, newPassword })
  if (error) throw error
}

// Impostazioni (scheda 1.5): dati dell'azienda, aliquote e numeri dei documenti, uguali nei due ambienti
export async function getCompanySettings() {
  const { data, error } = await supabase.from('company_settings').select('*').single()
  if (error) throw error
  return data
}

export async function saveCompanySettings(id, fields) {
  const { data, error } = await supabase.from('company_settings').update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}

// In ordine alfabetico italiano: l'ordine del database dipende dalla sua collation, diversa tra Supabase e sede
export async function getVatRates() {
  const { data, error } = await supabase.from('vat_rates').select('id, name, rate, is_default, active')
  if (error) throw error
  return data.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }))
}

export async function saveVatRate(id, name, rate) {
  const { error } = await supabase.rpc('vat_rate_save', { p_id: id ?? null, p_name: name, p_rate: rate })
  if (error) throw error
}

const vatRateCall = fn => async id => {
  const { error } = await supabase.rpc(fn, { p_id: id })
  if (error) throw error
}
export const setDefaultVatRate = vatRateCall('vat_rate_set_default')
export const archiveVatRate = vatRateCall('vat_rate_archive')
export const restoreVatRate = vatRateCall('vat_rate_restore')
export const deleteVatRate = vatRateCall('vat_rate_delete')

export async function getDocumentCounters() {
  const { data, error } = await supabase.rpc('document_counters_list')
  if (error) throw error
  return data
}

export async function raiseDocumentCounter(series, next) {
  const { error } = await supabase.rpc('document_counter_raise', { p_series: series, p_next: next })
  if (error) throw error
}

// Account (scheda 1.4): l'elenco, il ruolo e lo stato in entrambi gli ambienti; creazione e reset solo nella sede
export async function getAccounts() {
  const { data, error } = await supabase.rpc('accounts_list')
  if (error) throw error
  return data
}

export async function saveAccount(id, name, role) {
  const { error } = await supabase.rpc('account_save', { p_id: id, p_name: name, p_role: role })
  if (error) throw error
}

export async function setAccountActive(id, active) {
  const { error } = await supabase.rpc('account_set_active', { p_id: id, p_active: active })
  if (error) throw error
}

export async function createAccount({ name, username, role, password }) {
  const { error } = await supabase.rpc('account_create', { p_name: name, p_username: username, p_role: role, p_password: password })
  if (error) throw error
}

export async function resetAccountPassword(id, password) {
  const { error } = await supabase.rpc('account_reset_password', { p_id: id, p_password: password })
  if (error) throw error
}

// Query helpers
export async function getCollections() {
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, slug, channel, sort_order, code, color')
    .is('deleted_at', null)
  if (error) throw error
  // Sempre in ordine alfabetico: barra laterale e menu di scelta della collezione
  return data.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// Lo slug comincia con il codice, per restare unico anche fra collezioni con lo stesso nome
export async function insertCollection({ name, code, color }) {
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data, error } = await supabase
    .from('collections')
    .insert({ name, slug: `${code.toLowerCase()}-${baseSlug}`, code, color })
    .select('id, name, slug, channel, sort_order, code, color')
    .single()
  if (error) throw error
  return data
}

// Voci da proporre: quelle attive, più quelle archiviate che l'articolo aperto usa già (AN-08)
const activeOr = keepIds => keepIds.length ? `active.eq.true,id.in.(${keepIds.join(',')})` : 'active.eq.true'

export async function getMaterials(keepIds = []) {
  const { data, error } = await supabase
    .from('materials')
    .select('id, name, code, has_pieces, has_carats, has_size, has_grams')
    .or(activeOr(keepIds))
    .order('name')
  if (error) throw error
  return data
}

export async function getMetals(keepIds = []) {
  const { data, error } = await supabase
    .from('metals')
    .select('id, name, code, has_weight')
    .or(activeOr(keepIds))
    .order('name')
  if (error) throw error
  return data
}

export async function getProductTypes(keepIds = []) {
  const { data, error } = await supabase
    .from('product_types')
    .select('id, name, slug')
    .or(activeOr(keepIds))
  if (error) throw error
  return data.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// Anagrafiche (anagrafiche.html): tutte le voci di un elenco, archiviate comprese. Le scrive solo l'account dev (033).
export async function getAnagrafica(list) {
  const { data, error } = await supabase.from(list).select('*')
  if (error) throw error
  return data.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// Le voci che stanno in un codice definitivo: le loro lettere non si cambiano più (036). Set di "materials:<id>"
export async function getAnagraficaLocked() {
  const { data, error } = await supabase.rpc('anagrafica_locked')
  if (error) throw error
  return new Set(data.map(r => `${r.list}:${r.id}`))
}

// Quanti articoli usano ogni voce: { "materials:<id>": 3, … }
export async function getAnagraficaUsage() {
  const { data, error } = await supabase.rpc('anagrafica_usage')
  if (error) throw error
  return Object.fromEntries(data.map(r => [`${r.list}:${r.id}`, Number(r.articles)]))
}

export async function saveAnagrafica(list, id, fields) {
  const { error } = id
    ? await supabase.from(list).update(fields).eq('id', id)
    : await supabase.from(list).insert(fields)
  if (error) throw error
}

// Mai usata si elimina, già usata si archivia: risponde 'deleted' o 'archived'
export async function retireAnagrafica(list, id) {
  const { data, error } = await supabase.rpc('anagrafica_retire', { p_list: list, p_id: id })
  if (error) throw error
  return data
}

// A pagine (selectAll): i gioielli possono essere più di 1000, il limite di una risposta di Supabase
export async function getArticles(collectionId = null) {
  const build = () => {
    let query = supabase
      .from('articles')
      .select(`
        id, name, sku, code_origin, code_confirmed_at, product_type_id, channel,
        price_retail, price_wholesale,
        collection_id, metal_id, metal_grams, created_at,
        collections(name, slug),
        product_type:product_types(name),
        metal:metals(name, code),
        article_materials(material_id, sort_order, pieces, carats, size_mm, size2_mm, size_mode, grams, material:materials(name, code)),
        photos(id, public_url, is_cover, sort_order),
        measurements
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id')
    if (collectionId) query = query.eq('collection_id', collectionId)
    return query
  }

  const [data, stock] = await Promise.all([selectAll(build), getStockTotals('article_id')])
  return withStock(data, stock)
}

// Un gioiello nuovo: il codice lo assegna il server, provvisorio fino al primo uso (036, AC-09). Risponde l'articolo.
export async function createArticle({ collectionId, productTypeId, name, metalId, metalGrams, priceRetail, priceWholesale, notes, measurements }, rows) {
  const { data, error } = await supabase.rpc('create_article', {
    p_collection_id: collectionId,
    p_product_type_id: productTypeId,
    p_name: name,
    p_rows: rows,
    p_metal_id: metalId ?? null,
    p_metal_grams: metalGrams ?? null,
    p_price_retail: priceRetail ?? null,
    p_price_wholesale: priceWholesale ?? null,
    p_notes: notes ?? null,
    p_measurements: measurements ?? null
  })
  if (error) throw error
  return data
}

// Il codice che avrebbe un gioiello con questi dati e i modelli uguali (CD-13): { code, parts, similar } oppure { missing }
export async function articleCodePreview({ typeId, collectionId, metalId, materialIds }) {
  const { data, error } = await supabase.rpc('article_code_preview', {
    p_type: typeId,
    p_collection: collectionId,
    p_metal: metalId ?? null,
    p_materials: materialIds
  })
  if (error) throw error
  return data
}

// Per la schermata di controllo (REQ-A-09): il codice spiegato e i dati dell'articolo. explain è null se è già confermato.
export async function getCodeCheck({ kind, id }) {
  const isJewel = kind === 'montato'
  const [explain, details] = await Promise.all([
    isJewel
      ? supabase.rpc('article_code_explain', { p_article_id: id })
      : supabase.rpc('raw_code_explain', { p_raw_item_id: id }),
    isJewel
      ? supabase.from('articles')
        .select('name, price_retail, metal_grams, measurements, collections(name), product_type:product_types(name), metal:metals(name), article_materials(material_id, sort_order, pieces, carats, size_mm, size2_mm, size_mode, grams, material:materials(name)), photos(public_url, is_cover)')
        .eq('id', id).single()
      : supabase.from('raw_items').select('description, size, unit, raw_photos(public_url, is_cover)').eq('id', id).single()
  ])
  if (explain.error) throw explain.error
  if (details.error) throw details.error
  return { explain: explain.data?.provisional ? explain.data : null, details: details.data }
}

export async function updateArticle(id, fields) {
  const { data, error } = await supabase
    .from('articles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getArticleById(id) {
  const { data, error } = await supabase
    .from('articles')
    .select(`
      *,
      collections(name, slug),
      article_materials(id, material_id, sort_order, pieces, carats, size_mm, size2_mm, size_mode, grams)
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error) throw error
  return data
}

// Righe dei materiali dell'articolo con i loro valori (035), nell'ordine dato. Un codice provvisorio le segue (036)
export async function setArticleMaterials(articleId, rows) {
  const { error } = await supabase.rpc('set_article_materials', {
    p_article_id: articleId,
    p_rows: rows
  })
  if (error) throw error
}

// Cosa succederebbe togliendo un articolo (030): { action: 'delete' | 'archive' | 'blocked', stock }
export async function retirePreview({ articleId = null, rawItemId = null }) {
  const { data, error } = await supabase.rpc('retire_preview', { p_article_id: articleId, p_raw_item_id: rawItemId })
  if (error) throw error
  return data
}

// Solo admin: elimina l'articolo se non è mai stato usato, altrimenti lo archivia. Risponde 'deleted' o 'archived'
export async function retireItem({ articleId = null, rawItemId = null }) {
  const { data, error } = await supabase.rpc('retire_item', { p_article_id: articleId, p_raw_item_id: rawItemId })
  if (error) throw error
  await removePhotoFiles(data.paths)
  return data.action
}

// Solo admin: riattiva un articolo archiviato, con il suo codice
export async function restoreItem({ articleId = null, rawItemId = null }) {
  const { error } = await supabase.rpc('restore_item', { p_article_id: articleId, p_raw_item_id: rawItemId })
  if (error) throw error
}

// Articoli archiviati, dal più recente: gioielli e semilavorati insieme
export async function getArchivedItems() {
  const [art, raw] = await Promise.all([
    supabase.from('articles').select('id, sku, name, deleted_at').not('deleted_at', 'is', null),
    supabase.from('raw_items').select('id, sku, description, deleted_at').not('deleted_at', 'is', null),
  ])
  if (art.error) throw art.error
  if (raw.error) throw raw.error
  return [
    ...art.data.map(a => ({ articleId: a.id, code: a.sku, name: a.name, archivedAt: a.deleted_at })),
    ...raw.data.map(r => ({ rawItemId: r.id, code: r.sku, name: r.description, archivedAt: r.deleted_at })),
  ].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
}

// Solo admin: ogni articolo della collezione con la sua regola, poi la collezione. Risponde { action, deleted, archived }
export async function deleteCollection(id) {
  const { data, error } = await supabase.rpc('delete_collection', { p_collection_id: id })
  if (error) throw error
  await removePhotoFiles(data.paths)
  return data
}

// I file si tolgono dopo il DB: se non ci si riesce, i dati restano comunque eliminati
async function removePhotoFiles(paths) {
  if (!paths?.length) return
  const { error } = await supabase.storage.from('photos').remove(paths)
  if (error) console.warn('File delle foto non rimossi dallo Storage:', error.message, paths)
}

// crypto.randomUUID esiste solo in HTTPS o su localhost: dai tablet della sede (http://192.168.…:8080) manca
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40   // UUID v4, come randomUUID
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function uploadPhoto(file, articleId) {
  const ext = file.name.split('.').pop()
  const path = `raw/${articleId}/${newId()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)

  const { data, error } = await supabase
    .from('photos')
    .insert({
      article_id: articleId,
      storage_path: path,
      public_url: publicUrl,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Semilavorato helpers ──────────────────────────────────────────

export async function getRawCategories() {
  const { data, error } = await supabase
    .from('raw_categories')
    .select('id, name, slug, sort_order')
    .is('deleted_at', null)
    .order('sort_order')
  if (error) throw error
  return data
}

export async function getRawItems(categoryId = null) {
  // A pagine da 1000 (il limite di una singola risposta): il catalogo ha già centinaia di articoli
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from('raw_items')
      .select('*, raw_categories(name, slug), raw_shapes(name, slug), coral:materials(id, name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
    if (categoryId) query = query.eq('category_id', categoryId)
    const { data, error } = await query
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) break
  }
  return withStock(all, await getStockTotals('raw_item_id'))
}

// Regole dei codici: forme, gruppi e varianti (tabelle di 019_semilavorato_codici.sql)
export async function getRawCodeRules() {
  const [shapes, groups, variants] = await Promise.all([
    supabase.from('raw_shapes').select('*').order('sort_order'),
    supabase.from('raw_code_groups').select('*').order('sort_order'),
    supabase.from('raw_variants').select('*').order('sort_order'),
  ])
  for (const r of [shapes, groups, variants]) if (r.error) throw r.error
  return { shapes: shapes.data, groups: groups.data, variants: variants.data }
}

// Anteprima del codice dai campi scelti: la stessa funzione del database che lo assegna al salvataggio.
// Risponde { sku, description, size_label, group_code, existing } oppure lancia l'errore (es. combinazione non prevista).
export async function previewRawItem(f) {
  const { data, error } = await supabase.rpc('raw_item_preview', {
    p_shape_id:  f.shape_id,
    p_is_tall:   !!f.is_tall,
    p_quality:   f.quality,
    p_finish:    f.finish || '',
    p_size_from: f.size_from_mm ?? null,
    p_size_to:   f.size_to_mm ?? null,
    p_base:      f.base_mm ?? null,
    p_height:    f.height_mm ?? null,
    p_length_cm: f.length_cm ?? null,
    p_variants:  f.variants || [],
  })
  if (error) throw error
  return data
}

// La scheda di un gioiello (2.4): anche archiviato, che il database fa leggere a chi ha fatto l'accesso
export async function getArticleCard(id) {
  const { data, error } = await supabase
    .from('articles')
    .select(`*, collections(name), product_type:product_types(name), metal:metals(name),
      article_materials(material_id, sort_order, pieces, carats, size_mm, size2_mm, size_mode, grams, material:materials(name)),
      photos(public_url, is_cover, sort_order)`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// La scheda di un semilavorato (2.4)
export async function getRawItemCard(id) {
  const { data, error } = await supabase
    .from('raw_items')
    .select('*, raw_categories(name, slug), raw_shapes(name, slug), coral:materials(id, name), raw_photos(public_url, is_cover, sort_order)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// Le modifiche di un articolo, campo per campo: solo l'amministrazione (044, SC-06)
export async function getItemChanges({ articleId = null, rawItemId = null, limit = 100 }) {
  const { data, error } = await supabase.rpc('item_changes', { p_article_id: articleId, p_raw_item_id: rawItemId, p_limit: limit })
  if (error) throw error
  return data
}

// Un tipo nuovo: solo l'amministrazione (042, RS-07)
export async function createRawCategory(name) {
  const { data, error } = await supabase.rpc('create_raw_category', { p_name: name })
  if (error) throw error
  return data
}

// I coralli delle Anagrafiche, per il campo Corallo di un semilavorato (042, RS-09). Anche gli archiviati, per chi li ha già
export async function getCorals() {
  const { data, error } = await supabase
    .from('materials')
    .select('id, name, active')
    .eq('has_color', true)
    .order('name')
  if (error) throw error
  return data
}

// Dopo il primo movimento l'unità di misura non si cambia più (022)
export async function hasRawMovements(rawItemId) {
  const { data, error } = await supabase.from('movements').select('id').eq('raw_item_id', rawItemId).limit(1)
  if (error) throw error
  return data.length > 0
}

export async function insertRawItem(fields) {
  const { data, error } = await supabase
    .from('raw_items')
    .insert(fields)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRawItem(id, fields) {
  const { data, error } = await supabase
    .from('raw_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Copertina e posto le assegna il database (039): la prima foto è la copertina, le altre vanno in fondo
export async function uploadRawPhoto(file, rawItemId) {
  const ext = file.name.split('.').pop()
  const path = `raw-items/${rawItemId}/${newId()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)

  const { data, error } = await supabase
    .from('raw_photos')
    .insert({ raw_item_id: rawItemId, storage_path: path, public_url: publicUrl })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getRawItemPhotos(rawItemId) {
  const { data, error } = await supabase
    .from('raw_photos')
    .select('*')
    .eq('raw_item_id', rawItemId)
    .order('sort_order')
  if (error) throw error
  return data
}

// Galleria (scheda 1.6): kind è 'article' o 'raw'
export async function getArticlePhotos(articleId) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('article_id', articleId)
    .order('sort_order')
  if (error) throw error
  return data
}

export async function setPhotoCover(kind, id) {
  const { error } = await supabase.rpc('photo_set_cover', { p_kind: kind, p_id: id })
  if (error) throw error
}

export async function reorderPhotos(kind, ownerId, ids) {
  const { error } = await supabase.rpc('photos_reorder', { p_kind: kind, p_owner: ownerId, p_ids: ids })
  if (error) throw error
}

// Prima la riga, poi il file: se il file resta, non lo vede nessuno. La copertina la sposta il database
export async function removePhoto(kind, photo) {
  const { data, error } = await supabase.from(kind === 'raw' ? 'raw_photos' : 'photos').delete().eq('id', photo.id).select('id')
  if (error) throw error
  if (!data.length) throw new Error('Solo l\'amministrazione toglie le foto')
  await removePhotoFiles([photo.storage_path])
}

// ── Movimenti (migrazioni 022–023) ────────────────────────────────
// Tutto passa da qui: nella sede (D-1) le stesse chiamate andranno a PostgREST tramite il servizio.

// Chi sono, con il ruolo dei movimenti e il luogo proposto (REQ-B-05); null se non sono un operatore
export async function getMyOperator() {
  const { data, error } = await supabase.rpc('my_operator')
  if (error) throw error
  return data
}

// Anagrafiche del registro: luoghi, causali, dispositivi, bilance, operatori. Luoghi, causali e dispositivi
// in ordine alfabetico italiano: l'ordine del database dipende dalla sua collation, diversa tra Supabase e sede.
export async function getMovementSetup() {
  const [locations, reasons, devices, scales, operators] = await Promise.all([
    supabase.from('locations').select('id, name, kind, active'),
    supabase.from('movement_reasons').select('id, code, name, movement_type, category, allowed_roles, system, active, sort_order'),
    supabase.from('devices').select('id, code, name, kind, revoked_at'),
    supabase.from('scales').select('id, name, model, serial_number, device_id, active'),
    supabase.from('operators').select('id, name, role'),
  ])
  for (const r of [locations, reasons, devices, scales, operators]) if (r.error) throw r.error
  const byText = key => (a, b) => a[key].localeCompare(b[key], 'it', { numeric: true })
  return {
    locations: locations.data.sort(byText('name')),
    reasons: reasons.data.sort(byText('name')),
    devices: devices.data.sort(byText('code')),
    scales: scales.data,
    operators: operators.data,
  }
}

// Articoli che si possono movimentare: gioielli (montato) e semilavorati, con quanto serve a cercarli.
// Tutti e due a pagine: un gioiello oltre il millesimo non si troverebbe né col lettore né con la ricerca.
export async function getMovableItems() {
  const [articles, raw] = await Promise.all([
    selectAll(() => supabase.from('articles')
      .select('id, sku, code_confirmed_at, name, price_retail, measurements, collection_id, collections(name), product_type:product_types(name), article_materials(material:materials(name))')
      .is('deleted_at', null).order('id')),
    selectAll(() => supabase.from('raw_items')
      .select('id, sku, code_confirmed_at, description, size, quality, unit, category_id, raw_categories(name), raw_shapes(name)')
      .is('deleted_at', null).order('id')),
  ])
  return { articles, raw }
}

// Tutta la giacenza in una risposta sola (027): a pagine, ogni pagina ricalcolava l'intera vista stock_levels.
// column 'article_id' o 'raw_item_id' per i soli gioielli o semilavorati, null per tutto.
async function getStockLevels(column = null) {
  const { data, error } = await supabase.rpc('stock_levels_all', { p_column: column })
  if (error) throw error
  return data
}

// Giacenza di tutti i gioielli (column 'article_id') o di tutti i semilavorati ('raw_item_id'): la somma dei
// movimenti, l'unica giacenza (REQ-001.1, C-01). Risponde Map id → { pieces, grams, locations: [{ name, pieces, grams }] }; vuota per chi non è
// un operatore, che il registro non lo legge.
export async function getStockTotals(column) {
  const [{ data: locations, error: locError }, rows] = await Promise.all([
    supabase.from('locations').select('id, name'),
    getStockLevels(column),
  ])
  if (locError) throw locError
  const names = new Map(locations.map(l => [l.id, l.name]))
  const totals = new Map()
  for (const r of rows) {
    const t = totals.get(r[column]) || { pieces: 0, grams: 0, locations: [] }
    t.pieces += r.pieces
    t.grams += Number(r.grams)
    if (r.pieces || Number(r.grams)) t.locations.push({ id: r.location_id, name: names.get(r.location_id) || '—', pieces: r.pieces, grams: Number(r.grams) })
    totals.set(r[column], t)
  }
  return totals
}

// Aggiunge a ogni articolo stock (pezzi), stock_grams e stock_locations dalla giacenza dei movimenti
function withStock(items, totals) {
  return items.map(i => {
    const t = totals.get(i.id)
    return { ...i, stock: t?.pieces ?? 0, stock_grams: Math.round((t?.grams ?? 0) * 10) / 10, stock_locations: t?.locations ?? [] }
  })
}

// Tutte le righe di una richiesta, a pagine da 1000 (il limite di una singola risposta)
async function selectAll(build) {
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

// Schermata Giacenze (UC-01, UC-10, UC-14): gioielli con i prezzi, semilavorati con l'unità e la giacenza di
// ogni articolo in ogni luogo, come somma dei movimenti (REQ-001.1, C-01)
export async function getStockOverview() {
  const [articles, raw, stock] = await Promise.all([
    selectAll(() => supabase.from('articles')
      .select('id, sku, name, price_retail, price_wholesale, collections(name), product_type:product_types(name), metal:metals(name), article_materials(material:materials(name))')
      .is('deleted_at', null).order('sku').order('id')),
    selectAll(() => supabase.from('raw_items')
      .select('id, sku, description, size, unit, quality, raw_categories(name), raw_shapes(name), coral:materials(name)')
      .is('deleted_at', null).order('sku').order('id')),
    getStockLevels(),
  ])
  return { articles, raw, stock }
}

// Per ogni luogo, quanti articoli ci hanno giacenza (scheda Luoghi)
export async function getLocationHolding() {
  const holding = new Map()
  for (const s of await getStockLevels()) {
    if (s.pieces !== 0 || Math.abs(Number(s.grams)) >= 0.05) holding.set(s.location_id, (holding.get(s.location_id) || 0) + 1)
  }
  return holding
}

// Nuovo luogo della sede (UC-11, REQ-M-07). Le fiere nascono col loro ciclo (UC-12)
export async function insertLocation(name) {
  const { data, error } = await supabase.from('locations').insert({ name, kind: 'sede' }).select().single()
  if (error) throw error
  return data
}

// Revoca di un dispositivo (UC-13, REQ-S-01): da qui in poi il registro rifiuta i suoi movimenti (S-02, S-03)
export async function revokeDevice(id) {
  const { data, error } = await supabase.from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id).is('revoked_at', null)
    .select().single()
  if (error) throw error
  return data
}

// Copia di sicurezza notturna (7.2, REQ-I-02): solo nella sede e solo per l'amministrazione; su Vercel la fa Supabase
export const getBackupStatus = () => IN_SEDE ? supabase.backup.stato() : Promise.resolve(null)
export const startBackup = () => supabase.backup.adesso()

// Giacenza dell'articolo in ogni luogo (REQ-001.1)
export async function getItemStock({ articleId = null, rawItemId = null }) {
  let query = supabase.from('stock_levels').select('location_id, pieces, grams')
  query = articleId ? query.eq('article_id', articleId) : query.eq('raw_item_id', rawItemId)
  const { data, error } = await query
  if (error) throw error
  return data
}

// Storico con la giacenza dopo ogni movimento (REQ-M-01, M-22), dal più recente, con i dati del movimento
export async function getItemHistory({ articleId = null, rawItemId = null }) {
  let query = supabase
    .from('movement_history')
    .select('movement_id, code, movement_type, location_id, pieces, grams, occurred_at, cancelled, pieces_after, grams_after')
    .order('occurred_at', { ascending: false })
    .order('recorded_at', { ascending: false })
  query = articleId ? query.eq('article_id', articleId) : query.eq('raw_item_id', rawItemId)
  const { data: legs, error } = await query
  if (error) throw error
  const ids = [...new Set(legs.map(l => l.movement_id))]
  if (!ids.length) return []
  const { data: movements, error: movError } = await supabase
    .from('movements')
    .select('id, from_location_id, to_location_id, reason_id, operator_id, device_id, note, document_ref, weight_source, scale_id, sale_price, parent_id, cancelled_at, cancel_reason')
    .in('id', ids)
  if (movError) throw movError
  const byId = new Map(movements.map(m => [m.id, m]))
  return legs.map(l => ({ ...l, movement: byId.get(l.movement_id) }))
}

// Registro dei movimenti (UC-02, REQ-M-01): dal più recente, una pagina alla volta. I filtri li applica il database,
// perché i movimenti arrivano al milione (§5.3 dell'analisi): { type, reasonIds, locationId (Da o A), operatorId,
// since, until (ISO), articleId, rawItemId, withCancelled }
export async function getMovements(f = {}, { offset = 0, limit = 100 } = {}) {
  let query = supabase
    .from('movements')
    .select(`id, code, movement_type, occurred_at, article_id, raw_item_id, from_location_id, to_location_id,
      pieces, grams, weight_source, reason_id, sale_price, note, document_ref, operator_id, parent_id, cancelled_at, cancel_reason,
      article:articles(sku, name, deleted_at), raw_item:raw_items(sku, description, deleted_at)`)
    .order('occurred_at', { ascending: false })
    .order('id')
  if (f.type) query = query.eq('movement_type', f.type)
  if (f.reasonIds?.length) query = query.in('reason_id', f.reasonIds)
  if (f.locationId) query = query.or(`from_location_id.eq.${f.locationId},to_location_id.eq.${f.locationId}`)
  if (f.operatorId) query = query.eq('operator_id', f.operatorId)
  if (f.since) query = query.gte('occurred_at', f.since)
  if (f.until) query = query.lt('occurred_at', f.until)
  if (f.articleId) query = query.eq('article_id', f.articleId)
  if (f.rawItemId) query = query.eq('raw_item_id', f.rawItemId)
  if (!f.withCancelled) query = query.is('cancelled_at', null)
  const { data, error } = await query.range(offset, offset + limit - 1)
  if (error) throw error
  return data
}

// Che cosa è stato letto (scheda 3.1): il codice di un articolo, un vecchio QR di STEP (…$protocollo) o un protocollo
// scritto a mano. La regola è una sola, nel database (043). Risponde { kind, id, code, name, unit, archived, via }, con via
// 'codice', 'legacy' o 'protocollo'; null se il codice è sconosciuto (REQ-B-02)
export async function readCode(text) {
  const { data, error } = await supabase.rpc('read_code', { p_text: text })
  if (error) throw error
  return data?.[0] || null
}

// Giacenza di un articolo in ogni luogo, col nome del luogo: [{ name, pieces, grams }], dal luogo con più merce
export async function getItemStockByPlace(item) {
  const [levels, places] = await Promise.all([
    getItemStock(item),
    supabase.from('locations').select('id, name'),
  ])
  if (places.error) throw places.error
  const names = new Map(places.data.map(l => [l.id, l.name]))
  return levels
    .filter(l => Number(l.pieces) || Number(l.grams))
    .map(l => ({ name: names.get(l.location_id) || '—', pieces: Number(l.pieces) || 0, grams: Number(l.grams) || 0 }))
    .sort((a, b) => b.pieces - a.pieces || b.grams - a.grams || a.name.localeCompare(b.name))
}

// Gioiello o semilavorato con esattamente questo codice, anche archiviato (archived: true); null se non c'è
export async function findItemByCode(code) {
  const [art, raw] = await Promise.all([
    supabase.from('articles').select('id, sku, name, deleted_at').eq('sku', code).limit(1),
    supabase.from('raw_items').select('id, sku, description, deleted_at').eq('sku', code).limit(1),
  ])
  if (art.error) throw art.error
  if (raw.error) throw raw.error
  const a = art.data[0], r = raw.data[0]
  if (a) return { kind: 'montato', id: a.id, code: a.sku, name: a.name, archived: !!a.deleted_at }
  if (r) return { kind: 'semilavorato', id: r.id, code: r.sku, name: r.description, archived: !!r.deleted_at }
  return null
}

// Registra un movimento (REQ-E-10, E-11): il codice nasce sul dispositivo e una richiesta ripetuta
// restituisce il movimento già registrato. Nelle vendite serve il prezzo totale (026).
// Risponde { duplicate, movement, from_stock, to_stock, weighing_difference }.
export async function registerMovement(p) {
  const { data, error } = await supabase.rpc('register_movement', {
    p_code: p.code,
    p_movement_type: p.type,
    p_reason_id: p.reasonId,
    p_device_id: p.deviceId,
    p_occurred_at: p.occurredAt,
    p_article_id: p.articleId ?? null,
    p_raw_item_id: p.rawItemId ?? null,
    p_from_location_id: p.fromId ?? null,
    p_to_location_id: p.toId ?? null,
    p_pieces: p.pieces ?? null,
    p_grams: p.grams ?? null,
    p_weight_source: p.weightSource ?? null,
    p_scale_id: p.scaleId ?? null,
    p_last: !!p.last,
    p_note: p.note || null,
    p_document_ref: p.documentRef || null,
    p_shown_stock: p.shownStock ?? null,
    p_confirm_code: p.confirmCode ?? null,
    p_sale_price: p.salePrice ?? null,
  })
  if (error) throw error
  return data
}

// Annulla un movimento con motivo: solo l'amministrazione (REQ-M-06, M-13)
export async function cancelMovement(id, reason) {
  const { data, error } = await supabase.rpc('cancel_movement', { p_movement_id: id, p_reason: reason })
  if (error) throw error
  return data
}

// ── Conte e rettifiche (041, scheda 2.1) ──────────────────────────
// Contano tutti gli operatori; differenze e conferma solo l'amministrazione. Le regole le decide il database.

// Le conte, dalla più recente. status: 'aperta', 'confermata', 'buttata' o null per tutte
export async function getStockCounts({ status = null, limit = 50 } = {}) {
  let query = supabase.from('stock_counts')
    .select('id, year, number, location_id, family, category_id, complete, quick, status, opened_by, opened_at, closed_by, closed_at')
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return data
}

// Una conta e le sue righe: articolo, pezzi e peso contati, chi e quando. Quanto risultava non serve a chi conta
export async function getStockCount(id) {
  const [count, lines] = await Promise.all([
    supabase.from('stock_counts')
      .select('id, year, number, location_id, family, category_id, complete, quick, status, opened_by, opened_at, closed_by, closed_at')
      .eq('id', id).maybeSingle(),
    supabase.from('stock_count_lines')
      .select('id, article_id, raw_item_id, pieces, grams, weight_source, scale_id, counted_by, counted_at')
      .eq('count_id', id).order('counted_at', { ascending: false }),
  ])
  if (count.error) throw count.error
  if (lines.error) throw lines.error
  return count.data ? { ...count.data, lines: lines.data } : null
}

export async function openStockCount({ locationId, family, categoryId = null, complete = false }) {
  const { data, error } = await supabase.rpc('stock_count_open', {
    p_location_id: locationId, p_family: family, p_category_id: categoryId, p_complete: complete,
  })
  if (error) throw error
  return data
}

// add: una lettura del codice, un pezzo in più (REQ-B-03). Altrimenti pezzi e peso si scrivono come sono (REQ-B-04)
export async function setStockCountLine({ countId, articleId = null, rawItemId = null, pieces = null, grams = null,
  weightSource = null, scaleId = null, add = false }) {
  const { data, error } = await supabase.rpc('stock_count_set', {
    p_count_id: countId, p_article_id: articleId, p_raw_item_id: rawItemId, p_pieces: pieces, p_grams: grams,
    p_weight_source: weightSource, p_scale_id: scaleId, p_add: add,
  })
  if (error) throw error
  return data
}

export async function removeStockCountLine(lineId) {
  const { error } = await supabase.rpc('stock_count_remove_line', { p_line_id: lineId })
  if (error) throw error
}

export async function discardStockCount(id) {
  const { error } = await supabase.rpc('stock_count_discard', { p_count_id: id })
  if (error) throw error
}

// Contato, quanto risultava quando si è contato, giacenza di adesso, differenza e cosa ferma la conferma
export async function getStockCountSummary(id) {
  const { data, error } = await supabase.rpc('stock_count_summary', { p_count_id: id })
  if (error) throw error
  return data
}

// Risponde { duplicate, label, movements }: una conferma ripetuta restituisce quella di prima (REQ-E-11)
export async function confirmStockCount(id, deviceId) {
  const { data, error } = await supabase.rpc('stock_count_confirm', { p_count_id: id, p_device_id: deviceId })
  if (error) throw error
  return data
}

// "Correggi la giacenza" di un articolo in un luogo: una conta di un articolo, confermata subito
export async function correctStock({ locationId, articleId = null, rawItemId = null, deviceId, pieces = null, grams = null,
  weightSource = null, scaleId = null }) {
  const { data, error } = await supabase.rpc('stock_count_quick', {
    p_location_id: locationId, p_article_id: articleId, p_raw_item_id: rawItemId, p_device_id: deviceId,
    p_pieces: pieces, p_grams: grams, p_weight_source: weightSource, p_scale_id: scaleId,
  })
  if (error) throw error
  return data
}

// Nuovo dispositivo, solo l'amministrazione (REQ-D-04). kind: 'pc' (pistola) o 'mobile' (tablet o telefono, 034)
export async function insertDevice({ code, name, kind = 'pc' }) {
  const { data, error } = await supabase.from('devices').insert({ code, name, kind }).select().single()
  if (error) throw error
  return data
}

// Tipo di un dispositivo già registrato, solo l'amministrazione (034)
export async function setDeviceKind(id, kind) {
  const { data, error } = await supabase.from('devices').update({ kind }).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Bilancia collegata a un dispositivo (CR7), solo l'amministrazione: kind è 'nessuna', 'cavo' o 'simulata'
export async function setDeviceScale(device, kind, simulatedModel) {
  const { error: offError } = await supabase.from('scales').update({ active: false }).eq('device_id', device.id).eq('active', true)
  if (offError) throw offError
  if (kind === 'nessuna') return null
  const fields = kind === 'simulata'
    ? { name: `Bilancia simulata ${device.code}`, model: simulatedModel }
    : { name: `Bilancia di ${device.code}`, model: 'Mettler Toledo MT-SICS via cavo' }
  const { data, error } = await supabase
    .from('scales')
    .upsert({ ...fields, device_id: device.id, active: true }, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Etichette (scheda 3.2, migrazione 045) ───────────────────

// Chiede un'etichetta: va in coda con ciò che si stampa (REQ-I-01). La prima conferma il codice (confirmCode)
export async function requestLabel(p) {
  const { data, error } = await supabase.rpc('print_request', {
    p_article_id: p.articleId ?? null,
    p_raw_item_id: p.rawItemId ?? null,
    p_copies: p.copies,
    p_name: p.name,
    p_lines: p.lines ?? [],
    p_price: p.price ?? null,
    p_source: p.source,
    p_movement_id: p.movementId ?? null,
    p_reprint_of: p.reprintOf ?? null,
    p_confirm_code: p.confirmCode ?? null,
    p_weight_g: p.weight ?? null,
  })
  if (error) throw error
  return data
}

// stampata, errore (con il motivo), annullata, oppure in_coda per riprovare dopo un errore
export async function setLabelStatus(id, status, error = null) {
  const { data, error: err } = await supabase.rpc('print_set_status', { p_id: id, p_status: status, p_error: error })
  if (err) throw err
  return data
}

// Coda (in_coda, errore) o archivio (stampata, annullata), dalla più recente. search cerca nel codice e nel nome
export async function getLabels({ archive = false, search = '', offset = 0, limit = 50 } = {}) {
  let query = supabase.from('print_jobs')
    .select('*')
    .in('status', archive ? ['stampata', 'annullata'] : ['in_coda', 'in_stampa', 'errore'])
    .order('requested_at', { ascending: !archive })
  const s = search.trim().replace(/[,()*%]/g, ' ').trim()
  if (s) query = query.or(`code.ilike.*${s}*,name.ilike.*${s}*`)
  const { data, error } = await query.range(offset, offset + limit - 1)
  if (error) throw error
  return data
}
