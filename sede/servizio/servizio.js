// sede/servizio/servizio.js — Servizio della sede (P-07, WBA v0.5): l'unico ingresso dai dispositivi
//
// Realizza, per ora, le parti di L-05 e L-10 che servono a usare l'app sul PC server e in rete:
//   POST /auth/login      email e password → token firmato per PostgREST (L-05: accesso e token) e cookie delle foto
//   POST /auth/logout     toglie il cookie delle foto
//   /rest/v1/…            inoltro a PostgREST su localhost (P-06), che verifica il token (PC-3)
//   /foto/…               archivio delle foto, solo dopo l'accesso: file in una cartella del PC server (L-10)
//   POST /foto-elimina    cancellazione delle foto, solo amministrazione (come la regola della 016)
//   GET /copia/stato      stato della copia di sicurezza notturna (L-12, copia.js), solo amministrazione
//   POST /copia/adesso    una copia subito, per esempio prima di un aggiornamento, solo amministrazione
//   /config.js            dice all'app che è nella sede
//   tutto il resto        le pagine dell'app (P-01), finché non c'è il programma per Windows (P-04)
// Arriveranno qui, come moduli dello stesso processo (4 GB, D-1): bilancia sulla porta COM (L-09), etichette
// (QL-800), sincronizzazione dei tablet (L-08), migrazioni (L-14).
//
// Solo moduli di Node.js: niente da scaricare (REQ-003). Uso: node servizio.js <percorso di sede.json>

'use strict'
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createCopia } = require('./copia.js')

const CONFIG_PATH = process.argv[2] || process.env.SEDE_CONFIG || path.join(__dirname, 'sede.json')
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
const APP_DIR = path.resolve(config.cartellaApp)
const PHOTO_DIR = path.resolve(config.cartellaFoto)
const POSTGREST = new URL(config.postgrest || 'http://127.0.0.1:3000')
const SESSION_HOURS = config.durataSessioneOre || 12
const MAX_PHOTO_BYTES = 15 * 1024 * 1024

fs.mkdirSync(PHOTO_DIR, { recursive: true })

const log = (...args) => console.log(new Date().toISOString(), ...args)

// ─── Token (JWT HS256, lo stesso segreto di PostgREST) ────────

const b64url = buf => Buffer.from(buf).toString('base64url')

function signToken(claims) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claims))
  const sig = crypto.createHmac('sha256', config.segretoToken).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

function verifyToken(token) {
  const [head, body, sig] = String(token || '').split('.')
  if (!head || !body || !sig) return null
  const expected = crypto.createHmac('sha256', config.segretoToken).update(`${head}.${body}`).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null
  return claims
}

const bearer = req => verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))

// Un'immagine nella pagina non può mandare il token: per leggere le foto vale un cookie, che arriva solo a /foto
const PHOTO_COOKIE = 'desimone_foto'
const photoCookie = (req, value, maxAge) =>
  `${PHOTO_COOKIE}=${value}; Path=/foto; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.socket.encrypted ? '; Secure' : ''}`
function photoReader(req) {
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${PHOTO_COOKIE}=`))
  return bearer(req) || verifyToken(cookie?.slice(PHOTO_COOKIE.length + 1))
}
const now = () => Math.floor(Date.now() / 1000)

// ─── Risposte ─────────────────────────────────────────────────

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...headers,
  })
  res.end(data)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > limit) { reject(Object.assign(new Error('Troppo grande'), { status: 413 })); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ─── Accesso (L-05) ───────────────────────────────────────────

// Tentativi sbagliati per indirizzo: dopo 10 in 5 minuti si aspetta
const attempts = new Map()
function tooManyAttempts(ip) {
  const list = (attempts.get(ip) || []).filter(t => t > Date.now() - 5 * 60 * 1000)
  attempts.set(ip, list)
  return list.length >= 10
}

// Chiamata a PostgREST dal servizio stesso, col ruolo di servizio e un token di un minuto
function postgrestRpc(fn, args) {
  const token = signToken({ role: 'service_role', iat: now(), exp: now() + 60 })
  const body = JSON.stringify(args)
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(`rpc/${fn}`, POSTGREST.href.replace(/\/?$/, '/')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}` },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode >= 300) return reject(new Error(`PostgREST ${res.statusCode}: ${text}`))
        resolve(text ? JSON.parse(text) : null)
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function login(req, res) {
  const ip = req.socket.remoteAddress
  if (tooManyAttempts(ip)) return send(res, 429, { error: 'Troppi tentativi: riprova tra qualche minuto' })
  const { email, password } = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}')
  if (!email || !password) return send(res, 400, { error: 'Servono email e password' })
  const user = await postgrestRpc('sede_login', { p_email: email, p_password: password })
  if (!user) {
    attempts.get(ip).push(Date.now())
    log('accesso rifiutato', email, ip)
    return send(res, 401, { error: 'Email o password non validi' })
  }
  const exp = now() + SESSION_HOURS * 3600
  const accessToken = signToken({
    sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata, iat: now(), exp,
  })
  log('accesso', user.email, ip)
  send(res, 200, { access_token: accessToken, token_type: 'bearer', expires_at: exp, user },
    { 'Set-Cookie': photoCookie(req, accessToken, SESSION_HOURS * 3600) })
}

// ─── Inoltro a PostgREST (PC-3) ───────────────────────────────

const HOP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'apikey', 'x-client-info'])

function proxy(req, res, restPath) {
  const target = new URL(restPath.replace(/^\//, ''), POSTGREST.href.replace(/\/?$/, '/'))
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v
  const up = http.request(target, { method: req.method, headers }, upRes => {
    const out = {}
    for (const [k, v] of Object.entries(upRes.headers)) if (!HOP.has(k)) out[k] = v
    res.writeHead(upRes.statusCode, out)
    upRes.pipe(res)
  })
  up.on('error', err => {
    log('PostgREST non risponde', err.message)
    if (!res.headersSent) send(res, 502, { message: 'Il database della sede non risponde' })
  })
  req.pipe(up)
}

// ─── Foto (L-10) ──────────────────────────────────────────────

// Percorso dentro la cartella delle foto, senza uscirne
function photoPath(rel) {
  const clean = decodeURIComponent(rel).replace(/\\/g, '/')
  if (!clean || clean.split('/').some(p => p === '..' || p === '')) return null
  const full = path.resolve(PHOTO_DIR, clean)
  return full.startsWith(PHOTO_DIR + path.sep) ? full : null
}

async function photos(req, res, rel) {
  const file = photoPath(rel)
  if (!file) return send(res, 400, { error: 'Percorso non valido' })
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!photoReader(req)) return send(res, 401, { error: 'Accesso richiesto' })
    return serveFile(req, res, file, 'private, no-cache')
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    if (!bearer(req)) return send(res, 401, { error: 'Accesso richiesto' })
    if (fs.existsSync(file)) return send(res, 409, { error: 'La foto esiste già' })
    const data = await readBody(req, MAX_PHOTO_BYTES)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data, { flag: 'wx' })
    return send(res, 200, { Key: `photos/${rel}` })
  }
  send(res, 405, { error: 'Metodo non ammesso' })
}

async function deletePhotos(req, res) {
  const user = bearer(req)
  if (!user) return send(res, 401, { error: 'Accesso richiesto' })
  if (user.app_metadata?.role !== 'admin') return send(res, 403, { error: 'Solo l\'amministrazione elimina le foto' })
  const { paths = [] } = JSON.parse((await readBody(req, 1_000_000)).toString('utf8') || '{}')
  let removed = 0
  for (const rel of paths) {
    const file = photoPath(String(rel))
    if (file && fs.existsSync(file)) { fs.unlinkSync(file); removed++ }
  }
  send(res, 200, { removed })
}

// ─── Copia di sicurezza (L-12, copia.js) ──────────────────────

const copia = createCopia(config, CONFIG_PATH, log)

function backup(req, res, action) {
  const user = bearer(req)
  if (!user) return send(res, 401, { error: 'Accesso richiesto' })
  if (user.app_metadata?.role !== 'admin') return send(res, 403, { error: 'Solo l\'amministrazione vede la copia di sicurezza' })
  if (action === 'adesso') {
    copia.adesso(`a richiesta di ${user.email}`)
    return send(res, 202, copia.stato())
  }
  send(res, 200, copia.stato())
}

// ─── Pagine dell'app (P-01) ───────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}
// Cartelle del repository che non sono l'app: materiale privato e strumenti (come scripts/pubblica-codice.sh)
const PRIVATE = ['docs', 'bilancia', 'old_software', 'inventory_data', 'supabase', 'sede', 'scripts', 'node_modules']
const ROUTES = { '/': '/catalog.html', '/semilavorato': '/semilavorato.html', '/movimenti': '/movimenti.html', '/giacenze': '/giacenze.html', '/registro': '/registro.html', '/anagrafiche': '/anagrafiche.html' }

function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Non trovato')
    const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cache })
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  })
}

function app(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metodo non ammesso')
  if (pathname === '/config.js') {
    // L'app è nella sede: dati, accessi e foto da questo stesso indirizzo
    return send(res, 200, '// Generato dal servizio della sede (P-07)\nconst SEDE = { url: \'\' }\n',
      { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' })
  }
  const rel = decodeURIComponent(ROUTES[pathname] || pathname)
  const parts = rel.split('/').filter(Boolean)
  if (parts.some(p => p.startsWith('.') || p === '..') || PRIVATE.includes(parts[0])) return send(res, 404, 'Non trovato')
  serveFile(req, res, path.join(APP_DIR, ...parts), 'no-cache')
}

// ─── Instradamento ────────────────────────────────────────────

async function handle(req, res) {
  const { pathname, search } = new URL(req.url, 'http://sede')
  try {
    if (pathname === '/salute') return send(res, 200, { servizio: 'ok', ora: new Date().toISOString() })
    if (pathname === '/auth/login' && req.method === 'POST') return await login(req, res)
    if (pathname === '/auth/logout' && req.method === 'POST') return send(res, 200, {}, { 'Set-Cookie': photoCookie(req, '', 0) })
    if (pathname.startsWith('/rest/v1/')) return proxy(req, res, pathname.slice('/rest/v1'.length) + search)
    if (pathname === '/foto-elimina' && req.method === 'POST') return await deletePhotos(req, res)
    if (pathname.startsWith('/foto/')) return await photos(req, res, pathname.slice('/foto/'.length))
    if (pathname === '/copia/stato' && req.method === 'GET') return backup(req, res, 'stato')
    if (pathname === '/copia/adesso' && req.method === 'POST') return backup(req, res, 'adesso')
    return app(req, res, pathname)
  } catch (err) {
    log('errore', req.method, pathname, err.message)
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Errore del servizio della sede' })
  }
}

// HTTP per il PC server stesso (localhost); HTTPS col certificato di casa per i tablet (architettura-locale §4)
const port = config.porta || 8080
http.createServer(handle).listen(port, config.indirizzo || '127.0.0.1', () => log(`servizio della sede su http://${config.indirizzo || '127.0.0.1'}:${port}`))
copia.avvia()
if (config.https) {
  const options = { cert: fs.readFileSync(config.https.certificato), key: fs.readFileSync(config.https.chiave) }
  https.createServer(options, handle).listen(config.https.porta || 443, '0.0.0.0', () => log(`HTTPS sulla porta ${config.https.porta || 443}`))
}
