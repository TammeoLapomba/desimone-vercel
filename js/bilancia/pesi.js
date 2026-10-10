// bilancia/banco-prova/pesi.js — Pesi in milligrammi interi: unità della bilancia, formato, peso scritto a mano
//
// Il gestionale registra i pesi al decimo di grammo (REQ-U-05, corretto il 01/10/2026 per la SB16001). Qui un
// peso è un numero intero di mg, così i decimali non accumulano errori di arrotondamento e una bilancia più fine
// non perde niente prima della registrazione.
//
// Script classico e non modulo ES, di proposito: la pagina si apre anche con un doppio clic (file://), dove
// i moduli non si caricano, e lo stesso file si prova in Node (test/banco.test.js).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.Pesi = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // Milligrammi per unità: solo le unità del comando M21 con una definizione esatta.
  // In gioielleria contano soprattutto g, ct, ozt, dwt e GN.
  const MG_PER_UNIT = {
    g: 1000,
    mg: 1,
    kg: 1000000,
    'µg': 0.001,       // U+00B5, segno micro
    'μg': 0.001,       // U+03BC, mu greca
    ug: 0.001,
    ct: 200,           // carato metrico
    ozt: 31103.4768,   // oncia troy
    oz: 28349.523125,  // oncia avoirdupois
    dwt: 1555.17384,   // pennyweight
    GN: 64.79891,      // grano
    lb: 453592.37,
    mom: 3750,         // momme
    tola: 11663.8038
  }

  // "14.256" → { digits: 14256, scale: 3 }; null se non è un numero con il punto decimale
  function parseDecimal (text) {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(text).trim())
    if (!m || (m[2] === '' && !m[3])) return null
    const frac = m[3] || ''
    const digits = Number((m[2] || '0') + frac)
    return { digits: m[1] === '-' ? -digits : digits, scale: frac.length }
  }

  const roundHalfAway = x => Math.sign(x) * Math.round(Math.abs(x))

  // Peso di una risposta MT-SICS ("14.256" in "g") → mg interi; null se l'unità non è convertibile
  function toMilligrams (valueText, unit) {
    const factor = MG_PER_UNIT[unit]
    const dec = parseDecimal(valueText)
    if (factor === undefined || !dec) return null
    return roundHalfAway(dec.digits * factor / 10 ** dec.scale) || 0 // || 0: niente -0
  }

  // 14256 → "14,3 g": al decimo di grammo (REQ-U-05), con la virgola (REQ-U-08) e nessun separatore delle
  // migliaia, perché "1.250" non deve mai sembrare 1250 g
  function formatGrams (mg, { unit = true } = {}) {
    const tenths = roundHalfAway(mg / 100)
    const abs = Math.abs(tenths)
    const text = `${tenths < 0 ? '-' : ''}${Math.floor(abs / 10)},${abs % 10}`
    return unit ? `${text} g` : text
  }

  const invalid = (error, req = null) => ({ ok: false, error, req })

  // S-07 · L-01 Interfaccia operatore::validaPeso(testo): il peso scritto a mano quando la bilancia non c'è
  // (REQ-I-05). Virgola e punto valgono entrambi come separatore decimale (REQ-U-06); al massimo un decimale
  // (REQ-U-09), così "1.250" si rifiuta invece di diventare 1,25 g o 1250 g.
  // Restituisce { ok: true, mg } oppure { ok: false, error, req }.
  function validaPeso (testo) {
    const text = String(testo ?? '').trim()
    if (text === '') return invalid('Scrivi il peso in grammi.')
    if (text.startsWith('-')) return invalid('Il peso non può essere negativo.')
    if (/[^\d.,]/.test(text)) return invalid('Usa solo cifre e un separatore decimale (virgola o punto).')
    const separators = text.match(/[.,]/g) || []
    if (separators.length > 1) {
      return invalid('Un solo separatore decimale: "1.234,5" non vale, scrivi "1234,5".', 'REQ-U-07')
    }
    const [whole, frac = ''] = text.split(/[.,]/)
    if (separators.length === 1 && frac === '') return invalid('Manca la parte decimale dopo il separatore.')
    if (frac.length > 1) return invalid('Al massimo un decimale: la risoluzione è 0,1 g.', 'REQ-U-09')
    const mg = Number(whole || '0') * 1000 + Number(frac || '0') * 100
    if (mg === 0) return invalid('Il peso deve essere maggiore di zero.')
    return { ok: true, mg }
  }

  return { MG_PER_UNIT, parseDecimal, toMilligrams, formatGrams, validaPeso }
})
