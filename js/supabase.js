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
    .order('sort_order')
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
      id, name, sku, product_type_id, status, channel,
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
  // I file si tolgono dopo: se non ci si riesce l'articolo resta comunque eliminato
  if (paths?.length) {
    const { error: storageError } = await supabase.storage.from('photos').remove(paths)
    if (storageError) console.warn('File delle foto non rimossi dallo Storage:', storageError.message, paths)
  }
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

export function subscribeToArticleStatus(onUpdate) {
  return supabase
    .channel('articles-status')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'articles'
    }, (payload) => onUpdate(payload.new))
    .subscribe()
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
  let query = supabase
    .from('raw_items')
    .select('*, raw_categories(name, slug)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (categoryId) query = query.eq('category_id', categoryId)
  const { data, error } = await query
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
