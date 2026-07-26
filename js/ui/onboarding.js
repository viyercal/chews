import { el, esc } from './cards.js'
import { locate, locateFailureCopy, nearestSpot, FALLBACK_SPOTS } from '../core/geo.js'
import { toast } from './toast.js'

// First-run screen: get a location (GPS with graceful demo fallback), then an
// optional taste-seed step, and go.
export function showOnboarding(root, { store, onDone, seedChoices = [], onSeed }) {
  const node = el(`
    <div class="onboard">
      <div class="onboard-inner">
        <div class="onboard-mark" aria-hidden="true">🍜</div>
        <h1 class="onboard-logo">Chews</h1>
        <p class="onboard-tag">swipe. match. eat.</p>
        <p class="onboard-blurb">One great dish per card. Swipe right if it makes you hungry, left if not. When you can't decide, we'll settle it.</p>
        <div class="onboard-actions">
          <button class="btn btn-accent btn-big" id="ob-locate">📍 Find food near me</button>
          <button class="btn btn-ghost" id="ob-demo">Browse San Francisco instead</button>
        </div>
      </div>
    </div>
  `)

  const finish = () => {
    store.setSetting('onboarded', true)
    if (!seedChoices.length) {
      node.remove()
      onDone()
      return
    }
    // Step 2: optional taste seed — skippable, max 3 picks, a weak prior only.
    const picked = new Set()
    const inner = node.querySelector('.onboard-inner')
    inner.innerHTML = `
      <div class="onboard-mark" aria-hidden="true">😋</div>
      <h1 class="onboard-step-title">Anything you already love?</h1>
      <p class="onboard-blurb">Pick up to 3 — or skip and let your swipes do the talking. This only nudges your first deck; your swipes always win.</p>
      <div class="chip-row wrap onboard-seeds">${seedChoices
        .map((c) => `<button class="chip chip-btn" data-seed="${esc(c)}">${esc(c)}</button>`)
        .join('')}</div>
      <div class="onboard-actions">
        <button class="btn btn-accent btn-big" id="ob-start">Start swiping</button>
      </div>`
    inner.querySelectorAll('[data-seed]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = b.dataset.seed
        if (picked.has(c)) {
          picked.delete(c)
          b.classList.remove('on')
        } else if (picked.size < 3) {
          picked.add(c)
          b.classList.add('on')
        }
      })
    )
    inner.querySelector('#ob-start').addEventListener('click', () => {
      if (picked.size) onSeed?.([...picked])
      node.remove()
      onDone()
    })
  }

  node.querySelector('#ob-locate').addEventListener('click', async () => {
    const btn = node.querySelector('#ob-locate')
    btn.disabled = true
    btn.textContent = 'Locating…'
    try {
      const loc = await locate()
      const { spot, miles } = nearestSpot(loc)
      if (miles > 40) {
        store.setSetting('location', { ...spot, source: 'manual', label: `${spot.name} (demo)` })
        toast(`You're outside the indexed cities — exploring ${spot.name}`)
      } else {
        store.setSetting('location', { ...loc, label: 'Near you' })
      }
      finish()
    } catch (e) {
      btn.disabled = false
      btn.textContent = '📍 Find food near me'
      toast(locateFailureCopy(e?.reason))
      // Don't strand them behind a broken button — surface the spots right here.
      if (!node.querySelector('.onboard-spots')) {
        const spots = el(
          `<div class="chip-row wrap onboard-spots">${FALLBACK_SPOTS.map(
            (f) => `<button class="chip chip-btn" data-spot="${esc(f.name)}">${esc(f.name)}</button>`
          ).join('')}</div>`
        )
        spots.querySelectorAll('[data-spot]').forEach((b) =>
          b.addEventListener('click', () => {
            const f = FALLBACK_SPOTS.find((x) => x.name === b.dataset.spot)
            store.setSetting('location', { lat: f.lat, lng: f.lng, source: 'manual', label: f.name })
            finish()
          })
        )
        node.querySelector('.onboard-actions').before(spots)
      }
    }
  })

  node.querySelector('#ob-demo').addEventListener('click', () => {
    const f = FALLBACK_SPOTS[0]
    store.setSetting('location', { lat: f.lat, lng: f.lng, source: 'manual', label: f.name })
    finish()
  })

  root.appendChild(node)
}
