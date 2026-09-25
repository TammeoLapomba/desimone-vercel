// js/pwa.js — Registrazione Service Worker + utils PWA

// Registra il service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service worker registrato:', reg.scope)

        // Notifica aggiornamento disponibile
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // C'è una nuova versione disponibile
              console.log('[PWA] Nuova versione disponibile — ricarica per aggiornare')
            }
          })
        })
      })
      .catch((err) => console.warn('[PWA] Service worker non registrato:', err))
  })
}

// ─── Bottom Nav / Drawer mobile ──────────────────────────────────

export function initMobileNav({ onNewArticle, onOpenDrawer } = {}) {
  // Inietta bottom nav se non presente
  if (document.querySelector('.mobile-nav')) return

  const isCatalog = window.location.pathname.includes('catalog') || window.location.pathname === '/'
  const isSmontato = window.location.pathname.includes('smontato')

  const nav = document.createElement('nav')
  nav.className = 'mobile-nav'
  nav.setAttribute('aria-label', 'Navigazione mobile')
  nav.innerHTML = `
    <a href="catalog.html" class="mobile-nav-item ${isCatalog ? 'active' : ''}" aria-label="Montato">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      Montato
    </a>

    <a href="smontato.html" class="mobile-nav-item ${isSmontato ? 'active' : ''}" aria-label="Smontato">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
      Smontato
    </a>

    <button class="mobile-fab" id="mobileNewArticleBtn" aria-label="Nuovo elemento">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>

    <button class="mobile-nav-item" id="mobileCollectionsBtn" aria-label="Categorie">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M12 3v18"/>
      </svg>
      Filtri
    </button>
  `
  document.body.appendChild(nav)

  // Overlay per il drawer
  const overlay = document.createElement('div')
  overlay.className = 'drawer-overlay'
  overlay.id = 'drawerOverlay'
  document.body.appendChild(overlay)

  // FAB → nuovo articolo
  document.getElementById('mobileNewArticleBtn')?.addEventListener('click', () => {
    onNewArticle?.()
  })

  // Bottone collezioni → apre drawer
  document.getElementById('mobileCollectionsBtn')?.addEventListener('click', () => {
    openDrawer()
    onOpenDrawer?.()
  })

  // Chiude drawer cliccando overlay
  overlay.addEventListener('click', closeDrawer)
}

export function openDrawer() {
  document.querySelector('.left-panel')?.classList.add('open')
  document.getElementById('drawerOverlay')?.classList.add('visible')
  document.body.style.overflow = 'hidden'
}

export function closeDrawer() {
  document.querySelector('.left-panel')?.classList.remove('open')
  document.getElementById('drawerOverlay')?.classList.remove('visible')
  document.body.style.overflow = ''
}

// ─── Hamburger per topbar ─────────────────────────────────────

export function initHamburger() {
  const topbar = document.querySelector('.topbar')
  if (!topbar || document.querySelector('.topbar-hamburger')) return

  const btn = document.createElement('button')
  btn.className = 'topbar-hamburger'
  btn.setAttribute('aria-label', 'Apri menu collezioni')
  btn.setAttribute('id', 'hamburgerBtn')
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>`
  topbar.insertBefore(btn, topbar.firstChild)

  btn.addEventListener('click', openDrawer)
}

// ─── Chiudi detail panel su mobile ───────────────────────────

export function addDetailPanelCloseBtn() {
  const inner = document.getElementById('detailInner')
  if (!inner) return

  const obs = new MutationObserver(() => {
    const panel = document.getElementById('detailPanel')
    if (!panel?.classList.contains('open')) return
    if (inner.querySelector('.detail-close-btn')) return

    const btn = document.createElement('button')
    btn.className = 'detail-close-btn'
    btn.setAttribute('aria-label', 'Chiudi dettaglio')
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Torna al catalogo`
    btn.addEventListener('click', () => {
      panel.classList.remove('open')
    })
    inner.insertBefore(btn, inner.firstChild)
  })

  obs.observe(inner, { childList: true, subtree: false })
}
