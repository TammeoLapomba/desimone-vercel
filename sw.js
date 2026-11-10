const CACHE_NAME = 'desimone-os-v60'

const SHELL_ASSETS = [
  '/catalog.html',
  '/semilavorato.html',
  '/article.html',
  '/movimenti.html',
  '/giacenze.html',
  '/registro.html',
  '/anagrafiche.html',
  '/impostazioni.html',
  '/conte.html',
  '/catalog-scheda.html',
  '/semilavorato-scheda.html',
  '/etichette.html',
  '/vendite.html',
  '/cliente.html',
  '/login.html',
  '/config.js',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/mobile.css',
  '/css/movimenti.css',
  '/css/scanner.css',
  '/css/giacenze.css',
  '/css/scheda.css',
  '/css/registro.css',
  '/css/vendite.css',
  '/js/catalog.js',
  '/js/semilavorato.js',
  '/js/raw-form.js',
  '/js/supabase.js',
  '/js/article-form.js',
  '/js/material-picker.js',
  '/js/color-select.js',
  '/js/filters.js',
  '/js/article.js',
  '/js/archivio.js',
  '/js/gallery.js',
  '/js/utils.js',
  '/js/pwa.js',
  '/js/movimenti.js',
  '/js/conte.js',
  '/js/scheda.js',
  '/js/catalog-scheda.js',
  '/js/semilavorato-scheda.js',
  '/js/scanner.js',
  '/js/vendor/jsQR-1.4.0.js',
  '/js/sede-client.js',
  '/js/account-menu.js',
  '/js/lettore.js',
  '/js/etichetta.js',
  '/js/etichette.js',
  '/js/vendor/qrcode-generator-1.4.4.js',
  '/js/vendor/supabase-2.117.3.mjs',
  '/css/fonts.css',
  '/fonts/work-sans/work-sans-latin-300-normal.woff2',
  '/fonts/work-sans/work-sans-latin-400-normal.woff2',
  '/fonts/work-sans/work-sans-latin-500-normal.woff2',
  '/fonts/work-sans/work-sans-latin-600-normal.woff2',
  '/fonts/work-sans/work-sans-latin-300-italic.woff2',
  '/fonts/work-sans/work-sans-latin-400-italic.woff2',
  '/js/giacenze.js',
  '/js/registro.js',
  '/js/anagrafiche.js',
  '/js/impostazioni.js',
  '/js/vendite.js',
  '/js/cliente.js',
  '/js/clienti.js',
  '/js/bilancia/bilancia.js',
  '/js/bilancia/pesi.js',
  '/js/bilancia/sics.js',
  '/js/bilancia/simulatore.js',
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

  // Dati e accessi: sempre dalla rete, mai dalla cache. Su Supabase (sviluppo) e nella sede, dove il servizio
  // (P-07) li serve dallo stesso indirizzo dell'app: /rest/v1 (PostgREST), /auth, /foto, /foto-elimina, /salute, /copia, /certificato
  if (url.hostname.includes('supabase.co') || event.request.method !== 'GET' ||
      /^\/(rest|auth|salute|foto|foto-elimina|copia|certificato)(\/|$)/.test(url.pathname)) {
    return // lascia passare senza intercettare
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
