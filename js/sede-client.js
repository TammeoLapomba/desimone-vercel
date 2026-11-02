// js/sede-client.js — Collegamento dell'app al PC server (WBA v0.5: P-01 verso P-07 e P-06)
//
// Stessa forma del client di Supabase per la parte che l'app usa (from, rpc, auth, storage), così le pagine
// non cambiano: i dati passano da PostgREST tramite il servizio della sede (/rest/v1), l'accesso e le foto dal
// servizio stesso (/auth/login, /foto). Il token firmato dal servizio vale per PostgREST (D-1).
import { PostgrestClient } from './vendor/supabase-2.117.3.mjs'

const SESSION_KEY = 'desimone-os:sessione'

const storage = {
  get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null } },
  set(value) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(value)) } catch {} },
  clear() { try { localStorage.removeItem(SESSION_KEY) } catch {} },
}

// Sessione valida o null (scaduta: si rientra)
function currentSession() {
  const s = storage.get()
  if (!s?.access_token || !s.expires_at || s.expires_at * 1000 <= Date.now()) {
    if (s) storage.clear()
    return null
  }
  return s
}

export function createSedeClient(baseUrl = '') {
  const base = (baseUrl || location.origin).replace(/\/$/, '')

  // Ogni chiamata porta il token dell'operatore; senza, PostgREST risponde come "anon"
  const authFetch = async (input, init = {}) => {
    const headers = new Headers(init.headers)
    const session = currentSession()
    if (session) headers.set('Authorization', `Bearer ${session.access_token}`)
    const res = await fetch(input, { ...init, headers })
    if (res.status === 401 && session) {
      storage.clear()
      window.location.replace('/login.html')
    }
    return res
  }

  const rest = new PostgrestClient(`${base}/rest/v1`, { fetch: authFetch })

  const auth = {
    async getSession() {
      return { data: { session: currentSession() }, error: null }
    },
    async signInWithPassword({ email, password }) {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: new Error(body.error || 'Accesso non riuscito') }
      const session = { access_token: body.access_token, expires_at: body.expires_at, user: body.user }
      storage.set(session)
      return { data: { session, user: body.user }, error: null }
    },
    async signOut() {
      storage.clear()
      return { error: null }
    },
  }

  const photoBucket = {
    async upload(path, file, { contentType } = {}) {
      const res = await authFetch(`${base}/foto/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', headers: { 'Content-Type': contentType || file.type || 'application/octet-stream' }, body: file,
      })
      const body = await res.json().catch(() => ({}))
      return res.ok ? { data: { path }, error: null } : { data: null, error: new Error(body.error || 'Foto non salvata') }
    },
    async remove(paths) {
      const res = await authFetch(`${base}/foto-elimina`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }),
      })
      const body = await res.json().catch(() => ({}))
      return res.ok ? { data: body, error: null } : { data: null, error: new Error(body.error || 'Foto non eliminate') }
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `${base}/foto/${path.split('/').map(encodeURIComponent).join('/')}` } }
    },
  }

  return {
    from: table => rest.from(table),
    rpc: (fn, args, options) => rest.rpc(fn, args, options),
    auth,
    storage: { from: () => photoBucket },
  }
}
