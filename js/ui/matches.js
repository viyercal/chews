import { el, esc, cuisineGradient } from './cards.js'
import { fmtMiles, milesBetween } from '../core/geo.js'
import { duoLink } from '../core/duo.js'
import { toast } from './toast.js'

// Matches tab: Saved (right-swipes, recent first) and Regulars (places marked
// "ate here", by visit count; hideable — hiding also un-teaches the taste
// model everything those meals taught it) — plus the Face-off entry point.
export class MatchesView {
  constructor({ root, store, byId, sheet, faceoff, deck, onChanged }) {
    this.root = root
    this.store = store
    this.byId = byId
    this.deck = deck
    this.sheet = sheet
    this.faceoff = faceoff
    this.onChanged = onChanged
    this.segment = 'saved'
    this.pendingVerdictId = null // row awaiting a 🔥/fine/miss tap
  }

  distanceTo(resto) {
    const loc = this.store.settings.location
    return loc ? milesBetween(loc, resto) : null
  }

  savedList() {
    return this.store.matches.map((id) => this.byId[id]).filter(Boolean)
  }

  regularsList() {
    return Object.entries(this.store.visits)
      .map(([id, v]) => ({ resto: this.byId[id], v }))
      .filter((x) => x.resto && !x.v.hidden)
      .sort((a, b) => b.v.count - a.v.count || b.v.lastAt - a.v.lastAt)
  }

  render() {
    const saved = this.savedList()
    const regulars = this.regularsList()
    this.root.innerHTML = ''

    const header = el(`
      <div class="list-header">
        <div class="segment small" role="tablist">
          <button role="tab" data-seg="saved" aria-selected="${this.segment === 'saved'}">Saved · ${saved.length}</button>
          <button role="tab" data-seg="regulars" aria-selected="${this.segment === 'regulars'}">Regulars · ${regulars.length}</button>
        </div>
        <span class="header-btns">
          <button class="btn btn-ghost btn-duo" ${saved.length < 2 ? 'disabled' : ''} title="Send your shortlist to someone">💞 Together</button>
          <button class="btn btn-accent btn-faceoff" ${saved.length < 2 ? 'disabled' : ''}>⚡ Face-off</button>
        </span>
      </div>
    `)
    header.querySelector('.btn-duo').addEventListener('click', async () => {
      const link = duoLink({ ids: this.store.matches, loc: this.store.settings.location })
      if (!link) {
        toast('Need at least 2 saved (non-live) spots to send')
        return
      }
      const msg = 'Help me pick where we eat 💞 — swipe my shortlist:'
      try {
        if (navigator.share) await navigator.share({ title: 'Chews — decide together', text: msg, url: link })
        else {
          await navigator.clipboard.writeText(`${msg} ${link}`)
          toast('Link copied — send it to your dinner partner')
        }
      } catch {} // share sheet dismissed — no-op
    })
    header.querySelectorAll('[data-seg]').forEach((b) =>
      b.addEventListener('click', () => {
        this.segment = b.dataset.seg
        this.render()
      })
    )
    header.querySelector('.btn-faceoff').addEventListener('click', () => {
      this.faceoff.start(saved.slice(0, 8))
    })
    this.root.appendChild(header)

    if (this.segment === 'saved') this.renderSaved(saved)
    else this.renderRegulars(regulars)
  }

  renderSaved(saved) {
    if (!saved.length) {
      this.root.appendChild(
        el(`<div class="list-empty"><span aria-hidden="true">🫙</span><p>No matches yet. Swipe right on anything that makes you hungry.</p></div>`)
      )
      return
    }
    const ul = el('<ul class="match-list"></ul>')
    for (const resto of saved) ul.appendChild(this.row(resto, { removable: true }))
    this.root.appendChild(ul)
  }

  renderRegulars(regulars) {
    if (!regulars.length) {
      this.root.appendChild(
        el(`<div class="list-empty"><span aria-hidden="true">🍽️</span><p>Nothing here yet. After you actually eat somewhere, tap “Ate here” — your regulars build up over time.</p></div>`)
      )
      return
    }
    const ul = el('<ul class="match-list"></ul>')
    for (const { resto, v } of regulars) ul.appendChild(this.row(resto, { visits: v.count, hideable: true }))
    this.root.appendChild(ul)
  }

  row(resto, { removable = false, hideable = false, visits = 0 } = {}) {
    const [g1, g2] = cuisineGradient(resto.cuisine)
    const d = this.distanceTo(resto)
    const lastVerdict = this.store.visits[resto.id]?.lastVerdict
    const pending = this.pendingVerdictId === resto.id
    const li = el(`
      <li class="match-row ${pending ? 'asking' : ''}">
        <button class="match-main">
          <span class="match-emoji" style="--g1:${g1};--g2:${g2}" aria-hidden="true">${esc(resto.emoji || '🍽️')}</span>
          <span class="match-body">
            <span class="match-name">${esc(resto.name)}${visits ? ` <em class="visit-badge">×${visits}</em>` : ''}${lastVerdict === 'fire' ? ' <em class="verdict-badge">🔥</em>' : ''}</span>
            <span class="match-dish">${esc(resto.signatureDish?.name || '')}</span>
            <span class="match-meta">${esc(resto.cuisine)} · ★ ${Number(resto.rating).toFixed(1)}${d != null ? ` · ${esc(fmtMiles(d))}` : ''}</span>
          </span>
        </button>
        ${pending
          ? `<span class="verdict-ask">
               <span class="verdict-q">How was it?</span>
               <button class="chip chip-btn" data-v="fire">🔥</button>
               <button class="chip chip-btn" data-v="fine">fine</button>
               <button class="chip chip-btn" data-v="miss">miss</button>
               <button class="icon-btn" data-v="skip" title="Skip">✕</button>
             </span>`
          : `<span class="match-actions">
               <button class="icon-btn" data-act="ate" title="Ate here">🍽️</button>
               ${removable ? '<button class="icon-btn" data-act="remove" title="Remove">✕</button>' : ''}
               ${hideable ? '<button class="icon-btn" data-act="hide" title="Hide — stops shaping your deck">✕</button>' : ''}
             </span>`}
      </li>
    `)
    li.querySelector('.match-main').addEventListener('click', () => this.openSheet(resto))
    li.querySelectorAll('[data-v]').forEach((b) =>
      b.addEventListener('click', () => this.giveVerdict(resto, b.dataset.v))
    )
    li.querySelector('[data-act="ate"]')?.addEventListener('click', () => this.markAte(resto))
    li.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
      this.deck.removeMatch(resto.id) // full un-swipe: store + engine + undo history
      toast(`Removed ${resto.name}`)
      this.render()
      this.onChanged?.()
    })
    li.querySelector('[data-act="hide"]')?.addEventListener('click', () => {
      this.deck.hideRegular(resto.id) // drops its meal evidence from the taste model
      toast(`Hidden — ${resto.name} won't sway your deck`)
      this.render()
      this.onChanged?.()
    })
    return li
  }

  markAte(resto) {
    this.store.markVisited(resto.id)
    this.pendingVerdictId = resto.id // ask for the outcome — the signal that matters
    this.render()
    this.onChanged?.()
  }

  giveVerdict(resto, verdict) {
    this.pendingVerdictId = null
    if (verdict !== 'skip') {
      this.deck.recordMeal(resto, verdict)
      this.store.setVisitVerdict(resto.id, verdict)
      toast(
        verdict === 'fire' ? `🔥 Noted — more like ${resto.name} coming` :
        verdict === 'miss' ? `Got it — steering away from that` :
        `Noted`
      )
    } else {
      const n = this.store.visits[resto.id].count
      toast(n > 1 ? `${resto.name} — visit #${n}` : `Noted — you ate at ${resto.name}`)
    }
    this.render()
    this.onChanged?.()
  }

  openSheet(resto) {
    this.sheet.open(resto, {
      distanceMi: this.distanceTo(resto),
      // Sheet closes on action; the verdict ask appears on the row beneath.
      actions: [{ label: '🍽️ Ate here', className: 'btn-yum', onClick: () => this.markAte(resto) }],
    })
  }
}
