// js/archivio.js — Finestra "Archiviati" (CR10, REQ-A-07): gli articoli tolti dalle liste, da riattivare. Solo amministrazione.
import { getArchivedItems, restoreItem } from './supabase.js'
import { showToast } from './utils.js'

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function openArchiveModal({ onChange }) {
  document.getElementById('archiveModal')?.remove()
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="archiveModal" role="dialog" aria-modal="true" aria-labelledby="archiveModalTitle">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-eyebrow">Magazzino · Solo amministrazione</div>
            <div class="modal-title" id="archiveModalTitle">Articoli archiviati</div>
          </div>
          <button type="button" id="archiveClose" aria-label="Chiudi" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" id="archiveList" aria-live="polite">Caricamento…</div>
      </div>
    </div>`)

  const modal = document.getElementById('archiveModal')
  const list = document.getElementById('archiveList')
  const close = () => modal.remove()
  document.getElementById('archiveClose').addEventListener('click', close)
  modal.addEventListener('click', e => { if (e.target === modal) close() })
  requestAnimationFrame(() => modal.classList.add('open'))

  let items = []
  const render = () => {
    list.innerHTML = items.length ? items.map((it, i) => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--ivory-dark);">
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--mono);font-size:12px;">${esc(it.code)}</div>
          <div style="font-family:var(--editorial);font-size:13px;color:var(--text-secondary);">${esc(it.name)}</div>
          <div style="font-family:var(--editorial);font-size:11px;color:var(--text-muted);">Archiviato il ${new Date(it.archivedAt).toLocaleDateString('it-IT')}</div>
        </div>
        <button type="button" class="btn-ghost" data-restore="${i}">Riattiva</button>
      </div>`).join('')
      : '<p style="font-family:var(--editorial);color:var(--text-muted);">Nessun articolo archiviato.</p>'
  }

  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-restore]')
    if (!btn) return
    const item = items[Number(btn.dataset.restore)]
    btn.disabled = true
    try {
      await restoreItem(item)
      items = items.filter(x => x !== item)
      render()
      showToast(`Articolo ${item.code} riattivato`)
      await onChange?.()
    } catch (err) {
      console.error(err)
      showToast(err.message, 6000)
      btn.disabled = false
    }
  })

  try {
    items = await getArchivedItems()
    render()
  } catch (err) {
    console.error(err)
    list.textContent = 'Errore nel caricamento: ' + err.message
  }
}
