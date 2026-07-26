import { el, esc, renderMiniCard, mapsUrl } from './cards.js'
import { milesBetween } from '../core/geo.js'
import { clearToasts } from './toast.js'

// Head-to-head elimination over the shortlist: tap the winner until one
// restaurant remains. Turns "idk, you pick" into a 30-second game.
export class Faceoff {
  constructor(root, { store }) {
    this.root = root
    this.store = store
  }

  start(restos) {
    if (restos.length < 2) return
    clearToasts() // stale "saved" toasts must not cover the face-off header
    this.pool = shuffle([...restos])
    this.nextRound = []
    this.locked = false
    this.renderPair()
  }

  distanceTo(resto) {
    const loc = this.store.settings.location
    return loc ? milesBetween(loc, resto) : null
  }

  renderPair() {
    if (this.pool.length === 1 && !this.nextRound.length) {
      this.renderChampion(this.pool[0])
      return
    }
    if (this.pool.length < 2) {
      this.nextRound.push(...this.pool)
      this.pool = this.nextRound
      this.nextRound = []
      this.roundSize = this.pool.length
      this.renderPair()
      return
    }
    const [a, b] = this.pool
    const remaining = this.pool.length + this.nextRound.length
    this.root.innerHTML = ''
    const wrap = el(`
      <div class="faceoff show" role="dialog" aria-modal="true" aria-label="Face-off">
        <div class="faceoff-top">
          <span class="faceoff-title">⚡ Face-off</span>
          <span class="faceoff-round">${remaining} spots left — tap the winner</span>
          <button class="icon-btn faceoff-close" aria-label="Close">✕</button>
        </div>
        <div class="faceoff-pair"><div class="faceoff-vs" aria-hidden="true">vs</div></div>
      </div>
    `)
    const pair = wrap.querySelector('.faceoff-pair')
    for (const resto of [a, b]) {
      const card = renderMiniCard(resto, this.distanceTo(resto))
      card.classList.add('faceoff-card')
      card.addEventListener('click', () => this.pick(resto))
      pair.appendChild(card)
    }
    wrap.querySelector('.faceoff-close').addEventListener('click', () => this.close())
    this.root.appendChild(wrap)
  }

  pick(winner) {
    // Lockout so an enthusiastic double-tap can't blind-eliminate the next pair.
    if (this.locked) return
    this.locked = true
    setTimeout(() => { this.locked = false }, 350)
    this.pool = this.pool.slice(2)
    this.nextRound.push(winner)
    this.renderPair()
  }

  renderChampion(resto) {
    this.root.innerHTML = ''
    const h = new Date().getHours()
    // Open-now off = the user is planning ahead, not eating right now.
    const meal = !this.store.settings.openNowOnly
      ? 'Your next meal'
      : h < 5 ? 'Late-night craving' : h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : 'Dinner'
    const wrap = el(`
      <div class="faceoff show champion" role="dialog" aria-modal="true">
        <div class="confetti" aria-hidden="true">${'<i></i>'.repeat(24)}</div>
        <p class="champ-label">${meal}, decided.</p>
        <div class="champ-card-slot"></div>
        <div class="champ-actions">
          <a class="btn btn-accent" target="_blank" rel="noopener" href="${mapsUrl(resto)}">Take me there ↗</a>
          <button class="btn btn-ghost champ-done">Done</button>
        </div>
      </div>
    `)
    const slot = wrap.querySelector('.champ-card-slot')
    const card = renderMiniCard(resto, this.distanceTo(resto))
    card.classList.add('champ-card')
    slot.appendChild(card)
    card.addEventListener('click', () => {})
    wrap.querySelector('.champ-done').addEventListener('click', () => this.close())
    this.root.appendChild(wrap)
  }

  close() {
    this.root.innerHTML = ''
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
