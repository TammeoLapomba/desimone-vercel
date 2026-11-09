// js/pwa.js — Registrazione Service Worker + utils PWA
import { supabase, getMyRole } from './supabase.js'
import './account-menu.js'
import './lettore.js'

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

// ─── Voce per ruolo: Anagrafiche per il dev (AN-02), Impostazioni per l'amministrazione (scheda 1.5) ─

const SETTINGS_ICON = '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'
const ANAGRAFICHE_ICON = '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.2"/>'

async function addRoleMenuItem() {
  const nav = document.querySelector('.sidebar-nav')
  if (!nav) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  const role = await getMyRole()
  const page = role === 'dev' ? ['anagrafiche', 'Anagrafiche', ANAGRAFICHE_ICON] : role === 'admin' ? ['impostazioni', 'Impostazioni', SETTINGS_ICON] : null
  if (!page) return
  const [key, label, icon] = page
  const current = window.location.pathname.includes(key)
  nav.insertAdjacentHTML('beforeend', `
    <a href="/${key}.html" class="nav-item${current ? ' active' : ''}" ${current ? 'aria-current="page"' : ''} title="${label}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icon}</svg>
      <span class="nav-item-label">${label}</span>
    </a>`)
}
addRoleMenuItem().catch(console.error)

// ─── Barra in basso sul telefono e sul tablet (≤ 768 px) ──────────
// Sostituisce la barra laterale, che lì è nascosta: deve avere le stesse pagine (Montato, Semilavorato, Movimenti,
// Giacenze, Registro) e l'uscita dall'account. Il "+" per un elemento nuovo galleggia sopra, solo dove c'è
// (Montato, Semilavorato, Anagrafiche); collezioni, categorie ed elenchi si aprono dal menu ☰ in alto (initHamburger).
// Con l'account dev c'è anche Anagrafiche (AN-02), con l'amministrazione Impostazioni, come nella barra laterale.

const ICONS = {
  montato: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  semilavorato: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  movimenti: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  giacenze: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
  registro: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/>',
  anagrafiche: ANAGRAFICHE_ICON,
  impostazioni: SETTINGS_ICON,
  esci: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
}
const PAGES = [
  ['montato', 'Montato', '/catalog.html'],
  ['semilavorato', 'Semilav.', '/semilavorato.html', 'Semilavorato'],
  ['movimenti', 'Movimenti', '/movimenti.html'],
  ['giacenze', 'Giacenze', '/giacenze.html'],
  ['registro', 'Registro', '/registro.html'],
]
const DEV_PAGE = ['anagrafiche', 'Anagr.', '/anagrafiche.html', 'Anagrafiche']
const ADMIN_PAGE = ['impostazioni', 'Impost.', '/impostazioni.html', 'Impostazioni']
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICONS[name]}</svg>`

export function initMobileNav({ onNewArticle, onOpenDrawer } = {}) {
  if (document.querySelector('.mobile-nav')) return

  // La pagina aperta, anche senza .html (/movimenti) o dalla radice (/ = Montato)
  const path = window.location.pathname
  const current = path === '/' ? 'montato' : ([...PAGES, DEV_PAGE, ADMIN_PAGE].find(([key, , href]) => path.startsWith(href.replace('.html', '')))?.[0]
    ?? (path.includes('catalog') ? 'montato' : null))
  const item = ([key, label, href, full]) => `
    <a href="${href}" class="mobile-nav-item${key === current ? ' active' : ''}"${key === current ? ' aria-current="page"' : ''}
       aria-label="${full || label}">${svg(key)}<span>${label}</span></a>`

  const nav = document.createElement('nav')
  nav.className = 'mobile-nav'
  nav.setAttribute('aria-label', 'Navigazione')
  nav.innerHTML = PAGES.map(item).join('') + `
    <button type="button" class="mobile-nav-item mobile-nav-exit" id="mobileSignOutBtn" aria-label="Esci dall'account">${svg('esci')}<span>Esci</span></button>`
  document.body.appendChild(nav)
  document.getElementById('mobileSignOutBtn').addEventListener('click', () => window.signOutUser?.())

  // Segno del tocco: la voce toccata resta scura finché non si apre la pagina, così si vede che il tocco è arrivato
  // anche se la pagina ci mette un attimo. Su iOS :active vale solo se la pagina ascolta touchstart
  document.addEventListener('touchstart', () => {}, { passive: true })
  nav.addEventListener('click', e => e.target.closest('a.mobile-nav-item')?.classList.add('pressed'))
  // Tornando indietro il browser può rimostrare la pagina com'era: la voce non deve restare scura
  window.addEventListener('pageshow', () => nav.querySelectorAll('.pressed').forEach(a => a.classList.remove('pressed')))

  // Anagrafiche solo con l'account dev, Impostazioni solo con l'amministrazione, prima di Esci
  getMyRole().then(role => {
    const page = role === 'dev' ? DEV_PAGE : role === 'admin' ? ADMIN_PAGE : null
    if (!page) return
    document.getElementById('mobileSignOutBtn').insertAdjacentHTML('beforebegin', item(page))
    nav.classList.add('mobile-nav-seven')
  }).catch(console.error)

  // "+" solo dove si crea qualcosa
  if (onNewArticle) {
    const fab = document.createElement('button')
    fab.type = 'button'
    fab.className = 'mobile-fab'
    fab.id = 'mobileNewArticleBtn'
    fab.setAttribute('aria-label', current === 'semilavorato' ? 'Nuovo semilavorato' : current === 'anagrafiche' ? 'Nuova voce' : 'Nuovo articolo')
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    fab.addEventListener('click', () => onNewArticle())
    document.body.appendChild(fab)
  }

  // Cassetto di collezioni, categorie ed elenchi (Montato, Semilavorato, Anagrafiche): si apre dal ☰, si chiude toccando fuori
  const overlay = document.createElement('div')
  overlay.className = 'drawer-overlay'
  overlay.id = 'drawerOverlay'
  document.body.appendChild(overlay)
  overlay.addEventListener('click', closeDrawer)
  document.getElementById('hamburgerBtn')?.addEventListener('click', () => onOpenDrawer?.())
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

// ─── Colonna collezioni/categorie richiudibile (schermo largo) ─────
// Lo stato resta tra una pagina e l'altra; lo applica già lo script nell'<head>

const PANEL_KEY = 'desimone-os:pannello-chiuso'

export function initPanelToggle() {
  const btn = document.getElementById('btnPanelToggle')
  if (!btn) return
  const root = document.documentElement
  const name = btn.getAttribute('aria-label').replace(/^Elenco /, '')

  const sync = () => {
    const collapsed = root.classList.contains('panel-collapsed')
    btn.setAttribute('aria-expanded', String(!collapsed))
    btn.title = `${collapsed ? 'Mostra' : 'Nascondi'} ${name}`
  }
  sync()

  btn.addEventListener('click', () => {
    const collapsed = root.classList.toggle('panel-collapsed')
    try { localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0') } catch { /* storage non disponibile */ }
    sync()
  })
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
