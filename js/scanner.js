// js/scanner.js — Lettura dei QR De Simone con la fotocamera, su tablet e telefoni Android e iOS
//
// scanQr() apre la fotocamera posteriore a tutto schermo e restituisce il testo del primo QR letto (o null se si
// chiude). Il testo va poi dove andrebbe quello della pistola: per l'app il QR contiene solo il codice (AC-05).
// Per riconoscere il QR:
//   - BarcodeDetector, il lettore del browser (Chrome su Android): veloce e senza file in più;
//   - dove manca (Safari su iPhone e iPad, Firefox) jsQR, in js/vendor/: si carica solo la prima volta che serve.
// Il browser dà la fotocamera solo in https o su localhost (cameraSupport). Niente da internet: in sede non c'è.

const JSQR_SRC = '/js/vendor/jsQR-1.4.0.js'
const SCAN_EVERY_MS = 120   // circa 8 letture al secondo: basta per un'etichetta e non scalda il telefono
const MAX_SIDE = 720        // jsQR lavora su un fotogramma ridotto: più veloce, e i QR delle etichette restano leggibili

// 'ok' | 'https' (pagina non sicura: il browser non dà la fotocamera) | 'none' (browser senza fotocamera)
export function cameraSupport() {
  if (!window.isSecureContext) return 'https'
  return navigator.mediaDevices?.getUserMedia ? 'ok' : 'none'
}

let jsqrLoading = null
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR)
  jsqrLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = JSQR_SRC
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('Lettore QR non caricato')))
    s.onerror = () => { jsqrLoading = null; reject(new Error('Lettore QR non caricato')) }
    document.head.appendChild(s)
  })
  return jsqrLoading
}

// Il lettore del browser se c'è e conosce i QR, altrimenti jsQR su un fotogramma ridotto
async function makeReader(video) {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        return async () => (await detector.detect(video))[0]?.rawValue || null
      }
    } catch { /* si passa a jsQR */ }
  }
  const jsQR = await loadJsQR()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return async () => {
    const w = video.videoWidth, h = video.videoHeight
    if (!w || !h) return null
    const k = Math.min(1, MAX_SIDE / Math.max(w, h))
    canvas.width = Math.round(w * k)
    canvas.height = Math.round(h * k)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null
  }
}

const MESSAGES = {
  NotAllowedError: 'Fotocamera non consentita: permettila al browser nelle impostazioni del dispositivo e riprova.',
  SecurityError: 'Fotocamera non consentita: la pagina deve essere in https.',
  NotFoundError: 'Nessuna fotocamera trovata su questo dispositivo.',
  OverconstrainedError: 'Nessuna fotocamera trovata su questo dispositivo.',
  NotReadableError: 'La fotocamera è usata da un\'altra app: chiudila e riprova.',
}

export function scanQr({ title = 'Inquadra il QR dell\'etichetta' } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'qr-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', title)
    overlay.innerHTML = `
      <video class="qr-video" playsinline muted autoplay></video>
      <div class="qr-frame" aria-hidden="true"></div>
      <div class="qr-top"><span class="qr-title"></span></div>
      <div class="qr-bottom">
        <p class="qr-status" role="status">Accendo la fotocamera…</p>
        <div class="qr-buttons">
          <button type="button" class="qr-btn" data-qr="torch" hidden>Torcia</button>
          <button type="button" class="qr-btn qr-btn-main" data-qr="close">Chiudi</button>
        </div>
      </div>`
    overlay.querySelector('.qr-title').textContent = title
    const video = overlay.querySelector('video')
    const status = overlay.querySelector('.qr-status')
    const torchBtn = overlay.querySelector('[data-qr="torch"]')
    const lastFocus = document.activeElement
    let stream = null, timer = null, done = false, torch = false

    const finish = value => {
      if (done) return
      done = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
      document.removeEventListener('visibilitychange', onHidden)
      document.removeEventListener('keydown', onKey)
      overlay.remove()
      lastFocus?.focus?.()
      resolve(value)
    }
    const onHidden = () => { if (document.hidden) finish(null) }   // app in secondo piano: la fotocamera si spegne
    const onKey = e => { if (e.key === 'Escape') finish(null) }

    overlay.addEventListener('click', async e => {
      const action = e.target.closest('[data-qr]')?.dataset.qr
      if (action === 'close') finish(null)
      if (action === 'torch') {
        torch = !torch
        await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch }] }).catch(() => {})
        torchBtn.classList.toggle('qr-btn-on', torch)
      }
    })
    document.addEventListener('visibilitychange', onHidden)
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
    overlay.querySelector('[data-qr="close"]').focus()

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (done) return stream.getTracks().forEach(t => t.stop())
        video.srcObject = stream
        await video.play()
        // La torcia c'è su molti Android; su iOS il browser non la offre
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {}
        torchBtn.hidden = !caps.torch
        const read = await makeReader(video)
        status.textContent = 'Avvicina l\'etichetta finché il QR è dentro il riquadro'
        const tick = async () => {
          if (done) return
          try {
            const text = video.readyState >= 2 ? await read() : null
            if (text && !done) {
              navigator.vibrate?.(60)
              return finish(text)
            }
          } catch { /* un fotogramma non letto: si prova col prossimo */ }
          timer = setTimeout(tick, SCAN_EVERY_MS)
        }
        tick()
      } catch (err) {
        status.textContent = MESSAGES[err.name] || `Fotocamera non disponibile: ${err.message}`
        overlay.classList.add('qr-error')
      }
    })()
  })
}
