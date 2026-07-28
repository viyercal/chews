import { el, esc, renderCard } from './cards.js'
import { SwipeController } from './swipe.js'
import { milesBetween } from '../core/geo.js'
import { toast } from './toast.js'

// Receiver side of Couple Mode: swipe the sender's shortlist through your own
// taste, then the overlap goes to Face-off. Ephemeral by design — the only
// lasting side effect is taste learning (your swipes are real signals).
export class DuoView {
  constructor({ root, byId, engine, store, faceoff, onExit }) {
    this.root = root
    this.byId = byId
    this.engine = engine
    this.store = store
    this.faceoff = faceoff
    this.onExit = onExit
    this.controller = null
  }

  start(payload) {
    const restos = payload.ids.map((id) => this.byId[id]).filter(Boolean)
    if (restos.length < 2) {
      toast('This invite\'s spots aren\'t available in your app version')
      this.exit()
      return
    }
    this.loc = payload.loc || null
    this.invited = restos
    // Their list, ordered by YOUR taste — cold-start users just get quality order.
    this.queue = restos
      .map((r) => ({ resto: r, score: this.engine.score(r, { distanceMi: this.dist(r) ?? 2 }) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.resto)
    this.total = this.queue.length
    this.yes = []
    this.renderNext()
  }

  dist(r) {
    return this.loc ? milesBetween(this.loc, r) : null
  }

  renderNext() {
    this.controller?.destroy()
    this.controller = null
    this.root.innerHTML = ''
    if (!this.queue.length) {
      this.finish()
      return
    }
    const resto = this.queue[0]
    const done = this.total - this.queue.length
    const wrap = el(`
      <div class="duo show" role="dialog" aria-modal="true" aria-label="Decide together">
        <div class="faceoff-top">
          <span class="faceoff-title">💞 Their shortlist</span>
          <span class="faceoff-round">${done + 1} of ${this.total} — your call</span>
          <button class="icon-btn duo-close" aria-label="Close">✕</button>
        </div>
        <div class="duo-stack"></div>
        <div id="deck-actions" class="duo-actions">
          <button class="act act-pass" aria-label="Pass">✕</button>
          <button class="act act-yum" aria-label="Yum">♥</button>
        </div>
      </div>
    `)
    const stack = wrap.querySelector('.duo-stack')
    const card = renderCard(resto, this.dist(resto))
    card.classList.add('depth-0')
    stack.appendChild(card)
    this.controller = new SwipeController(card, {
      onLeft: () => this.swipe(resto, -1),
      onRight: () => this.swipe(resto, 1),
      onTap: () => {},
    })
    wrap.querySelector('.act-pass').addEventListener('click', () => this.controller?.fling(-1))
    wrap.querySelector('.act-yum').addEventListener('click', () => this.controller?.fling(1))
    wrap.querySelector('.duo-close').addEventListener('click', () => this.exit())
    this.root.appendChild(wrap)
  }

  swipe(resto, dir) {
    this.engine.record(resto, dir)
    this.store.saveTaste(this.engine.toJSON())
    if (dir > 0) this.yes.push(resto)
    this.queue.shift()
    this.renderNext()
  }

  finish() {
    this.root.innerHTML = ''
    if (this.yes.length >= 2) {
      toast(`You matched on ${this.yes.length} — settle it ⚡`)
      this.faceoff.start(this.yes)
      this.faceoffWatch()
    } else if (this.yes.length === 1) {
      // A single mutual yes IS the decision.
      this.faceoff.pool = [this.yes[0]]
      this.faceoff.nextRound = []
      this.faceoff.renderPair()
      this.faceoffWatch()
    } else {
      const wrap = el(`
        <div class="duo show champion">
          <p class="champ-label">No overlap 😅</p>
          <p class="panel-note" style="text-align:center">You passed on all their picks. Tap through their list head-to-head and choose one anyway — someone has to.</p>
          <div class="champ-actions">
            <button class="btn btn-accent duo-anyway">⚡ Pick one anyway</button>
            <button class="btn btn-ghost duo-exit">Close</button>
          </div>
        </div>
      `)
      wrap.querySelector('.duo-anyway').addEventListener('click', () => {
        this.root.innerHTML = ''
        this.faceoff.start(this.invited)
        this.faceoffWatch()
      })
      wrap.querySelector('.duo-exit').addEventListener('click', () => this.exit())
      this.root.appendChild(wrap)
    }
  }

  faceoffWatch() {
    // When the face-off overlay empties (Done tapped), hand back to the app.
    const obs = new MutationObserver(() => {
      if (!this.faceoff.root.children.length) {
        obs.disconnect()
        this.exit()
      }
    })
    obs.observe(this.faceoff.root, { childList: true })
  }

  exit() {
    this.controller?.destroy()
    this.root.innerHTML = ''
    this.onExit?.()
  }
}
