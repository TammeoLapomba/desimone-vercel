// sede/servizio/copia.js — Copia di sicurezza della sede (pacchetto 7.2, REQ-I-02, WBA L-12/F-21)
//
// Come chiede architettura-locale.md §8:
//   - ogni notte, all'ora di sede.json (copia.ora, di solito 02:00), una copia del database e delle foto nella
//     cartella copia.cartella: un disco dedicato (piano, 7.2); si sceglie con installa.js --copia;
//   - si tengono le copie degli ultimi copia.giorni giorni (30) e la prima di ogni mese per copia.mesi mesi (12);
//   - ogni copia si controlla subito: pg_restore deve leggerla e trovarci movimenti e migrazioni;
//   - lo stato (ultima copia, esito, spazio libero, avvisi) è in <dati>\copia-stato.json e lo mostra la pagina
//     Giacenze all'amministrazione, che può anche chiedere "Copia adesso" (servizio.js, /copia/…).
// Il database: un file di pg_dump (formato custom), letto dal ruolo "copia" (solo lettura, creato da installa.js).
// Le foto: si aggiungono alla cartella foto della copia e non si cancellano mai, perché le copie vecchie le citano.
// Ripristino: sede/ripristina.js. Solo moduli di Node.js (REQ-003).
//
// Anche a mano, sul PC server:   node sede\servizio\copia.js C:\DeSimone\dati\sede.json [adesso|stato]

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')

const NAME = /^desimone-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/
const DAY = 24 * 3600 * 1000

// Quali copie tenere: quelle degli ultimi `days` giorni, più la prima di ognuno degli ultimi `months` mesi.
// La più recente resta sempre. `files` sono nomi desimone-AAAAMMGG-HHMMSS.dump; risponde i nomi da cancellare.
function toDelete(files, now = new Date(), days = 30, months = 12) {
  const copies = files.map(f => {
    const m = NAME.exec(f)
    return m && { f, at: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]), month: `${m[1]}-${m[2]}` }
  }).filter(Boolean).sort((a, b) => a.at - b.at)
  if (!copies.length) return []
  const keep = new Set([copies[copies.length - 1].f])
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const seenMonth = new Set()
  for (const c of copies) {
    if (now - c.at <= days * DAY) keep.add(c.f)
    if (c.at >= firstMonth && !seenMonth.has(c.month)) { seenMonth.add(c.month); keep.add(c.f) }
  }
  return copies.filter(c => !keep.has(c.f)).map(c => c.f)
}

const stamp = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
  '-' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join('')

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split(/\r?\n/).slice(-3).join(' ')))
      else resolve(stdout)
    })
  })
}

// Le foto nuove nella cartella della copia; quelle che ci sono già, con la stessa dimensione, non si ricopiano
async function copyPhotos(from, to) {
  let added = 0
  if (!fs.existsSync(from)) return added
  for (const entry of await fs.promises.readdir(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const src = path.join(entry.parentPath ?? entry.path, entry.name)
    const dst = path.join(to, path.relative(from, src))
    const st = await fs.promises.stat(src)
    const old = await fs.promises.stat(dst).catch(() => null)
    if (old && old.size === st.size) continue
    await fs.promises.mkdir(path.dirname(dst), { recursive: true })
    await fs.promises.copyFile(src, dst)
    added++
  }
  return added
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize } catch { return null }
}

function createCopia(config, configPath, log = () => {}) {
  const opt = config.copia || {}
  const dest = opt.cartella ? path.resolve(opt.cartella) : null
  const dataDir = path.dirname(path.resolve(configPath))
  const statusFile = path.join(dataDir, 'copia-stato.json')
  const pgBin = config.pgBin || ''
  const db = config.database || {}
  const exe = name => path.join(pgBin, process.platform === 'win32' ? `${name}.exe` : name)
  let running = null
  let timer = null

  const readStatus = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')) } catch { return {} } }
  const writeStatus = s => fs.writeFileSync(statusFile, JSON.stringify(s, null, 2) + '\n')

  // Cosa vede l'amministrazione: ultima copia, prossima, spazio e avvisi
  function stato() {
    const s = readStatus()
    const avvisi = []
    if (!dest) avvisi.push('Manca la cartella della copia: lanciare installa.js con --copia')
    else if (!fs.existsSync(path.parse(dest).root)) avvisi.push(`Il disco della copia (${path.parse(dest).root}) non è collegato`)
    if (dest && path.parse(dest).root.toLowerCase() === path.parse(dataDir).root.toLowerCase()) {
      avvisi.push('La copia è sullo stesso disco dei dati: protegge dagli errori, non da un guasto del disco')
    }
    if (s.ultima?.esito === 'errore') avvisi.push(`L'ultima copia non è riuscita: ${s.ultima.errore}`)
    const lastOk = s.ultimaRiuscita ? new Date(s.ultimaRiuscita.fine) : null
    if (!lastOk) avvisi.push('Non c\'è ancora nessuna copia riuscita')
    else if (Date.now() - lastOk > 26 * 3600 * 1000) avvisi.push(`L'ultima copia riuscita è del ${lastOk.toLocaleString('it-IT')}`)
    return {
      cartella: dest, ora: opt.ora || '02:00', inCorso: !!running, prossima: s.prossima || null,
      ultima: s.ultima || null, ultimaRiuscita: s.ultimaRiuscita || null,
      copie: s.copie ?? null, liberoByte: dest ? freeBytes(fs.existsSync(dest) ? dest : path.parse(dest).root) : null,
      avvisi,
    }
  }

  async function esegui(motivo) {
    const inizio = new Date()
    log('copia di sicurezza', motivo, '→', dest)
    const s = readStatus()
    try {
      if (!dest) throw new Error('manca la cartella della copia in sede.json (installa.js --copia)')
      if (!fs.existsSync(path.parse(dest).root)) throw new Error(`il disco ${path.parse(dest).root} non è collegato`)
      if (!config.segretoCopia) throw new Error('manca la password del ruolo copia: rilanciare installa.js')
      fs.mkdirSync(dest, { recursive: true })
      const file = path.join(dest, `desimone-${stamp(inizio)}.dump`)
      const tmp = `${file}.tmp`
      const env = { ...process.env, PGPASSWORD: config.segretoCopia, PGCLIENTENCODING: 'UTF8' }
      delete env.PGOPTIONS
      await run(exe('pg_dump'), ['-h', db.host || 'localhost', '-p', String(db.porta || 5432), '-U', 'copia',
        '-d', db.nome || 'desimone', '-Fc', '-f', tmp], env)
      // Controllo: la copia si legge e contiene i dati che contano
      const list = await run(exe('pg_restore'), ['--list', tmp], env)
      for (const must of ['TABLE DATA public movements', 'TABLE DATA public articles', 'TABLE DATA sede migrazioni']) {
        if (!list.includes(must)) throw new Error(`la copia non contiene ${must.replace('TABLE DATA ', '')}`)
      }
      fs.renameSync(tmp, file)
      const foto = await copyPhotos(path.resolve(config.cartellaFoto), path.join(dest, 'foto'))
      const old = toDelete(fs.readdirSync(dest), inizio, opt.giorni || 30, opt.mesi || 12)
      for (const f of old) fs.rmSync(path.join(dest, f), { force: true })
      const ultima = {
        esito: 'ok', motivo, inizio: inizio.toISOString(), fine: new Date().toISOString(), file: path.basename(file),
        byte: fs.statSync(file).size, voci: list.split(/\r?\n/).filter(l => l && !l.startsWith(';')).length,
        fotoNuove: foto, cancellate: old,
      }
      s.ultima = ultima
      s.ultimaRiuscita = ultima
      s.copie = fs.readdirSync(dest).filter(f => NAME.test(f)).length
      log('copia di sicurezza riuscita', ultima.file, `${ultima.byte} byte, ${foto} foto nuove, ${old.length} cancellate`)
    } catch (err) {
      for (const f of fs.existsSync(dest || '') ? fs.readdirSync(dest) : []) if (f.endsWith('.dump.tmp')) fs.rmSync(path.join(dest, f), { force: true })
      s.ultima = { esito: 'errore', motivo, inizio: inizio.toISOString(), fine: new Date().toISOString(), errore: err.message }
      log('copia di sicurezza NON riuscita:', err.message)
    }
    writeStatus(s)
    return s.ultima
  }

  // Una copia alla volta; chi la chiede mentre è in corso aspetta quella
  function adesso(motivo = 'a richiesta') {
    if (!running) running = esegui(motivo).finally(() => { running = null })
    return running
  }

  // Ogni notte all'ora stabilita; all'avvio, se l'ultima copia riuscita ha più di un giorno, una subito (dopo 5 minuti)
  function programma() {
    const [h, m] = String(opt.ora || '02:00').split(':').map(Number)
    const next = new Date()
    next.setHours(h, m || 0, 0, 0)
    if (next <= new Date()) next.setDate(next.getDate() + 1)
    const s = readStatus()
    s.prossima = next.toISOString()
    writeStatus(s)
    clearTimeout(timer)
    timer = setTimeout(() => adesso('notte').finally(programma), next - Date.now())
    timer.unref?.()
    return next
  }
  function avvia() {
    if (!dest) { log('copia di sicurezza non configurata: manca copia.cartella in sede.json'); return }
    programma()
    const last = readStatus().ultimaRiuscita
    if (!last || Date.now() - new Date(last.fine) > DAY) setTimeout(() => adesso('recupero all\'avvio'), 5 * 60 * 1000).unref?.()
  }

  return { stato, adesso, avvia, toDelete }
}

module.exports = { createCopia, toDelete }

// A mano: node copia.js <sede.json> [adesso|stato]
if (require.main === module) {
  const [configPath, cmd = 'stato'] = process.argv.slice(2)
  if (!configPath) { console.error('Uso: node copia.js <percorso di sede.json> [adesso|stato]'); process.exit(1) }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const copia = createCopia(config, configPath, (...a) => console.log(...a))
  if (cmd === 'adesso') copia.adesso('a mano').then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.esito === 'ok' ? 0 : 1) })
  else console.log(JSON.stringify(copia.stato(), null, 2))
}
