import { el, esc } from './cards.js'
import { DAYS } from '../core/hours.js'
import { MEAL_TIMES, fmtTime, resolveWhen, roundedTime } from '../core/when.js'

// "When are you going?" picker: open now (default), a day + time, or any
// time. Now/any is a saved preference; a picked day + time lives in
// store.session only — plans for Saturday must not haunt Tuesday's deck.
export class WhenPicker {
  constructor({ root, store, deck, onChanged }) {
    this.root = root
    this.store = store
    this.deck = deck
    this.onChanged = onChanged
    this.openEl = null
  }

  get isOpen() {
    return !!this.openEl
  }

  // Direct setters for the inline chips (search sheet, Taste filters).
  setNow() { this.apply('now') }
  setAny() { this.apply('any') }

  apply(mode, at = null) {
    if (mode === 'at' && at) this.store.setSessionSetting('openAt', at)
    else {
      this.store.clearSessionSetting('openAt')
      this.store.setSetting('openNowOnly', mode === 'now')
    }
    this.onChanged?.()
  }

  open() {
    this.close()
    const now = new Date()
    const cur = resolveWhen(this.store.settings, now)
    const state = { mode: cur.mode, day: cur.day ?? now.getDay(), time: cur.time ?? roundedTime(now) }
    const today = now.getDay()
    const dayName = (d) => (d === today ? 'Today' : d === (today + 1) % 7 ? 'Tomorrow' : DAYS[d])
    const node = el(`
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="When are you going?">
        <div class="sheet-backdrop"></div>
        <div class="sheet">
          <div class="sheet-grip" aria-hidden="true"></div>
          <h2 class="panel-title">When are you going?</h2>
          <p class="panel-sub">Show what's open right now, at a day and time you pick, or everything regardless of hours.</p>
          <div class="segment small when-seg" role="tablist" aria-label="Time frame">
            <button role="tab" data-when="now">Open now</button>
            <button role="tab" data-when="at">Pick a time</button>
            <button role="tab" data-when="any">Any time</button>
          </div>
          <div class="when-at">
            <div class="filter-caption">Day</div>
            <div class="chip-row wrap when-days">
              ${[0, 1, 2, 3, 4, 5, 6].map((i) => (today + i) % 7).map((d) => `<button class="chip chip-btn" data-day="${d}">${esc(dayName(d))}</button>`).join('')}
            </div>
            <div class="filter-caption">Time</div>
            <div class="chip-row wrap when-times">
              ${MEAL_TIMES.map((m) => `<button class="chip chip-btn" data-time="${m.time}">${esc(m.label)} <em>${esc(fmtTime(m.time))}</em></button>`).join('')}
              <label class="chip chip-btn when-custom">Custom <input type="time" step="900" aria-label="Custom time"></label>
            </div>
            <p class="panel-note when-count"></p>
            <p class="panel-note dim">A picked time lasts this session only — next time you open Chews it's back to open now.</p>
          </div>
          <div class="panel-actions">
            <button class="btn btn-ghost btn-clear">Back to now</button>
            <button class="btn btn-accent btn-done">Done</button>
          </div>
        </div>
      </div>
    `)
    const atPanel = node.querySelector('.when-at')
    const count = node.querySelector('.when-count')
    const timeInput = node.querySelector('input[type="time"]')
    const paint = () => {
      node.querySelectorAll('[data-when]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.when === state.mode)))
      atPanel.classList.toggle('hidden', state.mode !== 'at')
      node.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', Number(b.dataset.day) === state.day))
      const preset = MEAL_TIMES.some((m) => m.time === state.time)
      node.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', b.dataset.time === state.time))
      node.querySelector('.when-custom').classList.toggle('on', !preset)
      timeInput.value = state.time
      if (state.mode === 'at') {
        const when = resolveWhen({ openAt: { day: state.day, time: state.time } }, now)
        const inRange = this.deck.inRadiusCount(this.store.settings.radiusMi)
        count.textContent = `${this.deck.openCount(when)} of ${inRange} spots in range are open ${when.label}`
      }
    }
    node.querySelectorAll('[data-when]').forEach((b) =>
      b.addEventListener('click', () => { state.mode = b.dataset.when; paint() })
    )
    node.querySelectorAll('[data-day]').forEach((b) =>
      b.addEventListener('click', () => { state.day = Number(b.dataset.day); paint() })
    )
    node.querySelectorAll('[data-time]').forEach((b) =>
      b.addEventListener('click', () => { state.time = b.dataset.time; paint() })
    )
    timeInput.addEventListener('input', () => {
      if (/^\d{2}:\d{2}$/.test(timeInput.value)) { state.time = timeInput.value; paint() }
    })
    const done = () => {
      this.close()
      this.apply(state.mode, state.mode === 'at' ? { day: state.day, time: state.time } : null)
    }
    node.querySelector('.btn-done').addEventListener('click', done)
    node.querySelector('.sheet-backdrop').addEventListener('click', done)
    node.querySelector('.btn-clear').addEventListener('click', () => { state.mode = 'now'; done() })
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') done() })
    paint()
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

// Inline three-way chips (Open now · picked time · Any time) that mirror the
// picker's state — dropped into the search sheet and the Taste filters so the
// time frame is one tap away wherever hours matter.
export function whenChips({ store, picker }) {
  const when = resolveWhen(store.settings)
  const row = el(`
    <div class="chip-row when-chips">
      <button class="chip chip-btn ${when.mode === 'now' ? 'on' : ''}" data-when="now">● Open now</button>
      <button class="chip chip-btn ${when.mode === 'at' ? 'on' : ''}" data-when="at">🕐 ${esc(when.mode === 'at' ? when.label : 'Pick a time')}</button>
      <button class="chip chip-btn ${when.mode === 'any' ? 'on' : ''}" data-when="any">Any time</button>
    </div>
  `)
  row.querySelector('[data-when="now"]').addEventListener('click', () => picker.setNow())
  row.querySelector('[data-when="any"]').addEventListener('click', () => picker.setAny())
  row.querySelector('[data-when="at"]').addEventListener('click', () => picker.open())
  return row
}

// Top-bar pill text: the default frame stays quiet; a plan or "any" lights up.
export function whenPillText(store) {
  const when = resolveWhen(store.settings)
  return when.mode === 'now' ? '● now' : when.mode === 'any' ? 'any time' : `🕐 ${when.label}`
}
