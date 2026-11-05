// js/impostazioni.js — Impostazioni, per l'amministrazione (scheda 1.5)
//
// Dati dell'azienda, aliquote IVA e numeri dei documenti (B6, B7, IM-01…IM-16), che useranno bolle, DDT e ordini.
// Qui anche ciò che stava in Giacenze: utenti (REQ-P-08, P-09), luoghi (UC-11, REQ-M-07), dispositivi (UC-13,
// REQ-S-01…S-03) e copia di sicurezza, solo nella sede (7.2, REQ-I-02). I permessi li decide il database.
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getLocationHolding, insertLocation, revokeDevice,
  IN_SEDE, getBackupStatus, startBackup,
  getAccounts, saveAccount, setAccountActive, createAccount, resetAccountPassword,
  getCompanySettings, saveCompanySettings, getVatRates, saveVatRate, setDefaultVatRate, archiveVatRate, restoreVatRate,
  deleteVatRate, getDocumentCounters, raiseDocumentCounter,
} from './supabase.js'
import { showToast } from './utils.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const SERIES_LABELS = { bolla: 'Bolle', ritorno: 'Ritorni', ordine: 'Ordini' }
const SERIES_NEXT = { bolla: 'La prossima bolla', ritorno: 'Il prossimo ritorno', ordine: 'Il prossimo ordine' }
const DEVICE_KEY = 'desimone-os:dispositivo'
const TABS = {
  azienda: 'tab-company', iva: 'tab-vat', numerazione: 'tab-counters', utenti: 'tab-users',
  luoghi: 'tab-locations', dispositivi: 'tab-devices', copia: 'tab-backup',
}

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const articles = n => `${num(n)} ${n === 1 ? 'articolo' : 'articoli'}`
const percent = rate => `${Number(rate).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`

const state = {
  operator: null,
  company: null,
  vatRates: [],
  editingVat: null,
  counters: null,  // { year, series: [{ series, next_number }] }
  editingSeries: null,
  locations: [],
  holding: new Map(),  // location_id → articoli con giacenza
  devices: [],
  backup: null,    // stato della copia di sicurezza (sede/servizio/copia.js), solo nella sede
  users: [],       // accounts_list
  editingUser: null,
  userMode: null,  // create, edit, reset
}

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()

  state.operator = await getMyOperator()
  if (state.operator?.role !== 'admin') {
    return block('Questa pagina è per l\'amministrazione.')
  }
  $('operatorChip').textContent = `${state.operator.name} · ${ROLE_LABELS[state.operator.role]}`
  $('page').hidden = false
  if (IN_SEDE) $('tab-backup').hidden = false
  setupListeners()
  const wanted = TABS[location.hash.slice(1)]
  selectTab(wanted && !$(wanted).hidden ? wanted : TABS.azienda)

  // Ogni scheda carica per conto suo: se una non risponde, le altre si usano lo stesso
  loadCompany()
  loadVatRates()
  loadCounters()
  loadUsers()
  loadLocations()
  if (IN_SEDE) loadBackup()
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

// ─── Schede ───────────────────────────────────────────────────

function selectTab(id) {
  for (const tab of document.querySelectorAll('.gia-tab')) {
    const on = tab.id === id
    tab.setAttribute('aria-selected', on)
    $(tab.getAttribute('aria-controls')).hidden = !on
  }
  const key = Object.keys(TABS).find(k => TABS[k] === id)
  if (key) history.replaceState(null, '', `#${key}`)
}

// ─── Dati dell'azienda (B7, IM-01, IM-02) ─────────────────────

const COMPANY_FIELDS = {
  legal_name: 'f_legal_name', address: 'f_address', postal_code: 'f_postal_code', city: 'f_city', province: 'f_province',
  vat_number: 'f_vat_number', tax_code: 'f_tax_code', rea_number: 'f_rea_number',
  phone: 'f_phone', email: 'f_email', pec: 'f_pec', website: 'f_website',
}

function fillCompany() {
  for (const [column, input] of Object.entries(COMPANY_FIELDS)) $(input).value = state.company[column] || ''
  $('companyEmpty').hidden = !!state.company.legal_name
}

async function loadCompany() {
  try {
    state.company = await getCompanySettings()
    fillCompany()
    $('btnCompany').disabled = false
  } catch (err) {
    $('companyError').textContent = `Dati non disponibili: ${err.message}`
  }
}

async function saveCompany(e) {
  e.preventDefault()
  if (!state.company) return
  const fields = {}
  for (const [column, input] of Object.entries(COMPANY_FIELDS)) fields[column] = $(input).value
  const button = $('btnCompany')
  button.disabled = true
  $('companyError').textContent = ''
  try {
    state.company = await saveCompanySettings(state.company.id, fields)
    fillCompany()
    showToast('Dati dell\'azienda salvati')
  } catch (err) {
    $('companyError').textContent = err.message || 'Dati non salvati'
  } finally {
    button.disabled = false
  }
}

// ─── Aliquote IVA (B6, IM-03…IM-06) ───────────────────────────

async function loadVatRates() {
  try {
    state.vatRates = await getVatRates()
    renderVatRates()
  } catch (err) {
    $('vatList').innerHTML = `<li class="mov-empty">Aliquote non disponibili: ${esc(err.message)}</li>`
  }
}

function vatRow(r) {
  const actions = r.active ? `
      <button type="button" class="btn-ghost" data-vat-edit="${r.id}">Modifica</button>
      ${r.is_default ? '' : `<button type="button" class="btn-ghost" data-vat-default="${r.id}">Rendi predefinita</button>
      <button type="button" class="btn-danger" data-vat-archive="${r.id}">Archivia</button>`}` : `
      <button type="button" class="btn-ghost" data-vat-restore="${r.id}">Riattiva</button>
      <button type="button" class="btn-danger" data-vat-delete="${r.id}">Elimina</button>`
  return `
    <li class="gia-row${r.active ? '' : ' gia-row-off'}">
      <div>
        <div class="gia-row-title">${esc(r.name)}${r.is_default ? '<span class="gia-tag">Predefinita</span>' : ''}</div>
        <div class="gia-row-sub">${percent(r.rate)}</div>
      </div>
      <div class="gia-row-actions">${actions}</div>
    </li>`
}

function renderVatRates() {
  const active = state.vatRates.filter(r => r.active)
  const archived = state.vatRates.filter(r => !r.active)
  $('vatList').innerHTML = active.map(vatRow).join('')
    + (archived.length ? `<li class="gia-section">Archiviate</li>${archived.map(vatRow).join('')}` : '')
    || '<li class="mov-empty">Nessuna aliquota</li>'
}

function openVatModal(rate = null) {
  state.editingVat = rate
  $('vatModalTitle').textContent = rate ? `Modifica ${rate.name}` : 'Nuova aliquota'
  $('f_vat_name').value = rate?.name || ''
  $('f_vat_rate').value = rate ? String(Number(rate.rate)).replace('.', ',') : ''
  $('vatError').textContent = ''
  $('vatModal').classList.add('open')
  $('f_vat_name').focus()
}

const closeVatModal = () => $('vatModal').classList.remove('open')

async function saveVat(e) {
  e.preventDefault()
  const name = $('f_vat_name').value.trim()
  const text = $('f_vat_rate').value.trim().replace(',', '.')
  const rate = Number(text)
  if (!name) return void ($('vatError').textContent = 'Scrivi il nome dell\'aliquota')
  if (!text || Number.isNaN(rate)) return void ($('vatError').textContent = 'Scrivi la percentuale, da 0 a 100')
  const button = $('btnSaveVat')
  button.disabled = true
  $('vatError').textContent = ''
  try {
    await saveVatRate(state.editingVat?.id, name, rate)
    closeVatModal()
    await loadVatRates()
    showToast(`Aliquota ${name} salvata`)
  } catch (err) {
    $('vatError').textContent = err.message || 'Aliquota non salvata'
  } finally {
    button.disabled = false
  }
}

async function vatAction(action, id, button) {
  const rate = state.vatRates.find(r => r.id === id)
  if (!rate) return
  const steps = {
    default: { run: setDefaultVatRate, done: `${rate.name} è la nuova predefinita` },
    archive: { run: archiveVatRate, done: `${rate.name} archiviata`, ask: `Archiviare ${rate.name}?\n\nNon si proporrà più sui documenti nuovi. Si può riattivare.` },
    restore: { run: restoreVatRate, done: `${rate.name} riattivata` },
    delete: { run: deleteVatRate, done: `${rate.name} eliminata`, ask: `Eliminare ${rate.name}?\n\nNon si può annullare. Resta solo una riga nello storico.` },
  }[action]
  if (steps.ask && !confirm(steps.ask)) return
  button.disabled = true
  try {
    await steps.run(id)
    await loadVatRates()
    showToast(steps.done)
  } catch (err) {
    button.disabled = false
    showToast(err.message || 'Non riuscito')
  }
}

// ─── Numeri dei documenti (B7, IM-11) ─────────────────────────

async function loadCounters() {
  try {
    state.counters = await getDocumentCounters()
    renderCounters()
  } catch (err) {
    $('counterList').innerHTML = `<li class="mov-empty">Numeri non disponibili: ${esc(err.message)}</li>`
  }
}

function renderCounters() {
  const { year, series } = state.counters
  $('counterList').innerHTML = series.map(s => `
    <li class="gia-row">
      <div>
        <div class="gia-row-title">${SERIES_LABELS[s.series]}</div>
        <div class="gia-row-sub">Prossimo numero del ${year}: <span class="gia-code">${num(s.next_number)}</span></div>
      </div>
      <div class="gia-row-actions"><button type="button" class="btn-ghost" data-counter="${s.series}">Alza</button></div>
    </li>`).join('')
}

function openCounterModal(series) {
  state.editingSeries = state.counters.series.find(s => s.series === series)
  $('counterModalTitle').textContent = `${SERIES_LABELS[series]}: alza il prossimo numero`
  $('f_counter').value = ''
  $('f_counter').min = state.editingSeries.next_number + 1
  $('counterHint').textContent = `Adesso il prossimo numero è ${num(state.editingSeries.next_number)}. Si può solo salire: per tornare indietro serve Dedalo.`
  $('counterError').textContent = ''
  $('counterModal').classList.add('open')
  $('f_counter').focus()
}

const closeCounterModal = () => $('counterModal').classList.remove('open')

async function saveCounter(e) {
  e.preventDefault()
  const { series, next_number: current } = state.editingSeries
  const next = Number($('f_counter').value)
  if (!Number.isInteger(next) || next <= current) {
    return void ($('counterError').textContent = `Scrivi un numero più alto di ${num(current)}`)
  }
  if (!confirm(`${SERIES_NEXT[series]} avrà il numero ${num(next)}.\n\nDall'app non si potrà più abbassare. Confermi?`)) return
  const button = $('btnSaveCounter')
  button.disabled = true
  $('counterError').textContent = ''
  try {
    await raiseDocumentCounter(series, next)
    closeCounterModal()
    await loadCounters()
    showToast(`${SERIES_LABELS[series]}: prossimo numero ${num(next)}`)
  } catch (err) {
    $('counterError').textContent = err.message || 'Numero non cambiato'
    await loadCounters()
  } finally {
    button.disabled = false
  }
}

// ─── Caricamento di luoghi e dispositivi ──────────────────────

async function loadLocations() {
  try {
    const [setup, holding] = await Promise.all([getMovementSetup(), getLocationHolding()])
    state.locations = setup.locations
    state.devices = setup.devices
    state.holding = holding
    renderLocations()
    renderDevices()
  } catch (err) {
    $('locationList').innerHTML = `<li class="mov-empty">Luoghi non disponibili: ${esc(err.message)}</li>`
    $('deviceList').innerHTML = `<li class="mov-empty">Dispositivi non disponibili: ${esc(err.message)}</li>`
  }
}

// ─── Luoghi (UC-11, REQ-M-07) ─────────────────────────────────

function renderLocations() {
  $('locationList').innerHTML = state.locations.map(l => {
    const holding = state.holding.get(l.id) || 0
    return `
      <li class="gia-row">
        <div>
          <div class="gia-row-title">${esc(l.name)}</div>
          <div class="gia-row-sub">${l.kind === 'fiera' ? 'Fiera' : 'Sede'}${l.active ? '' : ' · disattivato'}</div>
        </div>
        <div class="gia-row-meta">${holding ? `${articles(holding)} con giacenza` : 'Vuoto'}</div>
      </li>`
  }).join('') || '<li class="mov-empty">Nessun luogo</li>'
}

async function createLocation(e) {
  e.preventDefault()
  const name = $('locationName').value.trim().replace(/\s+/g, ' ')
  if (!name) return showToast('Scrivi il nome del luogo')
  if (state.locations.some(l => l.name.toLowerCase() === name.toLowerCase())) return showToast(`Esiste già un luogo "${name}"`)
  const btn = $('btnLocation')
  btn.disabled = true
  try {
    const location = await insertLocation(name)
    state.locations = [...state.locations, location].sort((a, b) => a.name.localeCompare(b.name, 'it'))
    $('locationName').value = ''
    renderLocations()
    showToast(`Luogo "${location.name}" creato`)
  } catch (err) {
    showToast(err.message || 'Luogo non creato')
  } finally {
    btn.disabled = false
  }
}

// ─── Dispositivi (UC-13, REQ-S-01…S-03) ───────────────────────

function renderDevices() {
  const mine = (() => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY))?.id } catch { return null } })()
  const date = d => new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
  $('deviceList').innerHTML = state.devices.map(d => `
    <li class="gia-row">
      <div>
        <div class="gia-row-title"><span class="gia-code">${esc(d.code)}</span> ${esc(d.name)}${d.id === mine ? ' <span class="gia-off">(questo dispositivo)</span>' : ''}</div>
        <div class="gia-row-sub">${d.revoked_at ? `Revocato il ${date(d.revoked_at)}` : 'Attivo'} · ${d.kind === 'mobile' ? 'Tablet o telefono, con la fotocamera' : 'PC, con la pistola'}</div>
      </div>
      ${d.revoked_at ? '' : `<button type="button" class="btn-danger" data-revoke="${d.id}">Revoca</button>`}
    </li>`).join('') || '<li class="mov-empty">Nessun dispositivo registrato</li>'
}

async function revoke(id, btn) {
  const d = state.devices.find(x => x.id === id)
  if (!d) return
  if (!confirm(`Revocare ${d.code} (${d.name})?\n\nDa ora non potrà più registrare movimenti. La revoca non si annulla dall'app.`)) return
  btn.disabled = true
  try {
    const updated = await revokeDevice(id)
    state.devices = state.devices.map(x => x.id === id ? { ...x, ...updated } : x)
    renderDevices()
    showToast(`${d.code} revocato`)
  } catch (err) {
    btn.disabled = false
    showToast(err.message || 'Revoca non riuscita')
  }
}

// ─── Utenti (REQ-P-08, P-09, scheda 1.4) ──────────────────────

async function loadUsers() {
  try {
    state.users = await getAccounts()
    renderUsers()
  } catch (err) {
    $('userList').innerHTML = `<li class="mov-empty">Elenco non disponibile: ${esc(err.message)}</li>`
  }
}

// Alfabetici, con i disattivati in fondo e poi gli account di Dedalo
function userGroups() {
  const byName = (a, b) => a.name.localeCompare(b.name, 'it')
  const company = state.users.filter(u => !u.is_dev).sort(byName)
  return {
    active: company.filter(u => u.active !== false),
    off: company.filter(u => u.active === false),
    dev: state.users.filter(u => u.is_dev).sort(byName),
  }
}

function userRow(u) {
  const when = d => new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const me = u.id === state.operator.id
  // Un dev può avere un vecchio operatore disattivato: ferma i movimenti, non l'account
  const off = u.active === false && !u.is_dev
  const tags = [
    me ? 'Sei tu' : '',
    off ? 'Disattivato' : '',
    u.provisional_password ? 'Password provvisoria' : '',
  ].filter(Boolean).map(t => `<span class="gia-tag">${t}</span>`).join('')
  const role = u.is_dev ? 'Dedalo' : ROLE_LABELS[u.role] || 'Senza ruolo'
  const actions = u.is_dev ? '' : `
    <div class="gia-row-actions">
      <button type="button" class="btn-ghost" data-user-edit="${u.id}">${u.role ? 'Modifica' : 'Assegna un ruolo'}</button>
      ${IN_SEDE && !me ? `<button type="button" class="btn-ghost" data-user-reset="${u.id}">Reimposta password</button>` : ''}
      ${me || !u.role ? '' : u.active
        ? `<button type="button" class="btn-danger" data-user-active="${u.id}" data-to="false">Disattiva</button>`
        : `<button type="button" class="btn-ghost" data-user-active="${u.id}" data-to="true">Riattiva</button>`}
    </div>`
  return `
    <li class="gia-row${off ? ' gia-row-off' : ''}">
      <div>
        <div class="gia-row-title">${esc(u.name)}${tags}</div>
        <div class="gia-row-sub"><span class="gia-code">${esc(u.username)}</span> · ${role} · ${u.last_sign_in_at ? `ultimo accesso ${when(u.last_sign_in_at)}` : 'nessun accesso'}</div>
      </div>
      ${actions}
    </li>`
}

function renderUsers() {
  const { active, off, dev } = userGroups()
  const section = (title, list) => list.length ? `<li class="gia-section">${title}</li>${list.map(userRow).join('')}` : ''
  $('userList').className = 'gia-list gia-users'
  $('userList').innerHTML = active.map(userRow).join('')
    + section('Disattivati', off)
    + section('Account di Dedalo, solo da leggere', dev)
    || '<li class="mov-empty">Nessun account</li>'
}

function openUserModal(mode, user = null) {
  state.userMode = mode
  state.editingUser = user
  const me = user?.id === state.operator.id
  $('userModalTitle').textContent = mode === 'create' ? 'Nuovo utente'
    : mode === 'reset' ? `Reimposta la password di ${user.name}` : user.role ? `Modifica ${user.name}` : `Assegna un ruolo a ${user.name}`
  $('fieldUserName').hidden = mode === 'reset'
  $('fieldUserUsername').hidden = mode !== 'create'
  $('fieldUserRole').hidden = mode === 'reset'
  $('fieldUserPassword').hidden = mode === 'edit'
  $('f_user_name').value = user?.name || ''
  $('f_user_username').value = ''
  $('f_user_role').value = user?.role || ''
  $('f_user_role').disabled = me
  $('userRoleHint').textContent = me ? 'Il tuo ruolo lo cambia un altro amministratore.' : 'Vale subito. Chi ha già una pagina aperta la vede aggiornata al prossimo caricamento.'
  $('f_user_password').value = ''
  $('userError').textContent = ''
  $('userModal').classList.add('open')
  $(mode === 'reset' ? 'f_user_password' : 'f_user_name').focus()
}

const closeUserModal = () => $('userModal').classList.remove('open')

async function saveUser(e) {
  e.preventDefault()
  const mode = state.userMode
  const user = state.editingUser
  const name = $('f_user_name').value.trim()
  const username = $('f_user_username').value.trim()
  const role = $('f_user_role').value
  const password = $('f_user_password').value
  const fail = message => { $('userError').textContent = message }
  if (mode !== 'reset' && !name) return fail('Scrivi il nome')
  if (mode === 'create' && !username) return fail('Scrivi il nome utente')
  if (mode !== 'reset' && !role) return fail('Scegli il ruolo')
  if (mode !== 'edit' && password.length < 8) return fail('La password provvisoria deve avere almeno 8 caratteri')
  const button = $('btnSaveUser')
  button.disabled = true
  fail('')
  try {
    if (mode === 'create') await createAccount({ name, username, role, password })
    else if (mode === 'reset') await resetAccountPassword(user.id, password)
    else await saveAccount(user.id, name, role)
    closeUserModal()
    await loadUsers()
    showToast(mode === 'create' ? `Account di ${name} creato` : mode === 'reset' ? `Password di ${user.name} reimpostata` : `Dati di ${name} aggiornati`)
  } catch (err) {
    fail(err.message || 'Non salvato')
  } finally {
    button.disabled = false
  }
}

async function toggleUser(id, active, button) {
  const user = state.users.find(u => u.id === id)
  if (!user) return
  const question = active
    ? `Riattivare ${user.name}?\n\nPotrà entrare di nuovo con la sua password.`
    : `Disattivare ${user.name}?\n\nDa ora non potrà più entrare, e si fermano anche le sessioni già aperte. I suoi movimenti restano con il suo nome.`
  if (!confirm(question)) return
  button.disabled = true
  try {
    await setAccountActive(id, active)
    await loadUsers()
    showToast(`Account di ${user.name} ${active ? 'riattivato' : 'disattivato'}`)
  } catch (err) {
    button.disabled = false
    showToast(err.message || 'Non riuscito')
  }
}

// ─── Copia di sicurezza (7.2, REQ-I-02) ───────────────────────

async function loadBackup() {
  try {
    state.backup = await getBackupStatus()
  } catch (err) {
    state.backup = { avvisi: [`Stato della copia non disponibile: ${err.message}`] }
  }
  renderBackup()
  // Mentre una copia è in corso si riguarda ogni pochi secondi
  if (state.backup?.inCorso) setTimeout(loadBackup, 3000)
}

function renderBackup() {
  const b = state.backup
  if (!b) return
  const when = d => d ? new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  const size = n => n == null ? '—' : n >= 1e9 ? `${num(n / 1e9, 1)} GB` : `${num(n / 1e6, 1)} MB`
  const last = b.ultima
  const ok = b.ultimaRiuscita
  const row = (title, sub) => `<li class="gia-row"><div><div class="gia-row-title">${title}</div><div class="gia-row-sub">${sub}</div></div></li>`
  $('backupList').innerHTML = [
    row(b.inCorso ? '<span class="gia-ok">Copia in corso…</span>'
      : last?.esito === 'errore' ? '<span class="gia-ko">Ultima copia non riuscita</span>'
      : ok ? '<span class="gia-ok">Ultima copia riuscita</span>' : '<span class="gia-ko">Nessuna copia ancora</span>',
      last?.esito === 'errore' ? `${when(last.fine)} · ${esc(last.errore)}`
        : ok ? `${when(ok.fine)} · ${size(ok.byte)} · ${num(ok.fotoNuove)} foto nuove` : 'La prima parte da sola, o con "Copia adesso"'),
    row('Prossima copia', when(b.prossima)),
    row('Dove', `<span class="gia-code">${esc(b.cartella || '—')}</span> · libero ${size(b.liberoByte)} · ` +
      (b.copie === 1 ? '1 copia conservata' : `${num(b.copie ?? 0)} copie conservate`)),
  ].join('')
  $('btnBackup').disabled = !!b.inCorso
  const alert = $('backupAlert')
  alert.hidden = !b.avvisi?.length
  alert.innerHTML = b.avvisi?.length
    ? `<b>Copia di sicurezza</b><ul>${b.avvisi.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`
    : ''
}

async function backupNow() {
  $('btnBackup').disabled = true
  try {
    state.backup = await startBackup()
    renderBackup()
    showToast('Copia di sicurezza avviata')
    setTimeout(loadBackup, 2000)
  } catch (err) {
    $('btnBackup').disabled = false
    showToast(err.message || 'Copia non avviata')
  }
}

// ─── Eventi ───────────────────────────────────────────────────

function setupListeners() {
  for (const tab of document.querySelectorAll('.gia-tab')) tab.addEventListener('click', () => selectTab(tab.id))

  $('companyForm').addEventListener('submit', saveCompany)

  $('btnNewVat').addEventListener('click', () => openVatModal())
  $('vatForm').addEventListener('submit', saveVat)
  $('btnCloseVat').addEventListener('click', closeVatModal)
  $('btnCancelVat').addEventListener('click', closeVatModal)
  $('vatModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeVatModal() })
  $('vatList').addEventListener('click', e => {
    const edit = e.target.closest('[data-vat-edit]')
    if (edit) return openVatModal(state.vatRates.find(r => r.id === edit.dataset.vatEdit))
    for (const [attribute, action] of [['vatDefault', 'default'], ['vatArchive', 'archive'], ['vatRestore', 'restore'], ['vatDelete', 'delete']]) {
      const button = e.target.closest(`[data-vat-${action}]`)
      if (button) return vatAction(action, button.dataset[attribute], button)
    }
  })

  $('counterForm').addEventListener('submit', saveCounter)
  $('btnCloseCounter').addEventListener('click', closeCounterModal)
  $('btnCancelCounter').addEventListener('click', closeCounterModal)
  $('counterModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeCounterModal() })
  $('counterList').addEventListener('click', e => {
    const button = e.target.closest('[data-counter]')
    if (button) openCounterModal(button.dataset.counter)
  })

  $('locationForm').addEventListener('submit', createLocation)
  $('deviceList').addEventListener('click', e => {
    const btn = e.target.closest('[data-revoke]')
    if (btn) revoke(btn.dataset.revoke, btn)
  })

  $('btnBackup').addEventListener('click', backupNow)

  $('btnNewUser').hidden = !IN_SEDE
  $('usersHint').textContent = IN_SEDE
    ? 'Un account per persona: i movimenti dicono chi li ha fatti. Chi lascia l\'azienda si disattiva, e i suoi movimenti restano con il suo nome.'
    : 'Su questo sito di prova gli account si creano e le password si cambiano dal pannello di Supabase. Qui si assegnano ruolo e stato.'
  $('btnNewUser').addEventListener('click', () => openUserModal('create'))
  $('userForm').addEventListener('submit', saveUser)
  $('btnCloseUser').addEventListener('click', closeUserModal)
  $('btnCancelUser').addEventListener('click', closeUserModal)
  $('userModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeUserModal() })
  $('userList').addEventListener('click', e => {
    const edit = e.target.closest('[data-user-edit]')
    const reset = e.target.closest('[data-user-reset]')
    const toggle = e.target.closest('[data-user-active]')
    if (edit) openUserModal('edit', state.users.find(u => u.id === edit.dataset.userEdit))
    if (reset) openUserModal('reset', state.users.find(u => u.id === reset.dataset.userReset))
    if (toggle) toggleUser(toggle.dataset.userActive, toggle.dataset.to === 'true', toggle)
  })
}

init().catch(err => {
  console.error(err)
  block(`Non riesco a caricare le impostazioni: ${err.message || err}`)
})
