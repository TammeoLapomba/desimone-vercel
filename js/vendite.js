// js/vendite.js — Vendite, per l'amministrazione: per ora i clienti registrati (scheda 4.1: J1, J2, RV-U-01)
//
// Bolle (4.3) e ordini (4.6) si aggiungeranno come schede accanto. I permessi li decide il database (048):
// questa pagina la apre solo l'amministrazione, e le tabelle rispondono solo a lei.
import { requireAuth, signOut, getMyOperator, getCustomers, createCustomer } from './supabase.js'
import { showToast } from './utils.js'
import { initMobileNav } from './pwa.js'
import { esc, customerFieldsHtml, siteFieldsHtml, readCustomer, readSite, fillCustomer, fillSite, customerProblem, siteProblem, legalSite } from './clienti.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const $ = id => document.getElementById(id)
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const state = { customers: [] }

async function init() {
  await requireAuth()
  initMobileNav()
  const operator = await getMyOperator()
  if (operator?.role !== 'admin') {
    $('blocked').textContent = 'Questa pagina è per l\'amministrazione.'
    $('blocked').hidden = false
    return
  }
  $('operatorChip').textContent = `${operator.name} · ${ROLE_LABELS[operator.role]}`
  $('page').hidden = false
  $('customerFields').innerHTML = customerFieldsHtml('c')
  $('siteFields').innerHTML = siteFieldsHtml('s')
  setupListeners()
  await loadCustomers()
}

async function loadCustomers() {
  try {
    state.customers = await getCustomers()
    render()
  } catch (err) {
    $('customerList').innerHTML = `<li class="mov-empty">Clienti non disponibili: ${esc(err.message)}</li>`
  }
}

// Una casella sola: ragione sociale, città delle sedi e partita IVA, con le parole in qualunque ordine
function matches(c, words) {
  const text = fold([c.name, c.vat_number, ...(c.customer_sites || []).map(s => s.city)].join(' '))
  return words.every(w => text.includes(w))
}

function row(c) {
  const legal = legalSite(c)
  const off = !!c.archived_at
  return `<li class="gia-row${off ? ' gia-row-off' : ''}">
    <div>
      <div class="gia-row-title"><a class="cli-link" href="/cliente.html?id=${encodeURIComponent(c.id)}">${esc(c.name)}</a>${off ? '<span class="gia-tag">Archiviato</span>' : ''}</div>
      <div class="gia-row-sub">${esc(legal?.city || '—')} · P. IVA <span class="gia-code">${esc(c.vat_number)}</span></div>
    </div>
  </li>`
}

function render() {
  const words = fold($('searchInput').value).split(/\s+/).filter(Boolean)
  const showArchived = $('showArchived').checked
  const found = state.customers.filter(c => matches(c, words))
  const active = found.filter(c => !c.archived_at)
  const archived = showArchived ? found.filter(c => c.archived_at) : []
  const total = state.customers.filter(c => !c.archived_at).length
  $('customerCount').textContent = !state.customers.length ? ''
    : words.length ? `${active.length} di ${total} clienti attivi` : `${total} ${total === 1 ? 'cliente attivo' : 'clienti attivi'}`
  $('customerList').innerHTML = active.map(row).join('')
    + (archived.length ? `<li class="gia-section">Archiviati</li>${archived.map(row).join('')}` : '')
    || `<li class="mov-empty">${state.customers.length ? 'Nessun cliente trovato' : 'Ancora nessun cliente: aggiungi il primo con "Nuovo cliente"'}</li>`
}

function openCustomerModal() {
  fillCustomer('c', null)
  fillSite('s', { name: 'Sede legale', country: 'Italia' })
  $('customerError').textContent = ''
  $('customerModal').classList.add('open')
  $('c_name').focus()
}

async function saveCustomer(e) {
  e.preventDefault()
  const customer = readCustomer('c')
  const site = readSite('s')
  const problem = customerProblem(customer) || siteProblem(site)
  if (problem) return void ($('customerError').textContent = problem)
  const button = $('customerSave')
  button.disabled = true
  $('customerError').textContent = ''
  try {
    const id = await createCustomer(customer, site)
    $('customerModal').classList.remove('open')
    showToast(`Cliente ${customer.name} creato`)
    location.href = `/cliente.html?id=${encodeURIComponent(id)}`
  } catch (err) {
    $('customerError').textContent = err.message || 'Cliente non creato'
    button.disabled = false
  }
}

function setupListeners() {
  $('btnNewCustomer').addEventListener('click', openCustomerModal)
  $('customerForm').addEventListener('submit', saveCustomer)
  $('searchInput').addEventListener('input', render)
  $('showArchived').addEventListener('change', render)
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
  $('blocked').textContent = `Pagina non disponibile: ${err.message}`
  $('blocked').hidden = false
})
