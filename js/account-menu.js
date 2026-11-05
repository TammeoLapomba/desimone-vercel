// js/account-menu.js — "Esci" nella sede: chi sono, e il cambio della propria password (scheda 1.4, decisione 4)
//
// Il bottone è lo stesso su tutte le pagine, e su telefono e tablet è quello della barra in basso. Nella sede passa
// da qui; su Supabase esce e basta, perché la password si cambia dal suo pannello (decisione 9).
import { IN_SEDE, getMyAccount, changeMyPassword, signOut } from './supabase.js'
import { showToast } from './utils.js'

const ROLE_LABELS = { admin: 'Amministrazione', dev: 'Dedalo', fiere: 'Fiere', laboratorio: 'Laboratorio', negozio: 'Negozio' }

let modal = null
let account = null
let returnFocus = null

function close() {
  modal.classList.remove('open')
  returnFocus?.focus()
}

function showPasswordForm(show) {
  modal.querySelector('#accountPasswordForm').hidden = !show
  modal.querySelector('#accountMenuActions').hidden = show
  modal.querySelector('#accountError').textContent = ''
  if (show) modal.querySelector('#accountCurrent').focus()
}

async function savePassword(e) {
  e.preventDefault()
  const current = modal.querySelector('#accountCurrent').value
  const next = modal.querySelector('#accountNew').value
  const error = modal.querySelector('#accountError')
  error.textContent = ''
  if (!current) return void (error.textContent = 'Scrivi la password di adesso')
  if (next.length < 8) return void (error.textContent = 'La password nuova deve avere almeno 8 caratteri')
  if (next !== modal.querySelector('#accountRepeat').value) return void (error.textContent = 'Le due password nuove non coincidono')
  const button = modal.querySelector('#btnAccountSave')
  button.disabled = true
  try {
    await changeMyPassword(account.username, current, next)
    e.target.reset()
    showPasswordForm(false)
    close()
    showToast('Password cambiata')
  } catch (err) {
    error.textContent = err.message
  } finally {
    button.disabled = false
  }
}

function build() {
  modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'accountModal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'accountModalTitle')
  modal.innerHTML = `
    <div class="modal modal-compact">
      <div class="modal-header">
        <div>
          <div class="modal-eyebrow" id="accountModalSub"></div>
          <div class="modal-title" id="accountModalTitle"></div>
        </div>
        <button type="button" id="btnAccountClose" aria-label="Chiudi" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-footer" id="accountMenuActions">
        <button type="button" class="btn-ghost" id="btnAccountPassword">Cambia password</button>
        <button type="button" class="btn-primary" id="btnAccountExit">Esci</button>
      </div>
      <form id="accountPasswordForm" novalidate hidden>
        <div class="modal-body">
          <div class="form-row full"><div class="form-field">
            <label class="field-label" for="accountCurrent">Password di adesso</label>
            <input type="password" class="field-input" id="accountCurrent" autocomplete="current-password">
          </div></div>
          <div class="form-row full"><div class="form-field">
            <label class="field-label" for="accountNew">Password nuova</label>
            <input type="password" class="field-input" id="accountNew" autocomplete="new-password">
            <span class="field-hint">Almeno 8 caratteri.</span>
          </div></div>
          <div class="form-row full"><div class="form-field">
            <label class="field-label" for="accountRepeat">Ripeti la password nuova</label>
            <input type="password" class="field-input" id="accountRepeat" autocomplete="new-password">
          </div></div>
          <div class="field-error" id="accountError" role="alert"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-ghost" id="btnAccountBack">Indietro</button>
          <button type="submit" class="btn-primary" id="btnAccountSave">Salva</button>
        </div>
      </form>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('#btnAccountClose').addEventListener('click', close)
  modal.querySelector('#btnAccountExit').addEventListener('click', signOut)
  modal.querySelector('#btnAccountPassword').addEventListener('click', () => showPasswordForm(true))
  modal.querySelector('#btnAccountBack').addEventListener('click', () => showPasswordForm(false))
  modal.querySelector('#accountPasswordForm').addEventListener('submit', savePassword)
  modal.addEventListener('click', e => { if (e.target === modal) close() })
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
}

async function open(from) {
  returnFocus = from
  try {
    account = await getMyAccount()
  } catch {
    // Senza risposta dal database si esce come sempre
    return signOut()
  }
  if (!modal) build()
  modal.querySelector('#accountModalTitle').textContent = account.name
  modal.querySelector('#accountModalSub').textContent = [account.username, ROLE_LABELS[account.role]].filter(Boolean).join(' · ')
  showPasswordForm(false)
  modal.classList.add('open')
  modal.querySelector('#btnAccountExit').focus()
}

// In cattura: il clic non arriva al bottone, che altrimenti uscirebbe subito. Così le pagine non cambiano
if (IN_SEDE) {
  document.addEventListener('click', e => {
    const button = e.target.closest('.sidebar-account, #mobileSignOutBtn')
    if (!button) return
    e.stopPropagation()
    e.preventDefault()
    open(button)
  }, true)
}
