import { el, esc, fmtCount, priceHtml, mapsUrl, cuisineGradient, openChip, vegChip } from './cards.js'
import { fmtMiles } from '../core/geo.js'
import { todayHours } from '../core/hours.js'
import { DATA_META } from '../data/restaurants.gen.js'

// Bottom sheet with the full menu card. `actions` customizes the button row so
// the same sheet serves the deck (pass/yum) and the matches list (ate here).
export class Sheet {
  constructor(root) {
    this.root = root
    this.openEl = null
  }

  open(resto, { distanceMi = null, actions = [] } = {}) {
    this.close()
    const [g1, g2] = cuisineGradient(resto.cuisine)
    const th = todayHours(resto)
    const menu = (resto.menu || [])
      .map(
        (m) => `
        <li class="menu-item">
          <div class="menu-line"><span class="menu-name">${esc(m.name)}</span><span class="menu-price">${esc(m.price || '')}</span></div>
          ${m.description ? `<p class="menu-desc">${esc(m.description)}</p>` : ''}
        </li>`
      )
      .join('')
    const node = el(`
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="${esc(resto.name)}">
        <div class="sheet-backdrop"></div>
        <div class="sheet" style="--g1:${g1};--g2:${g2}">
          <div class="sheet-grip" aria-hidden="true"></div>
          <div class="sheet-hero">
            <span class="sheet-emoji" aria-hidden="true">${esc(resto.emoji || '🍽️')}</span>
            <div>
              <h2 class="sheet-name">${esc(resto.name)}</h2>
              <p class="sheet-meta">${esc(resto.cuisine)} · ${priceHtml(resto.price)} · ★ ${Number(resto.rating).toFixed(1)} <em>(${fmtCount(resto.ratingCount)} reviews)</em>${distanceMi != null ? ` · ${esc(fmtMiles(distanceMi))}` : ''}</p>
            </div>
          </div>
          <div class="chip-row sheet-chips">${openChip(resto)}${vegChip(resto)}</div>
          ${th ? `<p class="sheet-hours">Today: ${esc(th)}</p>` : ''}
          ${resto.why ? `<p class="sheet-why">“${esc(resto.why)}”</p>` : ''}
          ${resto.live
            ? `<div class="sheet-section-label">🔎 Live Google result</div>
               <div class="sheet-sig">
                 <p class="menu-desc">${esc(resto.liveSummary || `A well-rated ${resto.cuisine.toLowerCase()} spot near your searched address.`)}</p>
                 <p class="menu-desc dim-note">Found live outside the curated index — dish picks aren't researched for this spot yet.</p>
               </div>`
            : `<div class="sheet-section-label">The one to order</div>
               <div class="sheet-sig">
                 <div class="menu-line"><span class="menu-name">${esc(resto.signatureDish?.name || '')}</span></div>
                 <p class="menu-desc">${esc(resto.signatureDish?.description || '')}</p>
               </div>
               ${menu ? `<div class="sheet-section-label">Also great</div><ul class="sheet-menu">${menu}</ul>` : ''}`}
          <p class="sheet-addr">${esc(resto.address)}${resto.neighborhood ? ` · ${esc(resto.neighborhood)}` : ''}</p>
          <p class="sheet-src">${DATA_META.verifiedAt
            ? `Rating, reviews, price &amp; hours: Google Maps · verified ${esc(DATA_META.verifiedAt)}`
            : `Researched ${esc(DATA_META.generatedAt)} · Google Maps verification pending`}</p>
          <div class="sheet-actions"></div>
        </div>
      </div>
    `)
    const actionRow = node.querySelector('.sheet-actions')
    actionRow.appendChild(
      el(`<a class="btn btn-ghost" target="_blank" rel="noopener" href="${mapsUrl(resto)}">Open in Maps ↗</a>`)
    )
    for (const a of actions) {
      const b = el(`<button class="btn ${a.className || ''}">${esc(a.label)}</button>`)
      b.addEventListener('click', () => {
        this.close()
        a.onClick?.()
      })
      actionRow.appendChild(b)
    }
    node.querySelector('.sheet-backdrop').addEventListener('click', () => this.close())
    this.root.appendChild(node)
    this.openEl = node
    requestAnimationFrame(() => node.classList.add('show'))
  }

  get isOpen() {
    return !!this.openEl
  }

  close() {
    const node = this.openEl
    if (!node) return
    this.openEl = null
    node.classList.remove('show')
    node.classList.add('closing') // backdrop stays a tap shield while animating out
    setTimeout(() => node.remove(), 280)
  }
}
