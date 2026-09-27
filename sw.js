const CACHE_NAME = 'desimone-os-v11'

const SHELL_ASSETS = [
  '/catalog.html',
  '/semilavorato.html',
  '/article.html',
  '/login.html',
  '/config.js',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/mobile.css',
  '/js/catalog.js',
  '/js/semilavorato.js',
  '/js/raw-form.js',
  '/js/supabase.js',
  '/js/article-form.js',
  '/js/material-picker.js',
  '/js/article.js',
  '/js/photo-upload.js',
  '/js/utils.js',
  '/js/pwa.js',
]

// Install: pre-cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err)
      })
    })
  )
  self.skipWaiting()
})

// Activate: rimuovi cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// Fetch: Network First per Supabase, Cache First per asset statici
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Supabase calls: sempre network, no cache
  if (url.hostname.includes('supabase.co')) {
    return // lascia passare senza intercettare
  }

  // Google Fonts: cache first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
      })
    )
    return
  }

  // Asset statici: cache first, fallback network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      }).catch(() => {
        // Offline fallback per navigazione
        if (event.request.mode === 'navigate') {
          return caches.match('/catalog.html')
        }
      })
    })
  )
})
