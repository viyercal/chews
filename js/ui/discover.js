import { renderCard } from './cards.js'
import { SwipeController } from './swipe.js'
import { toast } from './toast.js'
import { el } from './cards.js'
import { milesBetween } from '../core/geo.js'
import { CONFIG } from '../config.js'

// The deck screen: owns the card queue, swipe wiring, action buttons, and
// the empty state. Ranking/persistence live in Deck/TasteEngine.
export class DiscoverView {
  constructor({ stackEl, actionsEl, deck, store, sheet, onSwiped }) {
    this.stackEl = stackEl
    this.deck = deck
    this.store = store
    this.sheet = sheet
    this.onSwiped = onSwiped
    this.queue = []
    this.controller = null

    actionsEl.querySelector('#btn-undo').addEventListener('click', () => this.undo())
    actionsEl.querySelector('#btn-pass').addEventListener('click', () => this.controller?.fling(-1))
    actionsEl.querySelector('#btn-yum').addEventListener('click', () => this.controller?.fling(1))
  }

  refresh() {
    this.queue = this.deck.build(this.store.settings.mode)
    this.render()
  }

  // Partial-coverage notice for out-of-coverage rescue pulls: honest about the
  // free-tier cap and the missing dish layer on live cards. Dismiss lasts the
  // session — it returns next visit if they're still outside coverage.
  showLiveNotice() {
    if (this.noticeDismissed || this.stackEl.parentElement.querySelector('.live-banner')) return
    const b = el(`
      <div class="live-banner">
        <span>⚡ Partial results — you're outside Chews' researched cities, so nearby spots were pulled live from Google. Full coverage here is beyond the free tier, and 🔎 live cards don't have researched dish picks.</span>
        <button class="icon-btn" aria-label="Dismiss">✕</button>
      </div>
    `)
    b.querySelector('button').addEventListener('click', () => {
      this.noticeDismissed = true
      b.remove()
    })
    this.stackEl.parentElement.insertBefore(b, this.stackEl)
  }

  top() {
    return this.queue[0] || null
  }

  render() {
    this.controller?.destroy()
    this.controller = null
    // Spare .ghost cards (mid-fling visuals) — they clean themselves up.
    for (const child of [...this.stackEl.children]) {
      if (!child.classList.contains('ghost')) child.remove()
    }

    if (!this.queue.length) {
      this.renderEmpty()
      return
    }

    const visible = this.queue.slice(0, 3)
    for (let i = visible.length - 1; i >= 0; i--) {
      const { resto, distanceMi } = visible[i]
      const card = renderCard(resto, distanceMi)
      card.classList.add(`depth-${i}`)
      this.stackEl.appendChild(card)
      if (i === 0) {
        this.controller = new SwipeController(card, {
          onLeft: () => this.commit(-1),
          onRight: () => this.commit(1),
          onTap: () => this.openSheet(),
        })
      }
    }

    if (this.deck.engine.total === 0 && !this.stackEl.querySelector('.swipe-hints')) {
      this.stackEl.appendChild(
        el(`<div class="swipe-hints" aria-hidden="true"><span class="hint hint-pass">← pass</span><span class="hint hint-yum">yum →</span></div>`)
      )
    }
  }

  openSheet() {
    const top = this.top()
    if (!top) return
    this.sheet.open(top.resto, {
      distanceMi: top.distanceMi,
      actions: [
        { label: '✕ Pass', className: 'btn-pass', onClick: () => this.controller?.fling(-1) },
        { label: '♥ Yum', className: 'btn-yum', onClick: () => this.controller?.fling(1) },
      ],
    })
  }

  commit(dir) {
    const top = this.queue.shift()
    if (!top) return
    const flying = this.stackEl.querySelector('.depth-0')
    if (flying) {
      flying.classList.add('ghost')
      flying.classList.remove('depth-0')
      setTimeout(() => flying.remove(), 600)
    }
    this.deck.swipe(top.resto, dir)
    if (dir > 0) {
      toast(`♥ ${top.resto.name} saved to Matches`)
      if (top.resto.live) this.store.cacheLive(top.resto) // matches must survive reloads
    }
    // Re-rank after every swipe so learning is visible in-session — but pin the
    // two cards the user can already see peeking, so rebuilds never visibly
    // reshuffle the stack, and seed the diversity guard across the boundary.
    this.queue = this.deck.build(this.store.settings.mode, Date.now(), { pin: this.queue.slice(0, 2) })
    this.render()
    this.onSwiped?.(dir, top.resto)
  }

  undo() {
    const resto = this.deck.undo()
    if (!resto) {
      toast('Nothing to undo')
      return
    }
    const loc = this.store.settings.location
    this.queue.unshift({ resto, distanceMi: loc ? milesBetween(loc, resto) : 0 })
    this.render()
    this.onSwiped?.(0, resto)
  }

  renderEmpty() {
    const { radiusMi, mode } = this.store.settings
    const canWiden = radiusMi < CONFIG.radius.max
    const hiddenByFilters = this.deck.unfilteredCount() > 0
    const panel = el(`
      <div class="empty-panel">
        <div class="empty-emoji" aria-hidden="true">${hiddenByFilters ? '🌙' : '🥡'}</div>
        <h2>${hiddenByFilters ? 'Your filters ate the deck' : `That's everything within ${radiusMi} mi`}</h2>
        <p>${
          hiddenByFilters
            ? 'There are spots in range, but they’re hidden by open-now, price, veg, rating, review, or cuisine filters right now.'
            : (mode === 'new' ? 'You’ve explored every new spot in range.' : 'You’ve swiped the whole neighborhood.') +
              ` Widen the radius or check back — passes quietly return after ${CONFIG.resurfaceDays} days.`
        }</p>
        <div class="empty-actions"></div>
      </div>
    `)
    const actions = panel.querySelector('.empty-actions')
    if ((this.store.settings.cuisines || []).length) {
      const clear = el('<button class="btn btn-accent">Clear cuisine filter</button>')
      clear.addEventListener('click', () => {
        this.store.clearSessionSetting('cuisines')
        this.onCuisineCleared?.()
        this.refresh()
      })
      actions.appendChild(clear)
    }
    if (hiddenByFilters) {
      const loosen = el('<button class="btn btn-accent">Adjust filters</button>')
      loosen.addEventListener('click', () => this.onOpenFilters?.())
      actions.appendChild(loosen)
    }
    if (canWiden) {
      const widen = el(`<button class="btn btn-accent">Widen to ${Math.min(CONFIG.radius.max, radiusMi + 5)} mi</button>`)
      widen.addEventListener('click', () => {
        this.store.setSetting('radiusMi', Math.min(CONFIG.radius.max, radiusMi + 5))
        this.refresh()
      })
      actions.appendChild(widen)
    }
    const other = el(`<button class="btn btn-ghost">${mode === 'new' ? 'Back to For You' : 'Try Something New'}</button>`)
    other.addEventListener('click', () => {
      this.store.setSetting('mode', mode === 'new' ? 'forYou' : 'new')
      this.onModeChanged?.()
      this.refresh()
    })
    actions.appendChild(other)
    this.stackEl.appendChild(panel)
  }
}
