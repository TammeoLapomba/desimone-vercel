// js/bilancia/bilancia.js — La bilancia vista dall'app: una sola interfaccia, tre sorgenti (WBA, CR7)
//
//   cavo      bilancia collegata via cavo a questo dispositivo: Web Serial nel browser del computer;
//             sul tablet lo stesso lavoro lo farà il plugin USB-seriale dell'APK (P-13)
//   simulata  bilancia finta per le prove, che imita la SB16001
//   sede      bilancia del PC server, letta dal servizio della sede (P-07): arriva con il PC di prova
//
// Quale sorgente usare lo decide REQ-I-11: se al dispositivo è collegata una bilancia si pesa con quella,
// altrimenti con quella della sede (sourceFor). Si accetta solo un peso stabile (REQ-I-04), in grammi
// (REQ-D-03), al decimo di grammo (REQ-U-05).
//
// Il protocollo è quello del banco prova: pesi.js, sics.js e simulatore.js in questa cartella sono copie
// identiche di bilancia/banco-prova/ (script classici, caricati dalla pagina prima di questo modulo).
// Se cambiano lì, vanno ricopiati qui: diff bilancia/banco-prova/sics.js js/bilancia/sics.js deve essere vuoto.

const { SicsClient } = window.SICS
const { formatGrams } = window.Pesi

// Impostazioni lette sulla SB16001 del cliente (bilancia/banco-prova/README.md, 06/10/2026)
const SB16001_SERIAL = { baudRate: 2400, dataBits: 7, parity: 'even', stopBits: 1, flowControl: 'none' }

export const SIMULATED_MODEL = 'Simulata'

// Porta già autorizzata in una visita precedente: si cerca subito, perché al clic requestPort va chiamata
// senza nessun await prima (il browser la concede solo come risposta diretta al gesto dell'utente)
let knownPort = null
navigator.serial?.getPorts().then(ports => { knownPort = ports[0] || null }).catch(() => {})

// La bilancia di questo dispositivo e la sorgente con cui leggerla (REQ-I-11)
export function sourceFor(device, scales) {
  const own = scales.find(s => s.active && s.device_id === device?.id)
  if (own) return { scale: own, source: own.model === SIMULATED_MODEL ? 'simulata' : 'cavo' }
  const site = scales.find(s => s.active && !s.device_id)
  return { scale: site || null, source: site ? 'sede' : null }
}

// Peso stabile in grammi al decimo, dal peso in milligrammi della riga MT-SICS
const toGrams = mg => Math.round(mg / 100) / 10

export function createScale({ source, onReading = () => {}, onStatus = () => {} }) {
  let client = null
  let transport = null

  function newClient(write) {
    return new SicsClient({
      write,
      onLine: line => {
        if (line.kind === 'weight' && line.mg !== null) {
          onReading({ text: formatGrams(line.mg), stable: line.stable, unit: line.unit })
        } else if (line.kind === 'error' || line.kind === 'garbage') {
          onStatus(line.message, 'error')
        }
      },
    })
  }

  // Bilancia simulata: si appoggia la merce con addLoad e il peso si assesta come su quella vera
  function connectSimulated() {
    const sim = new window.BilanciaSimulata({ onOutput: text => client?.feed(text), profile: 'sb16001' })
    const timer = setInterval(() => sim.tick(50), 50)
    client = newClient(text => { setTimeout(() => sim.write(text), 5) })
    transport = { sim, close: () => clearInterval(timer) }
  }

  // Bilancia via cavo con Web Serial: va chiamata subito dopo il clic, senza await prima (requestPort)
  async function connectSerial() {
    if (!('serial' in navigator)) {
      throw new Error('Questo browser non legge la porta seriale: usa Chrome o Edge sul computer')
    }
    const port = knownPort || await navigator.serial.requestPort()
    knownPort = port
    await port.open(SB16001_SERIAL)
    let reader = null
    let closing = false
    client = newClient(async text => {
      const writer = port.writable.getWriter()
      try { await writer.write(new TextEncoder().encode(text)) } finally { writer.releaseLock() }
    })
    const done = (async () => {
      // windows-1252 copre l'ASCII delle risposte e il segno µ delle unità
      const decoder = new TextDecoder('windows-1252')
      while (port.readable && !closing) {
        reader = port.readable.getReader()
        try {
          for (;;) {
            const { value, done: end } = await reader.read()
            if (end) break
            client.feed(decoder.decode(value, { stream: true }))
          }
        } catch (err) {
          if (!closing && err.name !== 'NetworkError') onStatus(`Errore sulla linea seriale: ${err.message}`, 'error')
        } finally {
          reader.releaseLock()
        }
      }
      if (!closing) {
        client.close('La bilancia si è scollegata: cavo o adattatore staccato?')
        onStatus('La bilancia si è scollegata: cavo o adattatore staccato?', 'error')
        client = null
      }
    })()
    transport = {
      async close() {
        closing = true
        await reader?.cancel().catch(() => {})
        await done
        await port.close().catch(() => {})
      },
    }
  }

  return {
    source,
    get connected() { return client !== null },

    async connect() {
      if (client) return
      if (source === 'sede') {
        throw new Error('La bilancia della sede si legge con il servizio del PC server, che arriva con il PC di prova: per ora scrivi il peso a mano')
      }
      if (source === 'simulata') connectSimulated()
      else await connectSerial()
      // Lettura continua: il peso si vede mentre la merce si assesta (D-3, concetto A′)
      await client.send('SIR').catch(() => {})
      onStatus(source === 'simulata' ? 'Bilancia simulata collegata' : 'Bilancia collegata', 'ok')
    },

    // REQ-I-03.1: il peso si prende quando l'operatore lo chiede, solo stabile e solo in grammi
    async readStable() {
      if (!client) await this.connect()
      const line = await client.leggiPesoStabile()
      if (line.unit !== 'g') {
        throw new Error(`La bilancia pesa in "${line.unit}": impostala in grammi`)
      }
      return { grams: toGrams(line.mg), text: formatGrams(line.mg) }
    },

    // Solo per la bilancia simulata: merce sul piatto
    simulated: () => transport?.sim || null,

    async close() {
      client?.close()
      client = null
      await transport?.close()
      transport = null
    },
  }
}
