import { el, esc, cuisineGradient, openStatus } from './cards.js'
import { fmtMiles, milesBetween } from '../core/geo.js'
import { buildSearchIndex, search } from '../core/search.js'
import { hoursStatus } from '../core/hours.js'
import { whenChips } from './when.js'
import { toast } from './toast.js'

const MAX_RESULTS = 20

// Search overlay: dishes, restaurant names, cuisines, tags — the whole index,
// not just what's in radius (distance shown so far-away hits are obvious).
// Results honor the time frame (open now / a picked day + time / any time):
// closed-then spots are held back behind a "show N closed" line so a
// Saturday-brunch search returns places actually open Saturday morning.
// Tapping a result opens the standard sheet; fresh spots get Pass/Yum there.
export class SearchView {
  constructor({ root, deck, store, sheet, whenPicker, onSwiped }) {
    this.root = root
    this.deck = deck
    this.store = store
    this.sheet = sheet
    this.whenPicker = whenPicker
    this.onSwiped = onSwiped
    this.index = null
    this.openEl = null
    this.showClosed = false
  }

  get isOpen() {
    return !!this.openEl
  }

  open() {
    this.close()
    this.index ||= buildSearchIndex(this.deck.restaurants)
    const node = el(`
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="Search">
        <div class="sheet-backdrop"></div>
        <div class="sheet search-sheet">
          <div class="sheet-grip" aria-hidden="true"></div>
          <input class="search-input" type="search" placeholder="Dish, restaurant, cuisine…" autocomplete="off" spellcheck="false" enterkeyhint="search" />
          <div class="search-when"></div>
          <ul class="search-results"></ul>
          <p class="search-hint">Try “birria”, “spicy noodles”, or a restaurant name.</p>
        </div>
      </div>
    `)
    const input = node.querySelector('.search-input')
    const list = node.querySelector('.search-results')
    const hint = node.querySelector('.search-hint')
    this.showClosed = false
    node.querySelector('.search-when').appendChild(whenChips({ store: this.store, picker: this.whenPicker }))
    input.addEventListener('input', () => this.renderResults(list, hint, input.value))
    node.querySelector('.sheet-backdrop').addEventListener('click', () => this.close())
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
    this.root.appendChild(node)
    this.openEl = node
    requestAnimationFrame(() => {
      node.classList.add('show')
      input.focus()
    })
  }

  // The time frame changed (picker or inline chips): repaint chips + results.
  refreshWhen() {
    const node = this.openEl
    if (!node) return
    const slot = node.querySelector('.search-when')
    slot.innerHTML = ''
    slot.appendChild(whenChips({ store: this.store, picker: this.whenPicker }))
    this.showClosed = false
    this.renderResults(node.querySelector('.search-results'), node.querySelector('.search-hint'), node.querySelector('.search-input').value)
  }

  renderResults(list, hint, query) {
    list.innerHTML = ''
    // Over-fetch so the time-frame cut still yields a full page of open spots.
    const all = search(this.index, query, { limit: MAX_RESULTS * 3 })
    const when = this.deck.when()
    const isClosed = (r) => when.filtering && hoursStatus(r, when.date).status === 'closed'
    const open = all.filter((h) => !isClosed(h.resto)).slice(0, MAX_RESULTS)
    const closed = all.filter((h) => isClosed(h.resto)).slice(0, MAX_RESULTS)
    const hits = this.showClosed ? [...open, ...closed] : open
    hint.classList.toggle('hidden', !!hits.length)
    if (!hits.length && query.trim()) {
      hint.textContent = closed.length
        ? `Everything matching is closed ${when.mode === 'at' ? when.label : 'right now'} — show it anyway or change the time frame above.`
        : 'Nothing matches that — try a dish, cuisine, or spot name.'
    }
    const loc = this.store.settings.location
    const rows = hits.map((h) => ({ ...h, d: loc ? milesBetween(loc, h.resto) : null, closed: isClosed(h.resto) }))
    // Relevance decides in ~1-point bands; within a band, distance breaks the
    // tie so the Dublin sushi bar outranks an equally-matched one 30 mi away.
    // Closed-then spots (when revealed) always trail the open ones.
    const band = (s) => Math.round(s)
    rows.sort((a, b) => a.closed - b.closed || band(b.score) - band(a.score) || (a.d ?? 1e9) - (b.d ?? 1e9))
    for (const { resto, d, closed: c } of rows) list.appendChild(this.row(resto, d, when, c))
    if (closed.length) {
      const label = when.mode === 'at' ? when.label : 'right now'
      const btn = el(`<li class="search-closed"><button class="chip chip-btn">${this.showClosed ? 'Hide' : 'Show'} ${closed.length} closed ${esc(label)}</button></li>`)
      btn.querySelector('button').addEventListener('click', () => {
        this.showClosed = !this.showClosed
        this.renderResults(list, hint, query)
      })
      list.appendChild(btn)
    }
  }

  row(resto, d, when, closed = false) {
    const [g1, g2] = cuisineGradient(resto.cuisine)
    const status = this.deck.status(resto, Date.now())
    const hrs = openStatus(resto, when)
    const li = el(`
      <li class="match-row ${closed ? 'closed-then' : ''}">
        <button class="match-main">
          <span class="match-emoji" style="--g1:${g1};--g2:${g2}" aria-hidden="true">${esc(resto.emoji || '🍽️')}</span>
          <span class="match-body">
            <span class="match-name">${esc(resto.name)}${status === 'matched' ? ' <em class="result-status">♥ saved</em>' : ''}</span>
            <span class="match-dish">${esc(resto.signatureDish?.name || '')}</span>
            <span class="match-meta">${esc(resto.cuisine)} · ★ ${Number(resto.rating).toFixed(1)}${d != null ? ` · ${esc(fmtMiles(d))}` : ''}${resto.city ? ` · ${esc(resto.city)}` : ''}</span>
            <span class="match-meta result-hours ${hrs.cls}">${esc(hrs.text)}</span>
          </span>
        </button>
      </li>
    `)
    li.querySelector('.match-main').addEventListener('click', () => this.openResult(resto, d, status, when))
    return li
  }

  openResult(resto, distanceMi, status, when = this.deck.when()) {
    // Matched spots get no swipe actions (re-yumming would double-count taste
    // evidence); passed spots can be redeemed with a Yum, fresh get both.
    const actions =
      status === 'matched'
        ? []
        : [
            ...(status === 'fresh' ? [{ label: '✕ Pass', className: 'btn-pass', onClick: () => this.swipe(resto, -1) }] : []),
            { label: '♥ Yum', className: 'btn-yum', onClick: () => this.swipe(resto, 1) },
          ]
    this.sheet.open(resto, { distanceMi, actions, when })
  }

  swipe(resto, dir) {
    this.deck.swipe(resto, dir)
    if (dir > 0) toast(`♥ ${resto.name} saved to Matches`)
    this.onSwiped?.(dir, resto)
    // Refresh visible results so the row's saved-state updates in place.
    const node = this.openEl
    if (node) this.renderResults(node.querySelector('.search-results'), node.querySelector('.search-hint'), node.querySelector('.search-input').value)
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
