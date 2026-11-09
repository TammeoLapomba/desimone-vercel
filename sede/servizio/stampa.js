// sede/servizio/stampa.js — Il servizio di stampa delle etichette verso la QL-800 (pacchetto 3.3, I5, P-07, P-12)
//
// Come in STEP, l'app non stampa: mette le etichette in coda (print_jobs, 045). Qui, ogni pochi secondi, il servizio
// della sede prende la più vecchia in coda (print_service_next, 047), la disegna e la manda alla stampante di Windows
// con sede\stampa.ps1, che usa solo ciò che c'è in Windows (System.Drawing). Poi dice com'è andata
// (print_service_done): stampata, oppure errore con il motivo, che si vede nella pagina Etichette.
// All'avvio, ciò che era a metà torna in errore (print_service_reset): non si sa se era uscito.
//
// Il disegno è lo stesso dell'anteprima dell'app (js/etichetta.js, LABEL_CSS), in millimetri: gioiello 62×29 con
// esterno e interno, una pagina per faccia e per copia; semilavorato 62×29 singola. Il QR lo calcola la stessa libreria
// dell'app, js/vendor/qrcode-generator-1.4.4.js. Se si cambia una misura, va cambiata in tutti e due i posti.
//
// sede.json: "stampante": { "nome": "Brother QL-800" } (installa.js --stampante). Con "cartellaProva" la stampa va
// su file, per provare senza la stampante con "Microsoft Print to PDF". Una sola stampante (Lollino, 08/11/2026).
// Solo moduli di Node.js (REQ-003).

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')

const W = 62
const H = 29
const PT = 25.4 / 72                    // un punto tipografico in millimetri
const LINE = 1.2                        // interlinea, come nel CSS
const RED = '#C8352B'

const euro = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} €`
const grams = n => `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} gr`

// Le righe del QR come stringhe di 0 e 1, con 2 moduli di margine come nell'app
function qrRows(qrcode, text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const rows = []
  for (let r = -2; r < n + 2; r++) {
    let row = ''
    for (let c = -2; c < n + 2; c++) row += r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c) ? '1' : '0'
    rows.push(row)
  }
  return rows
}

const text = (s, x, y, w, pt, extra = {}) => ({ t: 'testo', s: String(s), x, y, w, h: pt * PT * LINE * (extra.righe || 1), pt, ...extra })

// Le pagine di una copia, con gli elementi in millimetri. job come in print_jobs
function pages(job, rows) {
  const lines = Array.isArray(job.lines) ? job.lines : []
  if (job.template === 'gioiello') {
    // Esterno: logo provvisorio (archetto di perline rosse e nome, scheda 3.2) e QR
    const beads = []
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.12 + 0.76 * i / 8)
      beads.push({ t: 'punto', x: 15.5 - 5 * Math.cos(a), y: 7.5 + 3.2 * Math.sin(a), r: 0.28 + 0.22 * Math.sin(a), colore: RED })
    }
    const esterno = [
      ...beads,
      text('ANTONINO DE SIMONE', 1.5, 13.5, 28, 5.2, { font: 'Georgia', centro: true }),
      { t: 'qr', x: 35.5, y: 4.5, lato: 22, righe: rows },
    ]
    // Interno: righe e codice a sinistra, prezzo e peso a destra
    const step = 5.6 * PT * LINE
    const interno = lines.slice(0, 8).map((l, i) => text(l, 2.5, 3.5 + i * step, 27.5, 5.6))
    interno.push(text(job.code, 2.5, H - 1.5 - step, 27.5, 5.6))
    const right = []
    if (job.price != null) right.push([euro(job.price), 9])
    if (job.weight_g != null) right.push([grams(job.weight_g), 6.5])
    let y = 3 + (H - 5 - right.reduce((t, [, pt]) => t + pt * PT * LINE, 0)) / 2
    for (const [s, pt] of right) {
      interno.push(text(s, 32.5, y, 28, pt, { centro: true }))
      y += pt * PT * LINE
    }
    return [esterno, interno]
  }
  // Semilavorato: QR a sinistra, codice, contenuto e righe a destra
  const el = [{ t: 'qr', x: 2, y: 1.5, lato: 26, righe: rows }]
  let y = 3
  el.push(text(job.code, 30.5, y, 29.5, 12, { grassetto: true }))
  y += 12 * PT * LINE + 0.8
  el.push(text(job.name, 30.5, y, 29.5, 7, { a_capo: true, righe: 4 }))
  y += 7 * PT * LINE * 4 + 0.8
  for (const l of lines) {
    if (y > H - 2) break
    el.push(text(l, 30.5, y, 29.5, 6))
    y += 6 * PT * LINE
  }
  return [el]
}

function createStampa(config, log, rpc) {
  const conf = config.stampante || null
  const script = path.join(__dirname, '..', 'stampa.ps1')
  const qrcode = require(path.join(path.resolve(config.cartellaApp), 'js', 'vendor', 'qrcode-generator-1.4.4.js'))
  let busy = false
  let reset = false
  let lastProblem = ''

  // Una richiesta: tutte le copie in un solo documento di Windows
  function print(job) {
    if (process.platform !== 'win32') return Promise.reject(new Error('La stampa sulla QL-800 c\'è solo nel PC della sede (Windows)'))
    // Su un PDF senza cartella Windows aprirebbe "Salva con nome", che nel servizio nessuno vede: resterebbe fermo
    if (/print to pdf/i.test(conf.nome) && !conf.cartellaProva) {
      return Promise.reject(new Error('Con "Microsoft Print to PDF" serve una cartella: rilancia installa.js --stampante "Microsoft Print to PDF"'))
    }
    const rows = qrRows(qrcode, job.code)
    const one = pages(job, rows)
    const pagine = []
    for (let i = 0; i < job.copies; i++) pagine.push(...one)
    const file = path.join(os.tmpdir(), `desimone-etichetta-${job.id}.json`)
    fs.writeFileSync(file, JSON.stringify({ nome: `Etichetta ${job.code}`, w: W, h: H, pagine }), 'utf8')
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Lavoro', file, '-Stampante', conf.nome]
    if (conf.cartellaProva) {
      fs.mkdirSync(conf.cartellaProva, { recursive: true })
      args.push('-SuFile', path.join(conf.cartellaProva, `${job.code.replace(/[^\w.-]/g, '_')}-${job.id.slice(0, 8)}.pdf`))
    }
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', args, { timeout: 120 * 1000, windowsHide: true }, (err, stdout, stderr) => {
        fs.rm(file, { force: true }, () => {})
        if (err) reject(new Error((stderr || err.message).trim().split(/\r?\n/).filter(l => !/^\s*(\+|In |CategoryInfo|FullyQualified)/.test(l)).slice(0, 2).join(' ') || 'Errore di stampa'))
        else resolve(stdout)
      })
    })
  }

  // Un giro: finché c'è qualcosa in coda, una richiesta alla volta
  async function round() {
    if (busy) return
    busy = true
    try {
      if (!reset) {
        const n = await rpc('print_service_reset', {})
        reset = true
        if (n) log(`etichette: ${n} erano a metà quando il servizio si è fermato, ora sono in errore`)
      }
      for (;;) {
        const [job] = (await rpc('print_service_next', {})) || []
        if (!job) break
        try {
          await print(job)
          await rpc('print_service_done', { p_id: job.id, p_ok: true, p_error: null })
          log(`etichetta stampata: ${job.code}, ${job.copies} ${job.copies === 1 ? 'copia' : 'copie'}`)
        } catch (err) {
          log(`etichetta non stampata: ${job.code}: ${err.message}`)
          await rpc('print_service_done', { p_id: job.id, p_ok: false, p_error: err.message.slice(0, 300) })
        }
      }
      lastProblem = ''
    } catch (err) {
      // PostgREST non ancora acceso, o fermo: si riprova al giro dopo. Nel log una volta sola
      if (err.message !== lastProblem) log('etichette: coda non raggiungibile:', err.message)
      lastProblem = err.message
    } finally {
      busy = false
    }
  }

  return {
    attiva: !!conf?.nome,
    avvia() {
      if (!conf?.nome) return log('etichette: nessuna stampante in sede.json, si stampano dal browser (installa.js --stampante)')
      log(`etichette: stampante "${conf.nome}"${conf.cartellaProva ? `, su file in ${conf.cartellaProva} (prova)` : ''}`)
      setInterval(round, (conf.attesa || 5) * 1000).unref()
      round()
    },
  }
}

module.exports = { createStampa, pages, qrRows }
