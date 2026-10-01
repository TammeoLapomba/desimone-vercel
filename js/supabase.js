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
      price_retail, price_wholesale, stock_retail, stock_wholesale,
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

  const { data, error } = await query
  if (error) throw error
  return data
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
    if (data.length < PAGE) return all
  }
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
