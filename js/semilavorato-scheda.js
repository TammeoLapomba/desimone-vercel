// js/semilavorato-scheda.js — La scheda di un semilavorato, nella sezione Semilavorato (scheda 2.4). Le parti uguali stanno
// in scheda.js. Si modifica con la stessa finestra della pagina Semilavorato.
import { openScheda } from './scheda.js'
import { getRawItemCard, getRawCategories, getRawCodeRules, getCorals, getMyRole } from './supabase.js'
import { openRawItemModal } from './raw-form.js'

const UNITS = { grammi: 'Grammi', pezzi: 'Pezzi', pezzi_grammi: 'Pezzi e grammi' }
const comma = n => String(parseFloat(n)).replace('.', ',')

openScheda({
  kind: 'semilavorato',
  listHref: '/semilavorato.html',
  load: getRawItemCard,
  name: i => i.description || [i.raw_categories?.name, i.raw_shapes?.name, i.size].filter(Boolean).join(' '),
  group: i => ['Semilavorato', i.raw_categories?.name].filter(Boolean).join(' · '),
  photos: i => i.raw_photos,
  unit: i => i.unit,
  dataRows: i => [
    ['Tipo', i.raw_categories?.name],
    ['Forma', i.raw_shapes?.name],
    ['Alta', i.is_tall ? 'Sì' : ''],
    ['Qualità', i.quality],
    ['Finitura', i.finish],
    ['Misura', i.size],
    ['Lunghezza', i.length_cm ? `${comma(i.length_cm)} cm` : ''],
    ['Sigle', (i.variants || []).join(', ')],
    ['Corallo', i.coral?.name || 'Non indicato'],
    ['Unità di misura', UNITS[i.unit]],
    ['Note', i.notes],
  ],
  edit: async (item, stock, reload) => {
    const [categories, rules, corals, role] = await Promise.all([getRawCategories(), getRawCodeRules(), getCorals(), getMyRole()])
    openRawItemModal({ item: { ...item, ...stock }, categories, rules, corals, isAdmin: role === 'admin', onSuccess: reload })
  },
}).catch(err => {
  console.error(err)
  document.getElementById('blocked').textContent = `Non riesco ad aprire la scheda: ${err.message}`
  document.getElementById('blocked').hidden = false
})
