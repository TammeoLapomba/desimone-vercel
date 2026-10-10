// js/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Auth helpers
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    window.location.replace('/login.html')
    // Blocca l'init della pagina finché avviene il redirect
    return new Promise(() => {})
  }
  return session
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

// Query helpers
export async function getCollections() {
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, slug, channel, sort_order, description_it, description_en')
    .is('deleted_at', null)
  if (error) throw error
  // Sempre in ordine alfabetico: barra laterale e menu di scelta della collezione
  return data.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// Il codice di 4 lettere va in description_it e il colore del pallino in description_en
export async function insertCollection({ name, code, color }) {
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data, error } = await supabase
    .from('collections')
    .insert({ name, slug: `${code.toLowerCase()}-${baseSlug}`, description_it: code, description_en: color })
    .select('id, name, slug, channel, sort_order, description_it, description_en')
    .single()
  if (error) throw error
  return data
}

export async function getMaterials() {
  const { data, error } = await supabase
    .from('materials')
    .select('id, name, code')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data
}

export async function getMetals() {
  const { data, error } = await supabase
    .from('metals')
    .select('id, name, code')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data
}

export async function getProductTypes() {
  const { data, error } = await supabase
    .from('product_types')
    .select('id, name, slug')
    .eq('active', true)
    .order('sort_order')
  if (error) throw error
  return data
}

export async function getArticles(collectionId = null) {
  let query = supabase
    .from('articles')
    .select(`
      id, name, sku, product_type_id, channel,
      price_retail, price_wholesale,
      collection_id, metal_id, created_at,
      collections(name, slug),
      product_type:product_types(name),
      metal:metals(name, code),
      article_materials(material_id, sort_order, material:materials(name, code)),
      photos(id, public_url, is_cover, photo_type, sort_order),
      measurements
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (collectionId) query = query.eq('collection_id', collectionId)

  const [{ data, error }, stock] = await Promise.all([query, getStockTotals('article_id')])
  if (error) throw error
  return withStock(data, stock)
}

export async function insertArticle(fields) {
  const { data, error } = await supabase
    .from('articles')
    .insert(fields)
    .select()
    .single()
  if (error) throw error
  return data
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
      article_materials(material_id, sort_order)
    `)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// Elenco completo dei materiali dell'articolo, nell'ordine dato (il primo entra nello SKU dell'app)
export async function setArticleMaterials(articleId, materialIds) {
  const { error } = await supabase.rpc('set_article_materials', {
    p_article_id: articleId,
    p_material_ids: materialIds
  })
  if (error) throw error
}

// Eliminazione definitiva (solo admin): articolo, foto, materiali e movimenti
export async function deleteArticle(id) {
  const { data: paths, error } = await supabase.rpc('delete_article', { p_article_id: id })
  if (error) throw error
  await removePhotoFiles(paths)
}

// Eliminazione definitiva (solo admin): prima tutti gli articoli della collezione, poi la collezione
export async function deleteCollection(id) {
  const { data: paths, error } = await supabase.rpc('delete_collection', { p_collection_id: id })
  if (error) throw error
  await removePhotoFiles(paths)
}

// I file si tolgono dopo il DB: se non ci si riesce, i dati restano comunque eliminati
async function removePhotoFiles(paths) {
  if (!paths?.length) return
  const { error } = await supabase.storage.from('photos').remove(paths)
  if (error) console.warn('File delle foto non rimossi dallo Storage:', error.message, paths)
}

export async function uploadPhoto(file, articleId) {
  const ext = file.name.split('.').pop()
  const path = `raw/${articleId}/${crypto.randomUUID()}.${ext}`
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
      photo_type: 'raw',
      processing_status: 'pending'
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
      .select('*, raw_categories(name, slug), raw_shapes(name, slug)')
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

export async function insertRawCategory(fields) {
  const { data, error } = await supabase
    .from('raw_categories')
    .insert(fields)
    .select()
    .single()
  if (error) throw error
  return data
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

export async function deleteRawCategory(id) {
  const delDate = new Date().toISOString()
  // Soft-delete anche tutti i raw_items della categoria
  await supabase.from('raw_items').update({ deleted_at: delDate }).eq('category_id', id)
  const { error } = await supabase.from('raw_categories').update({ deleted_at: delDate }).eq('id', id)
  if (error) throw error
}

export async function uploadRawPhoto(file, rawItemId, setCover = false) {
  const ext = file.name.split('.').pop()
  const path = `raw-items/${rawItemId}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)

  const { data, error } = await supabase
    .from('raw_photos')
    .insert({ raw_item_id: rawItemId, storage_path: path, public_url: publicUrl, is_cover: setCover })
    .select()
    .single()
  if (error) throw error

  // Aggiorna cover_url sul raw_item se è la prima foto / cover
  if (setCover) {
    await supabase.from('raw_items').update({ cover_url: publicUrl }).eq('id', rawItemId)
  }

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

// ── Movimenti (migrazioni 022–023) ────────────────────────────────
// Tutto passa da qui: nella sede (D-1) le stesse chiamate andranno a PostgREST tramite il servizio.

// Chi sono, con il ruolo dei movimenti e il luogo proposto (REQ-B-05); null se non sono un operatore
export async function getMyOperator() {
  const { data, error } = await supabase.rpc('my_operator')
  if (error) throw error
  return data
}

// Anagrafiche del registro: luoghi, causali, dispositivi, bilance, operatori
export async function getMovementSetup() {
  const [locations, reasons, devices, scales, operators] = await Promise.all([
    supabase.from('locations').select('id, name, kind, active').order('name'),
    supabase.from('movement_reasons').select('id, code, name, movement_type, allowed_roles, system, active, sort_order').order('sort_order'),
    supabase.from('devices').select('id, code, name, revoked_at').order('code'),
    supabase.from('scales').select('id, name, model, serial_number, device_id, active'),
    supabase.from('operators').select('id, name, role'),
  ])
  for (const r of [locations, reasons, devices, scales, operators]) if (r.error) throw r.error
  return { locations: locations.data, reasons: reasons.data, devices: devices.data, scales: scales.data, operators: operators.data }
}

// Articoli che si possono movimentare: gioielli (montato) e semilavorati, con quanto serve a cercarli
export async function getMovableItems() {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, sku, name, collection_id, collections(name), product_type:product_types(name), article_materials(material:materials(name))')
    .is('deleted_at', null)
  if (error) throw error
  const PAGE = 1000
  const raw = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: rawError } = await supabase
      .from('raw_items')
      .select('id, sku, description, size, quality, color, unit, raw_categories(name), raw_shapes(name)')
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (rawError) throw rawError
    raw.push(...data)
    if (data.length < PAGE) break
  }
  return { articles, raw }
}

// Giacenza di tutti i gioielli (column 'article_id') o di tutti i semilavorati ('raw_item_id'): la somma dei
// movimenti, l'unica giacenza (REQ-001.1, C-01). Le vecchie colonne stock_retail, stock_wholesale e stock non
// contano più. Risponde Map id → { pieces, grams, locations: [{ name, pieces, grams }] }; vuota per chi non è
// un operatore, che il registro non lo legge.
export async function getStockTotals(column) {
  const PAGE = 1000
  const { data: locations, error: locError } = await supabase.from('locations').select('id, name')
  if (locError) throw locError
  const names = new Map(locations.map(l => [l.id, l.name]))
  const totals = new Map()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('stock_levels')
      .select(`${column}, location_id, pieces, grams`)
      .not(column, 'is', null)
      .order(column)
      .order('location_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const r of data) {
      const t = totals.get(r[column]) || { pieces: 0, grams: 0, locations: [] }
      t.pieces += r.pieces
      t.grams += Number(r.grams)
      if (r.pieces || Number(r.grams)) t.locations.push({ id: r.location_id, name: names.get(r.location_id) || '—', pieces: r.pieces, grams: Number(r.grams) })
      totals.set(r[column], t)
    }
    if (data.length < PAGE) return totals
  }
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
      .select('id, sku, name, price_retail, price_wholesale, collections(name), product_type:product_types(name)')
      .is('deleted_at', null).order('sku').order('id')),
    selectAll(() => supabase.from('raw_items')
      .select('id, sku, description, size, unit, raw_categories(name)')
      .is('deleted_at', null).order('sku').order('id')),
    selectAll(() => supabase.from('stock_levels')
      .select('article_id, raw_item_id, location_id, pieces, grams')
      .order('article_id').order('raw_item_id').order('location_id')),
  ])
  return { articles, raw, stock }
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
    .select('id, reason_id, operator_id, device_id, note, document_ref, weight_source, scale_id, parent_id, cancelled_at, cancel_reason')
    .in('id', ids)
  if (movError) throw movError
  const byId = new Map(movements.map(m => [m.id, m]))
  return legs.map(l => ({ ...l, movement: byId.get(l.movement_id) }))
}

// Registra un movimento (REQ-E-10, E-11): il codice nasce sul dispositivo e una richiesta ripetuta
// restituisce il movimento già registrato. Risponde { duplicate, movement, from_stock, to_stock, weighing_difference }.
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

// Nuovo dispositivo, solo l'amministrazione (REQ-D-04)
export async function insertDevice({ code, name }) {
  const { data, error } = await supabase.from('devices').insert({ code, name }).select().single()
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
