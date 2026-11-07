// sede/servizio/servizio.js — Servizio della sede (P-07, WBA v0.5): l'unico ingresso dai dispositivi
//
// Realizza, per ora, le parti di L-05 e L-10 che servono a usare l'app sul PC server e in rete:
//   POST /auth/login      nome utente (o email) e password → token firmato per PostgREST (L-05: accesso e token) e cookie delle foto
//   POST /auth/password   cambia la propria password, anche quella provvisoria (scheda 1.4)
//   POST /auth/logout     toglie il cookie delle foto
//   /rest/v1/…            inoltro a PostgREST su localhost (P-06), che verifica il token (PC-3)
//   /foto/…               archivio delle foto, solo dopo l'accesso: file in una cartella del PC server (L-10)
//   POST /foto-elimina    cancellazione delle foto, solo amministrazione (come la regola della 016)
//   GET /copia/stato      stato della copia di sicurezza notturna (L-12, copia.js), solo amministrazione
//   POST /copia/adesso    una copia subito, per esempio prima di un aggiornamento, solo amministrazione
//   /config.js            dice all'app che è nella sede
//   /certificato          con l'HTTPS: come installare sul tablet l'autorità di casa, e il file (…/ca-desimone.crt)
//   tutto il resto        le pagine dell'app (P-01), finché non c'è il programma per Windows (P-04)
// Arriveranno qui, come moduli dello stesso processo (4 GB, D-1): bilancia sulla porta COM (L-09), etichette
// (QL-800), sincronizzazione dei tablet (L-08), migrazioni (L-14).
//
// Rete: risponde solo al PC stesso e alla rete dell'azienda (indirizzi privati), mai a internet; con "indirizzo"
// 0.0.0.0 in sede.json (installa.js --rete si) anche ai tablet. Verso fuori si collega solo a questo PC: PostgREST e
// il database su localhost, nient'altro (sede/rete.ps1 lo impone anche col firewall di Windows).
// HTTPS (installa.js --https si, certificato di casa di sede/certificato.ps1): dalla rete le pagine passano a https;
// in http restano solo /certificato e /salute, e il PC server stesso su localhost.
//
// Solo moduli di Node.js: niente da scaricare (REQ-003). Uso: node servizio.js <percorso di sede.json>

'use strict'
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const net = require('node:net')
const os = require('node:os')
const { createCopia } = require('./copia.js')

const CONFIG_PATH = process.argv[2] || process.env.SEDE_CONFIG || path.join(__dirname, 'sede.json')
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
const APP_DIR = path.resolve(config.cartellaApp)
const PHOTO_DIR = path.resolve(config.cartellaFoto)
const POSTGREST = new URL(config.postgrest || 'http://127.0.0.1:3000')
const SESSION_HOURS = config.durataSessioneOre || 12
const MAX_PHOTO_BYTES = 15 * 1024 * 1024

const log = (...args) => console.log(new Date().toISOString(), ...args)

// ─── Solo rete locale, mai internet ───────────────────────────

// Chi può entrare: il PC stesso e gli indirizzi privati della rete dell'azienda (Wi-Fi, cavo). Il resto è internet
function isLocalAddress(address) {
  const ip = String(address || '').toLowerCase().split('%')[0].replace(/^::ffff:(?=\d+\.)/, '')   // IPv4 scritto come IPv6
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (net.isIPv6(ip)) return ip === '::1' || /^fe[89ab]/.test(ip) || /^f[cd]/.test(ip)   // link-local, ULA
  return false
}

// Verso fuori solo questo PC: PostgREST, il database (anche per pg_dump della copia di sicurezza)
const THIS_PC = new Set(['localhost', '127.0.0.1', '::1'])
const isThisPc = host => THIS_PC.has(String(host || 'localhost').toLowerCase().replace(/^\[|\]$/g, ''))
if (!isThisPc(POSTGREST.hostname)) throw new Error(`sede.json: postgrest deve essere su questo PC, non ${POSTGREST.hostname}`)
if (!isThisPc(config.database?.host)) throw new Error(`sede.json: il database deve essere su questo PC, non ${config.database.host}`)

// E se un giorno un modulo provasse ad andare su internet, la connessione non parte: ogni collegamento che il
// servizio apre (http, https, net) passa da qui
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined }
  if (!options.path && !isThisPc(options.host)) {
    log('collegamento bloccato: il servizio della sede non va su internet', options.host)
    throw new Error(`Il servizio della sede si collega solo a questo PC, non a ${options.host}`)
  }
  return connect.apply(this, args)
}

// Una connessione che non viene dalla rete locale si chiude subito, prima di HTTP e TLS (prependListener): non si
// legge niente. Nel log una riga per indirizzo
const refused = new Set()
function onlyLocal(server) {
  return server.prependListener('connection', socket => {
    if (isLocalAddress(socket.remoteAddress)) return
    if (!refused.has(socket.remoteAddress)) {
      if (refused.size > 1000) refused.clear()
      refused.add(socket.remoteAddress)
      log('rifiutato, non è della rete locale:', socket.remoteAddress)
    }
    socket.destroy()
  })
}

fs.mkdirSync(PHOTO_DIR, { recursive: true })

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

const bearerToken = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')

// Un'immagine nella pagina non può mandare il token: per leggere le foto vale un cookie, che arriva solo a /foto
const PHOTO_COOKIE = 'desimone_foto'
const photoCookie = (req, value, maxAge) =>
  `${PHOTO_COOKIE}=${value}; Path=/foto; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.socket.encrypted ? '; Secure' : ''}`
function photoToken(req) {
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${PHOTO_COOKIE}=`))
  return bearerToken(req) || cookie?.slice(PHOTO_COOKIE.length + 1)
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

// Chiamata a PostgREST dal servizio stesso: col ruolo di servizio e un token di un minuto, oppure col token di chi chiede.
// L'errore porta lo stato e il messaggio del database
function postgrestRpc(fn, args, userToken) {
  const token = userToken || signToken({ role: 'service_role', iat: now(), exp: now() + 60 })
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
        if (res.statusCode >= 300) {
          let db = {}
          try { db = JSON.parse(text) } catch { /* non era JSON */ }
          return reject(Object.assign(new Error(`PostgREST ${res.statusCode}: ${text}`), { httpStatus: res.statusCode, dbCode: db.code, dbMessage: db.message }))
        }
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
  if (!email || !password) return send(res, 400, { error: 'Servono nome utente e password' })
  const user = await postgrestRpc('sede_login', { p_email: email, p_password: password })
  if (!user) {
    attempts.get(ip).push(Date.now())
    log('accesso rifiutato', email, ip)
    return send(res, 401, { error: 'Nome utente o password non validi' })
  }
  // Queste due risposte le legge solo chi ha la password giusta (scheda 1.4, decisioni 4 e 5): nessun token
  if (user.disabled) return send(res, 403, { error: 'Account disattivato: chiedi all\'amministrazione', code: 'account_disattivato' })
  if (user.must_change_password) return send(res, 403, { error: 'Scegli una password nuova', code: 'password_provvisoria' })
  const exp = now() + SESSION_HOURS * 3600
  const accessToken = signToken({
    sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata, iat: now(), exp,
  })
  log('accesso', user.email, ip)
  send(res, 200, { access_token: accessToken, token_type: 'bearer', expires_at: exp, user },
    { 'Set-Cookie': photoCookie(req, accessToken, SESSION_HOURS * 3600) })
}

// Cambiare la propria password chiede quella di adesso, quindi vale anche senza token: serve a chi ha la provvisoria
async function changePassword(req, res) {
  const ip = req.socket.remoteAddress
  if (tooManyAttempts(ip)) return send(res, 429, { error: 'Troppi tentativi: riprova tra qualche minuto' })
  const { email, password, new_password: newPassword } = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}')
  if (!email || !password || !newPassword) return send(res, 400, { error: 'Servono nome utente, password di adesso e password nuova' })
  let changed
  try {
    changed = await postgrestRpc('sede_cambia_password', { p_email: email, p_attuale: password, p_nuova: newPassword })
  } catch (err) {
    // I motivi scritti dal database: troppo corta, uguale a quella di prima, account disattivato
    if (err.dbCode === 'P0001') return send(res, 400, { error: err.dbMessage })
    throw err
  }
  if (!changed) {
    attempts.get(ip).push(Date.now())
    log('cambio password rifiutato', email, ip)
    return send(res, 401, { error: 'La password di adesso non è giusta' })
  }
  log('password cambiata', email, ip)
  send(res, 200, {})
}

// ─── Chi è adesso (scheda 1.4, decisione 7) ───────────────────

// Lo dice il database, non il token, che resta vecchio fino a SESSION_HOURS. Un token non valido o un account
// disattivato (la 037 lo ferma prima di ogni richiesta) danno null. PostgREST verifica il token con lo stesso segreto.
async function currentAccount(token) {
  if (!verifyToken(token)) return null
  try {
    return await postgrestRpc('my_account', {}, token)
  } catch (err) {
    if (err.httpStatus === 401) return null
    throw err
  }
}

// Le foto di una pagina arrivano a centinaia: per queste basta un controllo ogni pochi secondi per account.
// Un account disattivato smette di vedere le foto entro questo tempo; le altre richieste si fermano subito.
const PHOTO_CHECK_MS = 10_000
const photoChecks = new Map()
async function canReadPhotos(req) {
  const token = photoToken(req)
  const claims = verifyToken(token)
  if (!claims) return false
  const until = photoChecks.get(claims.sub)
  if (until > Date.now()) return true
  photoChecks.delete(claims.sub)
  if (!await currentAccount(token)) return false
  if (photoChecks.size > 500) photoChecks.clear()
  photoChecks.set(claims.sub, Date.now() + PHOTO_CHECK_MS)
  return true
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
    if (!await canReadPhotos(req)) return send(res, 401, { error: 'Accesso richiesto' })
    return serveFile(req, res, file, 'private, no-cache')
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const account = await currentAccount(bearerToken(req))
    if (!account) return send(res, 401, { error: 'Accesso richiesto' })
    // Il dev vede le foto ma non le aggiunge (scheda 1.6): il database rifiuterebbe la riga, e il file resterebbe orfano
    if (!account.role || account.role === 'dev') return send(res, 403, { error: 'Questo account non aggiunge foto' })
    if (fs.existsSync(file)) return send(res, 409, { error: 'La foto esiste già' })
    const data = await readBody(req, MAX_PHOTO_BYTES)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data, { flag: 'wx' })
    return send(res, 200, { Key: `photos/${rel}` })
  }
  send(res, 405, { error: 'Metodo non ammesso' })
}

async function deletePhotos(req, res) {
  const account = await currentAccount(bearerToken(req))
  if (!account) return send(res, 401, { error: 'Accesso richiesto' })
  if (account.role !== 'admin') return send(res, 403, { error: 'Solo l\'amministrazione elimina le foto' })
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

async function backup(req, res, action) {
  const account = await currentAccount(bearerToken(req))
  if (!account) return send(res, 401, { error: 'Accesso richiesto' })
  if (account.role !== 'admin') return send(res, 403, { error: 'Solo l\'amministrazione vede la copia di sicurezza' })
  if (action === 'adesso') {
    copia.adesso(`a richiesta di ${account.username}`)
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
const ROUTES = { '/': '/catalog.html', '/semilavorato': '/semilavorato.html', '/movimenti': '/movimenti.html', '/giacenze': '/giacenze.html', '/registro': '/registro.html', '/anagrafiche': '/anagrafiche.html', '/impostazioni': '/impostazioni.html', '/conte': '/conte.html' }

function serveFile(req, res, file, cache, headers = {}) {
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
      ...headers,
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

// ─── HTTPS e certificato di casa (architettura-locale §4) ─────

const HTTPS_PORT = config.https ? config.https.porta || 8443 : null
const CA_FILE = config.https?.ca
const CA_FINGERPRINT = CA_FILE && fs.existsSync(CA_FILE) ? new crypto.X509Certificate(fs.readFileSync(CA_FILE)).fingerprint256 : null
const isLoopback = ip => /^(127\.|::1$|::ffff:127\.)/.test(ip || '')
// Il nome con cui il tablet ha chiamato il PC (192.168.…, gestionale.desimone.lan), solo se è un nome normale
const requestHost = req => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '')
  return /^[a-z0-9.-]{1,253}$/i.test(host) ? host : null
}

// Dalla rete, con l'HTTPS acceso, in http restano solo il certificato e /salute: le pagine passano a https e il
// resto (accesso, dati, foto) si rifiuta, così la password non passa mai in chiaro nel Wi-Fi
function toHttps(req, res, url) {
  const host = requestHost(req)
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !host) {
    return send(res, 403, { error: `Dalla rete si entra in https: https://${host || 'indirizzo-del-PC'}:${HTTPS_PORT}` })
  }
  res.writeHead(302, { Location: `https://${host}:${HTTPS_PORT}${url}`, 'Cache-Control': 'no-store' })
  res.end()
}

function certificatePage(req, res, pathname) {
  if (!CA_FINGERPRINT) return send(res, 404, 'HTTPS non attivo: node sede\\installa.js … --https si')
  // iPhone e iPad (anche iPadOS, che si presenta come Mac): Safari installa il certificato come profilo solo se il
  // file si apre, non se si scarica. Android invece lo deve scaricare (dal browser non si installa più)
  const apple = /iPhone|iPad|iPod|Macintosh/.test(req.headers['user-agent'] || '')
  if (pathname === '/certificato/ca-desimone.crt') {
    return serveFile(req, res, CA_FILE, 'no-cache', {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': `${apple ? 'inline' : 'attachment'}; filename="ca-desimone.crt"` })
  }
  const host = requestHost(req) || 'indirizzo-del-PC'
  const android = `<ol start="2">
<li>Apri <strong>Impostazioni</strong> → <strong>Sicurezza</strong> (o Sicurezza e privacy) → <strong>Altre impostazioni di sicurezza</strong> → <strong>Crittografia e credenziali</strong> → <strong>Installa un certificato</strong> → <strong>Certificato CA</strong>. Se non lo trovi, cerca "certificato" nelle Impostazioni.</li>
<li>Conferma con <strong>Installa comunque</strong> e scegli <code>ca-desimone.crt</code> nella cartella Download. Se il tablet non ha un blocco schermo (PIN), te lo fa impostare.</li>
<li>Chiudi il browser e riaprilo.</li>
</ol>`
  const ios = `<ol start="2">
<li>Apri questa pagina con <strong>Safari</strong> (con altri browser il profilo non si scarica). Al tocco su "Scarica il certificato" scegli <strong>Consenti</strong>.</li>
<li><strong>Impostazioni</strong> → in alto <strong>Profilo scaricato</strong> (oppure Generali → VPN e gestione dispositivi) → <strong>Installa</strong>, codice del dispositivo, di nuovo <strong>Installa</strong>.</li>
<li><strong>Impostazioni</strong> → <strong>Generali</strong> → <strong>Info</strong> → in fondo <strong>Impostazioni certificati attendibili</strong> → accendi <strong>De Simone - autorita di casa</strong> → Continua. <strong>Senza questo passo Safari non si fida.</strong></li>
</ol>`
  send(res, 200, `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Certificato della sede</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:640px;padding:16px;color:#222;background:#fff}
a.b{display:block;margin:16px 0;padding:14px;border-radius:8px;background:#7a3b2e;color:#fff;text-align:center;text-decoration:none;font-weight:600}
code{word-break:break-all;font-size:13px}li{margin:6px 0}details{margin:16px 0;color:#555}</style></head><body>
<h1>Gestionale De Simone: certificato della sede</h1>
<p>Da fare <strong>una volta sola</strong> su ogni tablet o telefono, perché si fidi del PC della sede e apra il gestionale in modo sicuro (https).</p>
<a class="b" href="/certificato/ca-desimone.crt">1. Scarica il certificato</a>
${apple ? ios : android}
<a class="b" href="https://${host}:${HTTPS_PORT}/">5. Apri il gestionale (https)</a>
<details><summary>${apple ? 'È un dispositivo Android?' : 'È un iPhone o un iPad?'}</summary>${apple ? android : ios}</details>
<p>Impronta SHA-256 del certificato, da confrontare con quella scritta da <code>installa.js</code> sul PC della sede:<br><code>${CA_FINGERPRINT}</code></p>
</body></html>`, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
}

// ─── Instradamento ────────────────────────────────────────────

async function handle(req, res) {
  const { pathname, search } = new URL(req.url, 'http://sede')
  try {
    if (pathname === '/certificato' || pathname.startsWith('/certificato/')) return certificatePage(req, res, pathname)
    if (pathname === '/salute') return send(res, 200, { servizio: 'ok', ora: new Date().toISOString() })
    if (HTTPS_PORT && !req.socket.encrypted && !isLoopback(req.socket.remoteAddress)) return toHttps(req, res, pathname + search)
    if (pathname === '/auth/login' && req.method === 'POST') return await login(req, res)
    if (pathname === '/auth/password' && req.method === 'POST') return await changePassword(req, res)
    if (pathname === '/auth/logout' && req.method === 'POST') return send(res, 200, {}, { 'Set-Cookie': photoCookie(req, '', 0) })
    if (pathname.startsWith('/rest/v1/')) return proxy(req, res, pathname.slice('/rest/v1'.length) + search)
    if (pathname === '/foto-elimina' && req.method === 'POST') return await deletePhotos(req, res)
    if (pathname.startsWith('/foto/')) return await photos(req, res, pathname.slice('/foto/'.length))
    if (pathname === '/copia/stato' && req.method === 'GET') return await backup(req, res, 'stato')
    if (pathname === '/copia/adesso' && req.method === 'POST') return await backup(req, res, 'adesso')
    return app(req, res, pathname)
  } catch (err) {
    log('errore', req.method, pathname, err.message)
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Errore del servizio della sede' })
  }
}

// HTTP sul PC server (localhost) e, con indirizzo 0.0.0.0, dalla rete locale; HTTPS col certificato di casa per i
// tablet (architettura-locale §4). In entrambi i casi solo dalla rete locale (onlyLocal)
const port = config.porta || 8080
const address = config.indirizzo || '127.0.0.1'
const lanUrls = p => Object.values(os.networkInterfaces()).flat()
  .filter(i => i.family === 'IPv4' && !i.internal && isLocalAddress(i.address)).map(i => `http${p === port ? '' : 's'}://${i.address}:${p}`)
onlyLocal(http.createServer(handle)).listen(port, address, () => {
  log(`servizio della sede su http://${address}:${port}`)
  if (address === '0.0.0.0') log('dalla rete locale:', lanUrls(port).join(', ') || 'nessuna rete collegata')
})
copia.avvia()
if (config.https) {
  // Il certificato di casa (installa.js --https si) è un .pfx con la sua password; certificato e chiave .pem vanno
  // ancora bene
  const options = config.https.pfx
    ? { pfx: fs.readFileSync(config.https.pfx), passphrase: config.https.password }
    : { cert: fs.readFileSync(config.https.certificato), key: fs.readFileSync(config.https.chiave) }
  onlyLocal(https.createServer(options, handle)).listen(HTTPS_PORT, address, () => {
    log(`HTTPS su https://${address}:${HTTPS_PORT}`)
    if (address === '0.0.0.0') log('dalla rete locale:', lanUrls(HTTPS_PORT).join(', '), `(certificato per i tablet: http://…:${port}/certificato)`)
  })
}
