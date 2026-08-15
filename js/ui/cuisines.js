import { el, esc } from './cards.js'

// Tonight-only cuisine picker. Selections live in store.session — never
// persisted, never fed to the taste engine — because a craving is not a
// preference: wanting Thai tonight shouldn't rewrite your learned profile.
export class CuisineFilter {
  constructor({ root, store, deck, onChanged }) {
    this.root = root
    this.store = store
    this.deck = deck
    this.onChanged = onChanged
    this.openEl = null
  }

  get active() {
    return this.store.settings.cuisines || []
  }

  get isOpen() {
    return !!this.openEl
  }

  open() {
    this.close()
    const list = this.deck.cuisinesInRange()
    const sel = new Set(this.active)
    const node = el(`
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="Cuisine filter">
        <div class="sheet-backdrop"></div>
        <div class="sheet">
          <div class="sheet-grip" aria-hidden="true"></div>
          <h2 class="panel-title">Craving something?</h2>
          <p class="panel-sub">Filter the deck by cuisine — tonight only. It resets when you close the app and never changes your taste profile.</p>
          ${list.length
            ? `<div class="chip-row wrap cuisine-chips">${list
                .map(({ cuisine, n }) => `<button class="chip chip-btn ${sel.has(cuisine) ? 'on' : ''}" data-cuisine="${esc(cuisine)}">${esc(cuisine)} <em>${n}</em></button>`)
                .join('')}</div>`
            : `<p class="panel-sub">No spots in range yet — set a location or widen the radius first.</p>`}
          <div class="panel-actions">
            <button class="btn btn-ghost btn-clear">Clear</button>
            <button class="btn btn-accent btn-done">Done</button>
          </div>
        </div>
      </div>
    `)
    node.querySelectorAll('[data-cuisine]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = b.dataset.cuisine
        sel.has(c) ? sel.delete(c) : sel.add(c)
        b.classList.toggle('on', sel.has(c))
      })
    )
    node.querySelector('.btn-clear').addEventListener('click', () => {
      sel.clear()
      node.querySelectorAll('[data-cuisine]').forEach((b) => b.classList.remove('on'))
    })
    const apply = () => {
      if (sel.size) this.store.setSessionSetting('cuisines', [...sel])
      else this.store.clearSessionSetting('cuisines')
      this.close()
      this.onChanged?.()
    }
    node.querySelector('.btn-done').addEventListener('click', apply)
    node.querySelector('.sheet-backdrop').addEventListener('click', apply)
    this.root.appendChild(node)
    this.openEl = node
    requestAnimationFrame(() => node.classList.add('show'))
  }

  close() {
    const node = this.openEl
    if (!node) return
    this.openEl = null
    node.classList.remove('show')
    node.classList.add('closing')
    setTimeout(() => node.remove(), 280)
  }
}
