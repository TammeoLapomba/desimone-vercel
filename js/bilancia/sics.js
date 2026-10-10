// bilancia/banco-prova/sics.js — Protocollo MT-SICS delle bilance Mettler Toledo (manuale in bilancia/)
//
// Comandi e risposte sono righe ASCII chiuse da CR LF. Le risposte con un peso hanno la forma
// "<ID> <Stato> <Peso> <Unità>", con il peso allineato a destra su 10 caratteri: "S S     14.256 g".
// La SB16001 del cliente (MT-SICS Basic-S) scrive invece lo stato attaccato all'ID e l'ultima cifra tra
// parentesi: "S       76.(3) g" stabile, "SD      25.(8) g" in movimento (letta il 06/10/2026).
// Il manuale chiede di aspettare la risposta prima di mandare il comando successivo (§2.4), quindi
// SicsClient tiene i comandi in coda e ne manda uno alla volta.
//
// Non dipende dal trasporto (Web Serial, simulatore, in futuro un servizio sul PC server): riceve testo e
// restituisce righe interpretate. Nella WBA è il componente logico L-09 "Interfaccia bilancia" (F-03).
//
// Script classico, non modulo ES: vedi pesi.js.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pesi.js'))
  else root.SICS = factory(root.Pesi)
})(typeof self !== 'undefined' ? self : this, function (Pesi) {
  // Codici delle unità del comando M21
  const UNIT_CODES = {
    0: 'g', 1: 'kg', 2: 't', 3: 'mg', 4: 'µg', 5: 'ct', 6: 'N', 7: 'lb', 8: 'oz', 9: 'ozt', 10: 'GN',
    11: 'dwt', 12: 'mom', 13: 'msg', 14: 'tlh', 15: 'tls', 16: 'tlt', 17: 'tcl', 18: 'tola', 19: 'baht',
    25: 'nessuna', 26: 'PCS', 27: '%'
  }

  const GENERAL_ERRORS = {
    ES: 'Comando non riconosciuto o non disponibile su questo modello',
    ET: 'Errore di trasmissione: la bilancia ha ricevuto caratteri rovinati (baud? parità?)',
    EL: 'La bilancia non può eseguire il comando'
  }

  const STATUS_ERRORS = {
    '+': 'Sovraccarico: oltre la portata della bilancia',
    '-': 'Sottocarico: il piatto è al suo posto?',
    I: 'Non eseguibile ora: bilancia occupata o peso non stabile entro il suo tempo limite',
    L: 'Non eseguibile: parametro errato o funzione non disponibile'
  }

  // Per zero e tara, + e - indicano il campo ammesso dall'operazione, non la portata
  function errorMessage (id, code) {
    if ((id === 'Z' || id === 'ZI') && (code === '+' || code === '-')) {
      return 'Fuori dal campo di azzeramento: per un contenitore si usa la tara'
    }
    if ((id === 'T' || id === 'TI') && code === '+') return 'Oltre il campo di tara'
    if ((id === 'T' || id === 'TI') && code === '-') return 'Sotto il campo di tara: un peso negativo non si tara'
    return STATUS_ERRORS[code]
  }

  // Risposte con un peso: S (S, SI, SIR, SU, ST…), T e TI (tara eseguita), TA (tara in memoria).
  // Stati: S stabile, D in movimento, M e N come S e D ma sotto il limite MinWeigh, A per TA.
  const WEIGHT_IDS = new Set(['S', 'T', 'TI', 'TA'])
  const WEIGHT_STATUSES = new Set(['S', 'D', 'M', 'N', 'A'])

  // Peso in Basic-S della linea SB: "S" e in seconda colonna lo stato, spazio stabile o D in movimento
  const BASIC_WEIGHT = /^S([ D])\s*([+-]?[\d.()]+)\s+(\S+)$/

  // Un peso che non è in formato MT-SICS: per esempio l'uscita per la stampante o per PC-Direct
  const LOOSE_WEIGHT = /(^|\s)-?\d+[.,]\d+(\s*(g|mg|kg|ct|ozt|dwt|GN))?\s*$/

  // Spezza il flusso in righe. Di fabbrica la bilancia chiude con CR LF, ma con M91 può usare solo CR o LF.
  class LineSplitter {
    constructor (maxLength = 1024) {
      this.buffer = ''
      this.maxLength = maxLength
    }

    push (text) {
      this.buffer += text
      const lines = this.buffer.split(/\r\n|\r|\n/)
      this.buffer = lines.pop()
      if (this.buffer.length > this.maxLength) {
        // Nessun fine riga da troppo: baud sbagliato o un formato che non è MT-SICS
        lines.push(this.buffer)
        this.buffer = ''
      }
      return lines.filter(line => line !== '')
    }
  }

  // 'I4 A "B021002593"' → ['I4', 'A', 'B021002593']: tra virgolette lo spazio non separa e \" è una virgoletta
  function tokenize (line) {
    const tokens = []
    let current = null
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '\\' && i + 1 < line.length) current += line[++i]
        else if (ch === '"') quoted = false
        else current += ch
      } else if (ch === '"') {
        quoted = true
        current = current ?? ''
      } else if (ch === ' ' || ch === '\t') {
        if (current !== null) tokens.push(current)
        current = null
      } else {
        current = (current ?? '') + ch
      }
    }
    if (current !== null) tokens.push(current)
    return tokens
  }

  // Molti caratteri fuori dall'ASCII stampabile: quasi sempre baud, bit di dati o parità diversi dalla bilancia
  function isGarbage (line) {
    let bad = 0
    for (const ch of line) {
      const c = ch.codePointAt(0)
      if ((c < 32 && c !== 9) || (c > 126 && c !== 0xB5 && c !== 0x3BC)) bad++
    }
    return bad > 0 && bad / line.length > 0.2
  }

  // Riga con un peso; null se il valore non è un numero. "76.(3)" vale 76.3: la SB16001 mette tra
  // parentesi l'ultima cifra, e bracketed lo ricorda
  function weightLine (raw, id, status, valueText, unit) {
    const value = valueText.replace(/[()]/g, '')
    if (!Pesi.parseDecimal(value)) return null
    return {
      raw,
      kind: 'weight',
      id,
      status,
      value,
      unit,
      decimals: (value.split('.')[1] || '').length,
      stable: status !== 'D' && status !== 'N',
      belowMinWeigh: status === 'M' || status === 'N',
      bracketed: /\(\d+\)$/.test(valueText),
      mg: Pesi.toMilligrams(value, unit)
    }
  }

  // Una riga ricevuta → { raw, kind, id, … }, con kind tra weight, reply, error, garbage e unknown
  function parseLine (raw) {
    const line = raw.trim()
    if (isGarbage(line)) {
      return { raw, kind: 'garbage', id: null, message: 'Caratteri illeggibili: baud, bit di dati o parità diversi da quelli della bilancia' }
    }
    const basic = BASIC_WEIGHT.exec(line)
    if (basic) {
      const weight = weightLine(raw, 'S', basic[1] === 'D' ? 'D' : 'S', basic[2], basic[3])
      if (weight) return weight
    }

    const tokens = tokenize(line)
    const [id = '', status] = tokens

    if (tokens.length === 1 && GENERAL_ERRORS[id]) return { raw, kind: 'error', id, code: id, message: GENERAL_ERRORS[id] }

    if (WEIGHT_IDS.has(id) && tokens.length >= 3 && WEIGHT_STATUSES.has(status)) {
      let [, , value, unit = ''] = tokens
      // Segno staccato dalle cifre ("S S - 12.345 g"): non dovrebbe capitare, ma costa poco
      if ((value === '-' || value === '+') && tokens.length >= 4) [value, unit] = [value + tokens[3], tokens[4] || '']
      const weight = weightLine(raw, id, status, value, unit)
      if (weight) return weight
    }

    if (tokens.length >= 2 && (status === 'A' || status === 'B')) {
      return { raw, kind: 'reply', id, status, params: tokens.slice(2), final: status === 'A' }
    }
    if (tokens.length === 2 && (status === 'S' || status === 'D')) {
      return { raw, kind: 'reply', id, status, params: [], final: true } // ZI S, ZI D
    }
    if (tokens.length === 2 && STATUS_ERRORS[status]) {
      return { raw, kind: 'error', id, code: status, message: errorMessage(id, status) }
    }
    return {
      raw,
      kind: 'unknown',
      id,
      message: LOOSE_WEIGHT.test(line)
        ? 'Sembra un peso, ma non in formato MT-SICS: l\'interfaccia della bilancia è forse impostata come stampante o PC-Direct invece che come Host'
        : 'Riga non MT-SICS'
    }
  }

  // Descrizione breve di una riga, per il terminale
  function describeLine (line) {
    if (line.kind === 'reply') return line.status === 'B' ? 'continua…' : 'ok'
    if (line.kind !== 'weight') return line.message
    const what = line.id === 'TA' ? 'tara in memoria'
      : line.id === 'T' || line.id === 'TI' ? 'tara eseguita'
        : line.stable ? 'peso stabile' : 'peso in movimento'
    if (line.mg === null) return `${what}, unità "${line.unit}" non convertibile in grammi`
    const original = line.unit === 'g' ? '' : ` (${line.value} ${line.unit})`
    return `${what} ${Pesi.formatGrams(line.mg)}${original}${line.belowMinWeigh ? ', sotto il MinWeigh' : ''}${line.bracketed ? ', ultima cifra tra parentesi' : ''}`
  }

  const commandName = command => command.trim().split(/\s+/)[0]

  // La famiglia S risponde con l'ID "S"; "@" risponde con il numero di serie (I4)
  const S_FAMILY = new Set(['S', 'SI', 'SIR', 'SU', 'SIU', 'SIRU', 'SR', 'SRU', 'SNR', 'SNRU', 'SIUM', 'SUM'])
  // Comandi che fanno inviare pesi di continuo, finché un altro comando della famiglia S, @ o C non li ferma
  const STREAM_COMMANDS = new Set(['SIR', 'SIRU', 'SR', 'SRU', 'SNR', 'SNRU'])
  // Comandi che aspettano il peso stabile: la bilancia ha già un suo tempo limite, il nostro è più largo
  const SLOW_COMMANDS = new Set(['S', 'SU', 'SUM', 'T', 'Z', 'C', '@', 'I0'])

  function replyIds (command) {
    const name = commandName(command)
    if (name === '@') return ['I4']
    if (S_FAMILY.has(name)) return ['S', name]
    return [name]
  }

  // Il peso da accettare: stabile e convertibile in grammi (REQ-I-04, REQ-U-05)
  function acceptStable (line) {
    if (!line) throw new Error('Nessuna risposta dalla bilancia')
    if (line.kind === 'error') throw new Error(line.message)
    if (line.kind !== 'weight' || !line.stable) throw new Error('La bilancia non ha dato un peso stabile')
    if (line.mg === null) throw new Error(`Unità "${line.unit}" non convertibile in grammi`)
    return line
  }

  // Coda dei comandi verso la bilancia: uno alla volta, ognuno con le sue righe di risposta (una sola, oppure
  // righe con stato B chiuse da una con stato A). Le righe che non rispondono al comando in corso (flusso
  // continuo, tasto di trasferimento, I4 all'accensione) arrivano a onLine come non richieste.
  class SicsClient {
    constructor ({ write, onLine = () => {} }) {
      this.write = write          // (testo) → manda i caratteri alla bilancia, anche con una Promise
      this.onLine = onLine        // (riga, richiesta) per ogni riga ricevuta
      this.splitter = new LineSplitter()
      this.queue = []
      this.current = null
      this.streaming = null       // comando ripetuto attivo (SIR, SR…) oppure null
      this.listeners = new Set()  // chi aspetta righe non richieste: leggiPesoStabile con il flusso attivo
    }

    get busy () {
      return this.current !== null || this.queue.length > 0
    }

    // Testo arrivato dal trasporto, anche spezzato a metà riga
    feed (text) {
      for (const raw of this.splitter.push(text)) {
        const line = parseLine(raw)
        const solicited = this.#offer(line)
        this.onLine(line, solicited)
        if (!solicited) for (const listener of [...this.listeners]) listener(line)
      }
    }

    // Manda un comando e restituisce le sue righe di risposta. Gli errori della bilancia (ES, "S I"…) sono
    // righe con kind "error": la promessa fallisce solo senza risposta o se il trasporto non riesce a scrivere.
    send (command, { timeout } = {}) {
      return new Promise((resolve, reject) => {
        const name = commandName(command)
        this.queue.push({
          command,
          name,
          ids: replyIds(command),
          timeout: timeout ?? (SLOW_COMMANDS.has(name) ? 15000 : 3000),
          lines: [],
          resolve,
          reject
        })
        this.#next()
      })
    }

    // S-06 · L-09 Interfaccia bilancia::leggiPesoStabile(): solo un peso che la bilancia dichiara stabile
    // (REQ-I-03, REQ-I-04). Con il flusso continuo attivo vale il prossimo peso stabile del flusso; altrimenti
    // si manda "S", a cui la bilancia risponde quando il peso si ferma (o con "S I" allo scadere del suo tempo).
    leggiPesoStabile ({ timeout = 15000 } = {}) {
      if (!this.streaming) return this.send('S', { timeout }).then(lines => acceptStable(lines[lines.length - 1]))
      return new Promise((resolve, reject) => {
        const finish = (error, line) => {
          clearTimeout(timer)
          this.listeners.delete(listener)
          if (error) reject(error)
          else resolve(line)
        }
        const listener = line => {
          if (line.kind === 'closed' || (line.id === 'S' && line.kind === 'error')) return finish(new Error(line.message))
          if (line.id !== 'S' || line.kind !== 'weight' || !line.stable) return
          try {
            finish(null, acceptStable(line))
          } catch (err) {
            finish(err)
          }
        }
        const timer = setTimeout(() => finish(new Error('Il peso non si è fermato entro il tempo limite: corrente d\'aria o vibrazioni?')), timeout)
        this.listeners.add(listener)
      })
    }

    // Collegamento chiuso: falliscono i comandi in attesa e chi aspetta un peso
    close (reason = 'Collegamento chiuso') {
      const pending = [this.current, ...this.queue].filter(Boolean)
      this.current = null
      this.queue = []
      this.streaming = null
      for (const request of pending) {
        clearTimeout(request.timer)
        request.reject(new Error(reason))
      }
      for (const listener of [...this.listeners]) listener({ kind: 'closed', id: null, message: reason })
    }

    #next () {
      if (this.current || this.queue.length === 0) return
      const request = this.current = this.queue.shift()
      if (STREAM_COMMANDS.has(request.name)) this.streaming = request.name
      else if (S_FAMILY.has(request.name) || request.name === '@' || request.name === 'C') this.streaming = null
      request.timer = setTimeout(() => {
        this.#finish(new Error(`Nessuna risposta a "${request.command}" entro ${request.timeout / 1000} s`))
      }, request.timeout)
      Promise.resolve()
        .then(() => this.write(`${request.command}\r\n`))
        .catch(err => { if (this.current === request) this.#finish(err) })
    }

    // La riga risponde al comando in corso? Gli errori generali (ES, ET, EL) rispondono sempre a lui.
    #offer (line) {
      const request = this.current
      if (!request) return false
      const generalError = line.kind === 'error' && GENERAL_ERRORS[line.id] !== undefined
      if (!generalError && !request.ids.includes(line.id)) return false
      request.lines.push(line)
      if (!(line.kind === 'reply' && line.status === 'B')) this.#finish(null)
      return true
    }

    #finish (error) {
      const request = this.current
      if (!request) return
      clearTimeout(request.timer)
      this.current = null
      // Un flusso rifiutato non parte; sovraccarico e sottocarico invece fanno parte del flusso
      const last = request.lines[request.lines.length - 1]
      const refused = error || (last?.kind === 'error' && last.code !== '+' && last.code !== '-')
      if (STREAM_COMMANDS.has(request.name) && refused) this.streaming = null
      if (error) request.reject(error)
      else request.resolve(request.lines)
      this.#next()
    }
  }

  return { UNIT_CODES, LineSplitter, tokenize, parseLine, describeLine, commandName, replyIds, SicsClient }
})
