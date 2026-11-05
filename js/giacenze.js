// js/giacenze.js — Giacenze per articolo e luogo, luoghi e dispositivi (fetta 3)
//
// Servizi della BBA: UC-01 consultare le giacenze per articolo e luogo (tutti, REQ-001.1), UC-10 stampare l'elenco
// (amministrazione, REQ-R-01), UC-14 vedere il valore (amministrazione, REQ-M-08; base da decidere), UC-11 gestire
// i luoghi (REQ-M-07), UC-13 revocare un dispositivo (REQ-S-01…S-03). Nella WBA: L-01 interfaccia, F-13 mostrare le
// giacenze, F-15 produrre l'elenco (L-11), F-23 luoghi, F-24 revoca. La giacenza è la somma dei movimenti
// (stock_levels, REQ-C-01) e i permessi li decide il database: qui si mostra solo ciò che il ruolo può fare.
// Nella scheda Utenti l'amministrazione gestisce gli account (REQ-P-08, P-09, scheda 1.4).
import {
  requireAuth, signOut, getMyOperator, getMovementSetup, getStockOverview, insertLocation, revokeDevice,
  IN_SEDE, getBackupStatus, startBackup,
  getAccounts, saveAccount, setAccountActive, createAccount, resetAccountPassword,
} from './supabase.js'
import { showToast } from './utils.js'
import { initMobileNav } from './pwa.js'

window.signOutUser = signOut

const ROLE_LABELS = { admin: 'Amministrazione', laboratorio: 'Laboratorio', negozio: 'Negozio', fiere: 'Fiere' }
const DEVICE_KEY = 'desimone-os:dispositivo'

const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n, digits = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const euro = n => `€ ${num(n, 2)}`
const gramsText = g => `${num(g, 1)} g`     // al decimo di grammo (REQ-U-08)
const articles = n => `${num(n)} ${n === 1 ? 'articolo' : 'articoli'}`

const state = {
  operator: null,
  locations: [],
  devices: [],
  items: [],       // { kind, id, code, name, group, unit, priceRetail, priceWholesale, at: Map location_id → { pieces, grams } }
  backup: null,    // stato della copia di sicurezza (sede/servizio/copia.js), solo nella sede e per l'amministrazione
  users: [],       // accounts_list: solo per l'amministrazione
  editingUser: null,
  userMode: null,  // create, edit, reset
}
const isAdmin = () => state.operator?.role === 'admin'

// ─── Avvio ────────────────────────────────────────────────────

async function init() {
  await requireAuth()
  initMobileNav()

  state.operator = await getMyOperator()
  if (!state.operator) {
    return block('Il tuo utente non è ancora abilitato alle giacenze: chiedi all\'amministrazione di aggiungerti agli operatori.')
  }
  $('operatorChip').textContent = `${state.operator.name} · ${ROLE_LABELS[state.operator.role]}`

  await load()
  $('page').hidden = false
  if (isAdmin()) {
    $('tab-locations').hidden = false
    $('tab-devices').hidden = false
    $('tab-users').hidden = false
    $('btnPrint').hidden = false
    $('valueNote').hidden = false
  }
  setupListeners()
  renderAll()
  if (isAdmin()) loadUsers()
  if (isAdmin() && IN_SEDE) {
    $('tab-backup').hidden = false
    loadBackup()
  }
}

function block(message) {
  $('blocked').textContent = message
  $('blocked').hidden = false
}

async function load() {
  const [setup, overview] = await Promise.all([getMovementSetup(), getStockOverview()])
  state.locations = setup.locations
  state.devices = setup.devices
  state.items = normalize(overview)
}

// Gioielli e semilavorati nella stessa forma, con la giacenza per luogo
function normalize({ articles, raw, stock }) {
  const at = new Map()
  for (const r of stock) {
    const id = r.article_id || r.raw_item_id
    if (!at.has(id)) at.set(id, new Map())
    at.get(id).set(r.location_id, { pieces: r.pieces, grams: Number(r.grams) })
  }
  const art = articles.map(a => ({
    kind: 'montato', id: a.id, code: a.sku || '', name: a.name || '',
    group: ['Gioiello', a.product_type?.name, a.collections?.name].filter(Boolean).join(' · '),
    unit: 'pezzi', priceRetail: Number(a.price_retail) || 0, priceWholesale: Number(a.price_wholesale) || 0,
    at: at.get(a.id) || new Map(),
  }))
  const semi = raw.map(r => ({
    kind: 'semilavorato', id: r.id, code: r.sku || '', name: r.description || r.size || '',
    group: ['Semilavorato', r.raw_categories?.name].filter(Boolean).join(' · '),
    unit: r.unit, priceRetail: 0, priceWholesale: 0,
    at: at.get(r.id) || new Map(),
  }))
  return [...art, ...semi].sort((a, b) => a.code.localeCompare(b.code, 'it', { numeric: true }))
}

// ─── Schede ───────────────────────────────────────────────────

function selectTab(id) {
  for (const tab of document.querySelectorAll('.gia-tab')) {
    const on = tab.id === id
    tab.setAttribute('aria-selected', on)
    $(tab.getAttribute('aria-controls')).hidden = !on
  }
}

function renderAll() {
  renderStock()
  if (isAdmin()) {
    renderLocations()
    renderDevices()
  }
}

// ─── Giacenze (UC-01, UC-10, UC-14) ───────────────────────────

const totalOf = item => {
  let pieces = 0, grams = 0
  for (const s of item.at.values()) { pieces += s.pieces; grams += s.grams }
  return { pieces, grams }
}
const hasStock = s => s && (s.pieces !== 0 || Math.abs(s.grams) >= 0.05)

// Quantità nell'unità dell'articolo (REQ-U-03): pezzi, grammi, o pezzi e grammi
function qty(item, s) {
  if (!hasStock(s)) return ''
  if (item.unit === 'grammi') return gramsText(s.grams)
  if (item.unit === 'pezzi_grammi') return `${num(s.pieces)} pz · ${gramsText(s.grams)}`
  return num(s.pieces)
}

// Colonne: i luoghi attivi, più quelli disattivati che hanno ancora merce
function stockColumns(items) {
  return state.locations.filter(l => l.active || items.some(i => hasStock(i.at.get(l.id))))
}

function filteredItems() {
  const q = $('searchInput').value.trim().toLowerCase()
  const kind = $('kindSelect').value
  const onlyStock = $('onlyStock').checked
  return state.items.filter(i =>
    (!kind || i.kind === kind) &&
    (!onlyStock || hasStock(totalOf(i))) &&
    (!q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)))
}

function renderStock() {
  const items = filteredItems()
  const columns = stockColumns(state.items)
  const admin = isAdmin()

  const head = `
    <colgroup>
      <col class="gia-col-code"><col class="gia-col-name">
      ${columns.map(() => '<col class="gia-col-qty">').join('')}
      <col class="gia-col-qty">
      ${admin ? '<col class="gia-col-value"><col class="gia-col-value">' : ''}
    </colgroup>
    <thead><tr>
      <th scope="col">Codice</th><th scope="col">Articolo</th>
      ${columns.map(l => `<th scope="col" class="num">${esc(l.name)}${l.active ? '' : ' <span class="gia-off">(disattivato)</span>'}</th>`).join('')}
      <th scope="col" class="num">Totale</th>
      ${admin ? '<th scope="col" class="num">Valore pubblico</th><th scope="col" class="num">Valore ingrosso</th>' : ''}
    </tr></thead>`

  let valueRetail = 0, valueWholesale = 0, piecesMontato = 0
  const rows = items.map(i => {
    const total = totalOf(i)
    const vr = i.kind === 'montato' ? total.pieces * i.priceRetail : 0
    const vw = i.kind === 'montato' ? total.pieces * i.priceWholesale : 0
    if (i.kind === 'montato') piecesMontato += total.pieces
    valueRetail += vr
    valueWholesale += vw
    return `
      <tr data-code="${esc(i.code)}" tabindex="0" title="Apri nei Movimenti">
        <td class="cell-code" title="${esc(i.code)}">${esc(i.code) || '—'}</td>
        <td><div class="cell-title" title="${esc(i.name)}">${esc(i.name) || '—'}</div><div class="cell-sub">${esc(i.group)}</div></td>
        ${columns.map(l => { const t = qty(i, i.at.get(l.id)); return `<td class="num${t ? '' : ' is-zero'}">${t || '0'}</td>` }).join('')}
        <td class="num gia-total${hasStock(total) ? '' : ' is-zero'}">${qty(i, total) || '0'}</td>
        ${admin ? `<td class="num">${i.kind === 'montato' && i.priceRetail ? euro(vr) : '—'}</td>
                   <td class="num">${i.kind === 'montato' && i.priceWholesale ? euro(vw) : '—'}</td>` : ''}
      </tr>`
  }).join('')

  const foot = items.length && admin ? `
    <tfoot><tr>
      <td colspan="${columns.length + 2}">Totale gioielli: ${num(piecesMontato)} pezzi</td>
      <td></td>
      <td class="num">${euro(valueRetail)}</td><td class="num">${euro(valueWholesale)}</td>
    </tr></tfoot>` : ''

  // Larghezza minima dalle colonne: sotto, la tabella scorre di lato invece di schiacciare il nome
  $('stockTable').style.minWidth = `${150 + 240 + 120 * (columns.length + 1) + (admin ? 300 : 0)}px`
  $('stockTable').innerHTML = head + `<tbody>${rows || `<tr><td class="table-empty" colspan="${columns.length + 3 + (admin ? 2 : 0)}">Nessun articolo trovato</td></tr>`}</tbody>` + foot
  $('stockCount').textContent = articles(items.length)
}

// Elenco stampabile (REQ-R-01): quello che si vede, con data, ora, chi lo stampa e i filtri usati
function printList() {
  const filters = [
    $('kindSelect').selectedOptions[0].text,
    $('onlyStock').checked ? 'solo articoli con giacenza' : 'anche a zero',
    $('searchInput').value.trim() ? `ricerca "${$('searchInput').value.trim()}"` : '',
  ].filter(Boolean).join(' · ')
  const now = new Date().toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' })
  $('printHead').innerHTML = `
    <div class="gia-print-title">Elenco delle giacenze</div>
    <div>Al ${esc(now)} · stampato da ${esc(state.operator.name)} · ${esc(filters)}</div>`
  window.print()
}

// ─── Luoghi (UC-11, REQ-M-07) ─────────────────────────────────

function renderLocations() {
  $('locationList').innerHTML = state.locations.map(l => {
    const holding = state.items.filter(i => hasStock(i.at.get(l.id))).length
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
    renderAll()
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
  $('searchInput').addEventListener('input', renderStock)
  $('kindSelect').addEventListener('change', renderStock)
  $('onlyStock').addEventListener('change', renderStock)
  $('btnPrint').addEventListener('click', printList)
  $('locationForm').addEventListener('submit', createLocation)
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
  $('deviceList').addEventListener('click', e => {
    const btn = e.target.closest('[data-revoke]')
    if (btn) revoke(btn.dataset.revoke, btn)
  })
  // Una riga apre l'articolo nei Movimenti, con giacenza e storico (UC-02)
  const open = row => { if (row?.dataset.code) location.href = `/movimenti.html?codice=${encodeURIComponent(row.dataset.code)}` }
  $('stockTable').addEventListener('click', e => open(e.target.closest('tbody tr')))
  $('stockTable').addEventListener('keydown', e => { if (e.key === 'Enter') open(e.target.closest('tbody tr')) })
}

init().catch(err => {
  console.error(err)
  block(`Non riesco a caricare le giacenze: ${err.message || err}`)
})
