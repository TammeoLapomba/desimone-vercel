// js/cliente.js — La scheda di un cliente registrato (scheda 4.1: J3, J4, J5, RV-U-02…05, CL-07…CL-09)
//
// Dati, sedi con la sede legale, archiviazione e storico. Merce presso il cliente (4.2), bolle (4.3) e ordini (4.6)
// si aggiungeranno qui (RV-U-06). Le regole le decide il database (048): una e una sola sede legale, archiviare
// solo senza documenti aperti, eliminare solo se mai usato.
import {
  requireAuth, signOut, getMyOperator, getCustomer, updateCustomer, saveCustomerSite, setLegalSite,
  archiveCustomer, restoreCustomer, deleteCustomer, archiveCustomerSite, restoreCustomerSite, deleteCustomerSite,
  getCustomerChanges,
} from './supabase.js'
import { showToast } from './utils.js'
import { initMobileNav } from './pwa.js'
import { esc, customerFieldsHtml, siteFieldsHtml, readCustomer, readSite, fillCustomer, fillSite, customerProblem, siteProblem, siteAddress } from './clienti.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const CHANGES_LIMIT = 100
const $ = id => document.getElementById(id)
const when = d => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = d => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })

const state = { id: null, customer: null, editingSite: null }

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
  $('scheda').hidden = true
}

async function init() {
  await requireAuth()
  initMobileNav()
  const operator = await getMyOperator()
  if (operator?.role !== 'admin') return block('La scheda del cliente è per l\'amministrazione.')
  $('operatorChip').textContent = `${operator.name} · ${ROLE_LABELS[operator.role]}`
  state.id = new URLSearchParams(location.search).get('id')
  if (!state.id) return block('Cliente non trovato.')
  $('customerFields').innerHTML = customerFieldsHtml('c')
  $('siteFields').innerHTML = siteFieldsHtml('s')
  setupListeners()
  await load()
}

async function load() {
  try {
    state.customer = await getCustomer(state.id)
  } catch (err) {
    return block(`Cliente non disponibile: ${err.message}`)
  }
  if (!state.customer) return block('Cliente non trovato.')
  document.title = `De Simone OS — ${state.customer.name}`
  $('scheda').hidden = false
  renderIdentity()
  renderData()
  renderSites()
  renderChanges()
}

// ─── Cliente ──────────────────────────────────────────────────

function renderIdentity() {
  const c = state.customer
  const legal = c.customer_sites.find(s => s.is_legal)
  $('identity').innerHTML = `
    <div class="sch-group">Cliente</div>
    <h1 class="sch-name">${esc(c.name)}</h1>
    ${c.archived_at ? `<p class="sch-archived">Archiviato il ${day(c.archived_at)}</p>` : ''}
    <dl class="sch-data">
      <dt>Partita IVA</dt><dd><span class="gia-code">${esc(c.vat_number)}</span></dd>
      ${legal ? `<dt>Sede legale</dt><dd>${esc(siteAddress(legal))}</dd>` : ''}
    </dl>
    <div class="sch-actions">
      ${c.archived_at
        ? '<button type="button" class="btn-primary" data-customer="restore">Riattiva</button><button type="button" class="btn-danger" data-customer="delete">Elimina</button>'
        : '<button type="button" class="btn-ghost" data-customer="archive">Archivia</button>'}
    </div>
    <p class="field-hint">${c.archived_at
      ? 'Un cliente archiviato non si propone più nei documenti nuovi. Si elimina solo se non è mai stato usato.'
      : 'Si archivia solo senza merce presso di sé e senza documenti aperti.'}</p>`
}

function renderData() {
  const c = state.customer
  const rows = [['Ragione sociale', c.name], ['Partita IVA', c.vat_number], ['Codice fiscale', c.tax_code], ['Referente', c.contact_name],
    ['Telefono', c.phone], ['Email', c.email], ['Note', c.notes]]
  $('data').innerHTML = `<dl class="sch-data">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ? esc(v) : '—'}</dd>`).join('')}</dl>`
}

function openCustomerModal() {
  fillCustomer('c', state.customer)
  $('customerError').textContent = ''
  $('customerModal').classList.add('open')
  $('c_name').focus()
}

async function saveCustomer(e) {
  e.preventDefault()
  const customer = readCustomer('c')
  const problem = customerProblem(customer)
  if (problem) return void ($('customerError').textContent = problem)
  const button = $('customerSave')
  button.disabled = true
  $('customerError').textContent = ''
  try {
    await updateCustomer(state.id, customer)
    $('customerModal').classList.remove('open')
    showToast('Dati salvati')
    await load()
  } catch (err) {
    $('customerError').textContent = err.message || 'Dati non salvati'
  } finally {
    button.disabled = false
  }
}

async function customerAction(action, button) {
  const name = state.customer.name
  const steps = {
    archive: { run: archiveCustomer, done: `${name} archiviato`, ask: `Archiviare ${name}?\n\nNon si proporrà più nei documenti nuovi. Si può riattivare.` },
    restore: { run: restoreCustomer, done: `${name} riattivato` },
    delete: { run: deleteCustomer, done: `${name} eliminato`, ask: `Eliminare ${name} con le sue sedi?\n\nNon si può annullare. Resta solo lo storico.` },
  }[action]
  if (steps.ask && !confirm(steps.ask)) return
  button.disabled = true
  try {
    await steps.run(state.id)
    showToast(steps.done)
    if (action === 'delete') return void location.replace('/vendite.html')
    await load()
  } catch (err) {
    button.disabled = false
    showToast(err.message || 'Non riuscito')
  }
}

// ─── Sedi (J5, RV-U-04, U-05) ─────────────────────────────────

function siteRow(s) {
  const off = !!s.archived_at
  const actions = off
    ? `<button type="button" class="btn-ghost" data-site="restore" data-id="${s.id}">Riattiva</button>
       <button type="button" class="btn-danger" data-site="delete" data-id="${s.id}">Elimina</button>`
    : `<button type="button" class="btn-ghost" data-site="edit" data-id="${s.id}">Modifica</button>
       ${s.is_legal ? '' : `<button type="button" class="btn-ghost" data-site="legal" data-id="${s.id}">Rendi sede legale</button>
       <button type="button" class="btn-ghost" data-site="archive" data-id="${s.id}">Archivia</button>`}`
  return `<li class="gia-row${off ? ' gia-row-off' : ''}">
    <div>
      <div class="gia-row-title">${esc(s.name)}${s.is_legal ? '<span class="gia-tag">Sede legale</span>' : ''}${off ? '<span class="gia-tag">Archiviata</span>' : ''}</div>
      <div class="gia-row-sub">${esc(siteAddress(s))}${s.notes ? ` · ${esc(s.notes)}` : ''}</div>
    </div>
    <div class="gia-row-actions">${actions}</div>
  </li>`
}

function renderSites() {
  const sites = [...state.customer.customer_sites].sort((a, b) =>
    (b.is_legal - a.is_legal) || (!!a.archived_at - !!b.archived_at) || a.name.localeCompare(b.name, 'it', { numeric: true }))
  $('sites').innerHTML = sites.map(siteRow).join('')
}

function openSiteModal(site = null) {
  state.editingSite = site
  $('siteModalTitle').textContent = site ? `Modifica ${site.name}` : 'Nuova sede'
  fillSite('s', site || { country: 'Italia' })
  $('siteError').textContent = ''
  $('siteModal').classList.add('open')
  $('s_name').focus()
}

async function saveSite(e) {
  e.preventDefault()
  const site = readSite('s')
  const problem = siteProblem(site)
  if (problem) return void ($('siteError').textContent = problem)
  const button = $('siteSave')
  button.disabled = true
  $('siteError').textContent = ''
  try {
    await saveCustomerSite(state.id, state.editingSite?.id, site)
    $('siteModal').classList.remove('open')
    showToast(`Sede ${site.name} salvata`)
    await load()
  } catch (err) {
    $('siteError').textContent = err.message || 'Sede non salvata'
  } finally {
    button.disabled = false
  }
}

async function siteAction(action, id, button) {
  const site = state.customer.customer_sites.find(s => s.id === id)
  if (!site) return
  if (action === 'edit') return openSiteModal(site)
  const steps = {
    legal: { run: setLegalSite, done: `${site.name} è la sede legale`, ask: `Rendere ${site.name} la sede legale?\n\nI documenti già emessi non cambiano.` },
    archive: { run: archiveCustomerSite, done: `${site.name} archiviata`, ask: `Archiviare ${site.name}?\n\nNon si proporrà più nei documenti nuovi. Si può riattivare.` },
    restore: { run: restoreCustomerSite, done: `${site.name} riattivata` },
    delete: { run: deleteCustomerSite, done: `${site.name} eliminata`, ask: `Eliminare ${site.name}?\n\nNon si può annullare. Resta solo lo storico.` },
  }[action]
  if (steps.ask && !confirm(steps.ask)) return
  button.disabled = true
  try {
    await steps.run(id)
    showToast(steps.done)
    await load()
  } catch (err) {
    button.disabled = false
    showToast(err.message || 'Non riuscito')
  }
}

// ─── Storico (CL-09) ──────────────────────────────────────────

async function renderChanges() {
  const box = $('changes')
  try {
    const rows = await getCustomerChanges(state.id, CHANGES_LIMIT)
    box.innerHTML = rows.length ? `
      <div class="mov-table-scroll"><table class="mov-table">
        <thead><tr><th scope="col">Quando</th><th scope="col">Chi</th><th scope="col">Cosa</th><th scope="col">Prima</th><th scope="col">Dopo</th></tr></thead>
        <tbody>${rows.map(c => `
          <tr><td>${when(c.changed_at)}</td><td>${esc(c.author)}</td><td>${esc(c.field)}</td><td>${esc(c.old_value ?? '—')}</td><td>${esc(c.new_value ?? '—')}</td></tr>`).join('')}</tbody>
      </table></div>
      ${rows.length === CHANGES_LIMIT ? `<p class="mov-note">Le ${CHANGES_LIMIT} modifiche più recenti.</p>` : ''}`
      : '<p class="mov-empty">Nessuna modifica registrata.</p>'
  } catch (err) {
    box.innerHTML = `<p class="mov-empty">Non riesco a leggere lo storico: ${esc(err.message)}</p>`
  }
}

function setupListeners() {
  $('btnEditCustomer').addEventListener('click', openCustomerModal)
  $('btnNewSite').addEventListener('click', () => openSiteModal())
  $('customerForm').addEventListener('submit', saveCustomer)
  $('siteForm').addEventListener('submit', saveSite)
  $('identity').addEventListener('click', e => {
    const button = e.target.closest('[data-customer]')
    if (button) customerAction(button.dataset.customer, button)
  })
  $('sites').addEventListener('click', e => {
    const button = e.target.closest('[data-site]')
    if (button) siteAction(button.dataset.site, button.dataset.id, button)
  })
  document.addEventListener('click', e => {
    const close = e.target.closest('[data-close]')
    if (close) $(close.dataset.close).classList.remove('open')
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'))
  })
}

init().catch(err => {
  console.error(err)
  block(`Pagina non disponibile: ${err.message}`)
})
