// js/catalog-scheda.js — La scheda di un gioiello, nella sezione Montato (scheda 2.4). Le parti uguali stanno in scheda.js.
import { openScheda } from './scheda.js'
import { getArticleCard } from './supabase.js'
import { articleMaterialLines, articleMetalLine, formatDecimal, formatEuro } from './utils.js'

const size = (value, unit) => value == null || value === '' ? '' : `${formatDecimal(value)} ${unit}`

openScheda({
  kind: 'montato',
  listHref: '/catalog.html',
  load: getArticleCard,
  name: a => a.name,
  group: a => ['Montato', a.collections?.name].filter(Boolean).join(' · '),
  photos: a => a.photos,
  unit: () => 'montato',
  dataRows: a => {
    const m = a.measurements || {}
    return [
      ['Collezione', a.collections?.name],
      ['Tipo', a.product_type?.name],
      ['Materiali', articleMaterialLines(a).join('\n')],
      ['Metallo', articleMetalLine(a)],
      ['Peso di un pezzo', size(m.weight_g, 'g')],
      ['Prezzo retail', a.price_retail ? formatEuro(a.price_retail) : ''],
      ['Prezzo ingrosso', a.price_wholesale ? formatEuro(a.price_wholesale) : ''],
      ['Larghezza', size(m.width_cm, 'cm')],
      ['Lunghezza', size(m.length_cm, 'cm')],
      ['Altezza', size(m.height_cm, 'cm')],
      ['Note', a.notes],
    ]
  },
  // Il valore delle giacenze, sui due prezzi, come in Giacenze (la base è ancora da decidere: UC-14)
  values: (a, total) => [
    ['Valore al pubblico', formatEuro((Number(a.price_retail) || 0) * total.pieces)],
    ['Valore all\'ingrosso', formatEuro((Number(a.price_wholesale) || 0) * total.pieces)],
  ],
  edit: a => { location.href = `/article.html?id=${encodeURIComponent(a.id)}&torna=scheda` },
}).catch(err => {
  console.error(err)
  document.getElementById('blocked').textContent = `Non riesco ad aprire la scheda: ${err.message}`
  document.getElementById('blocked').hidden = false
})
