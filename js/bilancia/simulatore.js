// bilancia/banco-prova/simulatore.js — Bilancia Mettler Toledo simulata che risponde in MT-SICS
//
// Serve a provare il banco senza la bilancia vera: riconosce i comandi del manuale che il banco usa e
// risponde nello stesso formato. Il peso si assesta come su una bilancia vera (prima in movimento, poi
// stabile); la corrente d'aria lo rende instabile; ci sono la tara, lo zero con il suo campo limitato, il
// sovraccarico, il piatto tolto, il tasto di trasferimento (ST) e i carati delle bilance da gioielleria.
//
// Due profili: "sb16001" imita la bilancia del cliente come l'abbiamo letta il 06/10/2026 (MT-SICS Basic-S,
// 0,1 g fino a 16100 g, solo S, SI, SIR e I4, peso nel formato "S       76.(3) g"); "standard" è una bilancia
// da laboratorio con il set MT-SICS completo del manuale e 0,001 g.
//
// Il tempo avanza solo con tick(ms): nel browser lo chiama un timer, nei test lo chiamiamo noi.
// Script classico, non modulo ES: vedi pesi.js.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.BilanciaSimulata = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  const UNIT_CODES = { g: 0, mg: 3, ct: 5 } // le unità M21 che il simulatore conosce

  // Comandi riconosciuti, con il livello MT-SICS che I0 dichiara
  const COMMANDS = {
    '@': 0, C: 0, I0: 0, I1: 0, I2: 0, I3: 0, I4: 0, S: 0, SI: 0, SIR: 0, Z: 0, ZI: 0,
    D: 1, DW: 1, K: 1, T: 1, TA: 1, TAC: 1, TI: 1,
    I10: 2, I11: 2, M21: 2, PWR: 2, SIRU: 2, SIU: 2, ST: 2, SU: 2, UPD: 2
  }

  const PROFILES = {
    standard: { model: 'JE-SIM', capacityG: 320, digitMg: 1, serial: 'SIM0001042', updateRate: 10, commands: COMMANDS, basic: false },
    // Sovraccarico e sottocarico restano nel formato del manuale ("S +", "S -"): sulla SB16001 non li abbiamo ancora visti
    sb16001: { model: 'SB16001', capacityG: 16100, digitMg: 100, serial: '0000016001', updateRate: 5, commands: { I4: 0, S: 0, SI: 0, SIR: 0 }, basic: true }
  }

  const SETTLE_TAU_MS = 250    // costante di tempo con cui la lettura insegue il peso appoggiato
  const STABLE_AFTER_MS = 600  // stabile quando resta entro una cifra per questo tempo
  const WAIT_LIMIT_MS = 8000   // tempo limite della bilancia per S, Z e T in attesa del peso stabile
  const ZERO_RANGE = 0.02      // si azzera solo entro il 2% della portata dallo zero dell'accensione

  // 14256 → "14.256": la bilancia usa sempre il punto
  function thousandths (n) {
    const abs = Math.abs(n)
    return `${n < 0 ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`
  }

  // Valore nell'unità chiesta, con la leggibilità di 0,001 g: in carati è 0,005 ct, cioè mg × 5 millesimi di ct
  function formatValue (mg, unit) {
    if (unit === 'mg') return String(mg)
    return thousandths(unit === 'ct' ? mg * 5 : mg)
  }

  // 76300 → "76.(3)": decimi di grammo con l'ultima cifra tra parentesi, come la SB16001
  function tenthsBracketed (mg) {
    const tenths = Math.round(Math.abs(mg) / 100)
    return `${mg < 0 && tenths ? '-' : ''}${Math.floor(tenths / 10)}.(${tenths % 10})`
  }

  // Riga con un peso, allineato a destra su 10 caratteri come nel manuale: "S S     14.256 g"
  const weightLine = (id, status, mg, unit) => `${id} ${status} ${formatValue(mg, unit).padStart(10)} ${unit}`

  // Lo stesso in Basic-S: stato attaccato alla S (spazio stabile, D in movimento), sempre in grammi
  const basicWeightLine = (status, mg) => `S${status === 'D' ? 'D' : ' '}${tenthsBracketed(mg).padStart(12)} g`

  const unquote = token => token.startsWith('"') ? token.slice(1, -1).replace(/\\(.)/g, '$1') : token

  class BilanciaSimulata {
    constructor ({ onOutput = () => {}, random = Math.random, profile = 'standard' } = {}) {
      this.onOutput = onOutput   // (testo) che la bilancia manda sulla seriale
      this.random = random
      this.balanceId = 'Laboratorio'
      this.setProfile(profile)
      this.t = 0                 // tempo simulato, ms
      this.loadMg = 0            // ciò che è appoggiato sul piatto
      this.cellMg = 0            // lettura della cella senza rumore
      this.readingMg = 0         // lettura con il rumore
      this.initialZeroMg = 0     // zero dell'accensione: il campo di azzeramento si misura da qui
      this.zeroMg = 0
      this.tareMg = 0
      this.refMg = 0             // riferimento per decidere se il peso è fermo
      this.steadySince = 0
      this.draft = false         // corrente d'aria
      this.panRemoved = false
      this.on = true
      this.hostUnit = 'g'        // unità di S, SI, SIR (M21 canale 0)
      this.displayUnit = 'g'     // unità del display e di SU, SIU, SIRU, ST (M21 canale 1)
      this.text = null           // testo scritto sul display con D
      this.transferKey = false   // ST 1: il tasto di trasferimento invia il peso
      this.stream = null         // SIR o SIRU attivo
      this.nextStreamAt = 0
      this.waiters = []          // operazioni in attesa del peso stabile
      this.blocked = false       // un comando aspetta il peso stabile: i successivi restano in coda
      this.inbox = ''
      this.queue = []
      this.message = null        // scritta breve sul display: { text, until }
    }

    // Cambio di profilo: è un'altra bilancia, con portata, leggibilità e comandi suoi
    setProfile (name) {
      const profile = PROFILES[name]
      if (!profile) throw new Error(`Profilo sconosciuto: ${name}`)
      this.profile = name
      this.model = profile.model
      this.capacityMg = profile.capacityG * 1000
      this.digitMg = profile.digitMg
      this.serial = profile.serial
      this.commands = profile.commands
      this.basic = profile.basic
      this.updateRate = profile.updateRate // valori al secondo del flusso (UPD)
      this.hostUnit = this.displayUnit = 'g'
      this.stream = null
      this.transferKey = false
    }

    // --- Azioni sulla bilancia (pannello del simulatore) ---

    addLoad (grams) {
      this.loadMg = Math.max(0, this.loadMg + Math.round(grams * 1000))
    }

    clearPan () {
      this.loadMg = 0
    }

    setDraft (on) {
      this.draft = on
    }

    setPanRemoved (on) {
      this.panRemoved = on
    }

    // Unità scelta dal menu della bilancia: all'accensione vale sia per il display sia per i comandi S
    setDisplayUnit (unit) {
      this.displayUnit = unit
      this.hostUnit = unit
    }

    pressZero () {
      if (this.on) this.#waitStable(false, () => { if (this.#zero()) this.#flash('Fuori campo') }, () => {})
    }

    pressTare () {
      if (this.on) this.#waitStable(false, () => { if (this.#tare()) this.#flash('Tara negativa') }, () => {})
    }

    // Tasto di trasferimento: invia il peso stabile solo se il PC ha attivato ST
    pressTransfer () {
      if (!this.on) return
      if (!this.transferKey) return this.#flash('ST non attivo')
      this.#waitStable(false, () => this.#emit(this.#measure(this.displayUnit)), () => this.#flash('Instabile'))
    }

    powerOff () {
      this.on = false
      this.stream = null
      this.waiters = []
      this.queue = []
      this.blocked = false
      this.text = null
    }

    // All'accensione la bilancia si azzera e manda da sola il numero di serie
    powerOn () {
      if (this.on) return
      this.on = true
      this.transferKey = false
      this.initialZeroMg = this.zeroMg = this.cellMg
      this.tareMg = 0
      this.#emit(this.#i4())
    }

    // Disturbo sulla linea: una riga di caratteri casuali, come con un baud sbagliato
    sendNoise () {
      let text = ''
      for (let i = 0; i < 12; i++) text += String.fromCharCode(0x80 + Math.floor(this.random() * 0x7f))
      this.onOutput(`${text}\r\n`)
    }

    // Ciò che si vede sul display della bilancia
    display () {
      if (!this.on) return { off: true }
      if (this.message && this.t < this.message.until) return { text: this.message.text }
      if (this.text !== null) return { text: `* ${this.text}` }
      const error = this.#state()
      if (error) return { text: error === '+' ? 'Sovraccarico' : 'Sottocarico' }
      return {
        text: this.basic ? tenthsBracketed(this.#netMg()).replace(/[()]/g, '') : formatValue(this.#netMg(), this.displayUnit),
        unit: this.displayUnit,
        stable: this.#stable(),
        net: this.tareMg !== 0
      }
    }

    // --- Tempo ---

    tick (ms) {
      this.t += ms
      this.cellMg = this.loadMg + (this.cellMg - this.loadMg) * Math.exp(-ms / SETTLE_TAU_MS)
      const noiseDigits = this.draft ? 6 : 0.3
      this.readingMg = this.cellMg + (this.random() * 2 - 1) * noiseDigits * this.digitMg
      const rounded = Math.round(this.readingMg / this.digitMg) * this.digitMg
      if (Math.abs(rounded - this.refMg) > this.digitMg) {
        this.refMg = rounded
        this.steadySince = this.t
      }
      if (!this.on) return
      this.#serveWaiters()
      if (this.stream && this.t >= this.nextStreamAt) {
        this.nextStreamAt = this.t + 1000 / this.updateRate
        this.#emit(this.#measure(this.stream === 'SIRU' ? this.displayUnit : this.hostUnit))
      }
      this.#runQueue()
    }

    // --- Comandi dal PC ---

    // Caratteri ricevuti sulla seriale. @ e C si eseguono subito, anche mentre un comando aspetta (manuale).
    write (text) {
      this.inbox += text
      const lines = this.inbox.split(/\r\n|\r|\n/)
      this.inbox = lines.pop()
      for (const line of lines.map(l => l.trim()).filter(Boolean)) {
        const name = line.split(/\s+/)[0]
        if (name === '@' || name === 'C') this.#execute(line)
        else this.queue.push(line)
      }
      this.#runQueue()
    }

    #runQueue () {
      while (this.queue.length && !this.blocked) this.#execute(this.queue.shift())
    }

    #execute (command) {
      const [name, ...args] = (command.match(/"(?:[^"\\]|\\.)*"|\S+/g) || []).map(unquote)
      if (!this.on) {
        // In standby risponde solo a ciò che la riaccende
        if (name === '@') this.powerOn()
        if (name === 'PWR' && args[0] === '1') {
          this.#emit('PWR A')
          this.powerOn()
        }
        return
      }
      // Nomi sconosciuti o in minuscolo: errore di sintassi, come la bilancia vera
      if (!Object.hasOwn(this.commands, name)) return this.#emit('ES')

      switch (name) {
        case '@':
          this.#cancel()
          this.transferKey = false
          return this.#emit(this.#i4())
        case 'C':
          this.#emit('C B')
          this.#cancel()
          return this.#emit('C A')
        case 'I0': {
          const names = Object.keys(this.commands).sort((a, b) => this.commands[a] - this.commands[b] || a.localeCompare(b))
          names.forEach((n, i) => this.#emit(`I0 ${i === names.length - 1 ? 'A' : 'B'} ${this.commands[n]} "${n}"`))
          return
        }
        case 'I1':
          return this.#emit('I1 A "012" "2.30" "2.22" "2.33" ""')
        case 'I2':
          return this.#emit(`I2 A "${this.model} ${thousandths(this.capacityMg)} g"`)
        case 'I3':
          return this.#emit('I3 A "1.00 10.00.0.000.000"')
        case 'I4':
          return this.#emit(this.#i4())
        case 'I10':
          if (args.length === 0) return this.#emit(`I10 A "${this.balanceId}"`)
          if (args[0].length > 20) return this.#emit('I10 L')
          this.balanceId = args[0]
          return this.#emit('I10 A')
        case 'I11':
          return this.#emit(`I11 A "${this.model}"`)
        case 'S':
        case 'SU': {
          this.stream = null
          const unit = name === 'SU' ? this.displayUnit : this.hostUnit
          const error = this.#state()
          if (error) return this.#emit(`S ${error}`)
          return this.#waitStable(true, () => this.#emit(this.#measure(unit)), () => this.#emit('S I'))
        }
        case 'SI':
        case 'SIU':
          this.stream = null
          return this.#emit(this.#measure(name === 'SIU' ? this.displayUnit : this.hostUnit))
        case 'SIR':
        case 'SIRU':
          this.stream = name
          this.nextStreamAt = this.t // il primo valore parte al prossimo tick
          return
        case 'Z': {
          const error = this.#state()
          if (error) return this.#emit(`Z ${error}`)
          return this.#waitStable(true, () => {
            const outOfRange = this.#zero()
            this.#emit(outOfRange ? `Z ${outOfRange}` : 'Z A')
          }, () => this.#emit('Z I'))
        }
        case 'ZI': {
          const stable = this.#stable()
          const outOfRange = this.#zero()
          return this.#emit(outOfRange ? `ZI ${outOfRange}` : `ZI ${stable ? 'S' : 'D'}`)
        }
        case 'T':
          return this.#waitStable(true, () => {
            const outOfRange = this.#tare()
            this.#emit(outOfRange ? `T ${outOfRange}` : weightLine('T', 'S', this.tareMg, this.hostUnit))
          }, () => this.#emit('T I'))
        case 'TI': {
          const stable = this.#stable()
          const outOfRange = this.#tare()
          return this.#emit(outOfRange ? `TI ${outOfRange}` : weightLine('TI', stable ? 'S' : 'D', this.tareMg, this.hostUnit))
        }
        case 'TA': {
          if (args.length >= 2) {
            const factor = { g: 1000, mg: 1, ct: 200 }[args[1]]
            const value = Number(args[0])
            if (!factor || !(value >= 0)) return this.#emit('TA L')
            this.tareMg = Math.round(value * factor)
          }
          return this.#emit(weightLine('TA', 'A', this.tareMg, this.hostUnit))
        }
        case 'TAC':
          this.tareMg = 0
          return this.#emit('TAC A')
        case 'D':
          this.text = args[0] ?? ''
          return this.#emit('D A')
        case 'DW':
          this.text = null
          return this.#emit('DW A')
        case 'K':
          return this.#emit(['1', '2', '3', '4'].includes(args[0]) ? 'K A' : 'K L')
        case 'ST':
          if (args.length === 0) return this.#emit(`ST A ${this.transferKey ? 1 : 0}`)
          if (args[0] !== '0' && args[0] !== '1') return this.#emit('ST L')
          this.transferKey = args[0] === '1'
          return this.#emit('ST A')
        case 'M21':
          return this.#m21(args)
        case 'UPD': {
          if (args.length === 0) return this.#emit(`UPD A ${this.updateRate}`)
          const rate = Number(args[0])
          if (!(rate >= 0.1 && rate <= 100)) return this.#emit('UPD L')
          this.updateRate = Math.min(rate, 20) // come la bilancia vera: si ferma a ciò che riesce a fare
          return this.#emit('UPD A')
        }
        case 'PWR':
          if (args[0] === '0') {
            this.#emit('PWR A')
            return this.powerOff()
          }
          return this.#emit(args[0] === '1' ? 'PWR A' : 'PWR L')
      }
    }

    // M21: unità dei canali 0 (comandi S), 1 (display) e 2 (info); il simulatore conosce g, mg e ct
    #m21 (args) {
      if (args.length === 0) {
        this.#emit(`M21 B 0 ${UNIT_CODES[this.hostUnit]}`)
        this.#emit(`M21 B 1 ${UNIT_CODES[this.displayUnit]}`)
        return this.#emit(`M21 A 2 ${UNIT_CODES[this.displayUnit]}`)
      }
      const [channel, code] = args
      if (!['0', '1', '2'].includes(channel)) return this.#emit('M21 L')
      if (code === undefined) return this.#emit(`M21 A ${channel} ${UNIT_CODES[channel === '0' ? this.hostUnit : this.displayUnit]}`)
      const unit = Object.keys(UNIT_CODES).find(u => String(UNIT_CODES[u]) === code)
      if (!unit) return this.#emit('M21 L')
      if (channel === '0') this.hostUnit = unit
      else this.displayUnit = unit
      return this.#emit('M21 A')
    }

    // @ e C: si fermano il flusso e i comandi in attesa
    #cancel () {
      this.stream = null
      this.waiters = this.waiters.filter(w => !w.fromHost)
      this.blocked = false
      this.queue = []
    }

    // --- Misura ---

    // Sottocarico se il piatto non c'è, sovraccarico oltre la portata (più 9 cifre, come le bilance vere)
    #state () {
      if (this.panRemoved) return '-'
      if (this.readingMg - this.zeroMg > this.capacityMg + 9 * this.digitMg) return '+'
      return null
    }

    #netMg () {
      return Math.round((this.readingMg - this.zeroMg - this.tareMg) / this.digitMg) * this.digitMg
    }

    #stable () {
      return !this.panRemoved && this.t - this.steadySince >= STABLE_AFTER_MS
    }

    // Riga della famiglia S nell'unità chiesta, o l'errore di sovraccarico e sottocarico
    #measure (unit) {
      const error = this.#state()
      if (error) return `S ${error}`
      const status = this.#stable() ? 'S' : 'D'
      return this.basic ? basicWeightLine(status, this.#netMg()) : weightLine('S', status, this.#netMg(), unit)
    }

    // Numero di serie: tra virgolette nel manuale, "SNR:" e allineato a destra sulla SB16001
    #i4 () {
      return this.basic ? `I4 A SNR:${this.serial.padStart(20)}` : `I4 A "${this.serial}"`
    }

    // Lo zero vale solo vicino allo zero dell'accensione: per un contenitore si usa la tara. Azzera la tara.
    #zero () {
      const offset = this.readingMg - this.initialZeroMg
      if (Math.abs(offset) > this.capacityMg * ZERO_RANGE) return offset > 0 ? '+' : '-'
      this.zeroMg = this.readingMg
      this.tareMg = 0
      return null
    }

    #tare () {
      const gross = Math.round(this.readingMg - this.zeroMg)
      if (gross < 0) return '-'
      if (gross > this.capacityMg) return '+'
      this.tareMg = gross
      return null
    }

    // Operazione che aspetta il peso stabile, con il tempo limite della bilancia
    #waitStable (fromHost, onStable, onTimeout) {
      this.waiters.push({ fromHost, deadline: this.t + WAIT_LIMIT_MS, onStable, onTimeout })
      if (fromHost) this.blocked = true
    }

    #serveWaiters () {
      const stable = this.#stable()
      for (const waiter of [...this.waiters]) {
        if (!stable && this.t < waiter.deadline) continue
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        if (waiter.fromHost) this.blocked = false
        if (stable) waiter.onStable()
        else waiter.onTimeout()
      }
    }

    #emit (line) {
      this.onOutput(`${line}\r\n`)
    }

    #flash (text) {
      this.message = { text, until: this.t + 1500 }
    }
  }

  return BilanciaSimulata
})
