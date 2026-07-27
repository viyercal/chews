import { el, esc } from './cards.js'
import { locate, locateFailureCopy, nearestSpot, FALLBACK_SPOTS } from '../core/geo.js'
import { geocodeAddress, liveSearch } from '../core/live.js'
import { CONFIG } from '../config.js'
import { toast } from './toast.js'

// Taste tab: who the app thinks you are (confidence meter + cuisine affinity
// bars + top tags), plus location, radius, stats, and reset.
export class ProfileView {
  constructor({ root, store, engine, deck, dataMeta, onSettingsChanged, onReset }) {
    this.root = root
    this.store = store
    this.engine = engine
    this.deck = deck
    this.dataMeta = dataMeta
    this.onSettingsChanged = onSettingsChanged
    this.onReset = onReset
    this.resetArmed = false
  }

  render() {
    const s = this.store.settings
    const p = this.engine.profile()
    this.root.innerHTML = ''

    this.root.appendChild(this.tasteCard(p))
    this.root.appendChild(this.locationCard(s))
    this.root.appendChild(this.radiusCard(s))
    this.root.appendChild(this.byokCard(s))
    this.root.appendChild(this.statsCard(p))
    this.root.appendChild(this.footerCard())
  }

  async goToAddress(query) {
    const key = this.store.settings.byokKey || CONFIG.placesKey
    if (!key) {
      toast('Add a Google API key below to search any address')
      return
    }
    try {
      const loc = await geocodeAddress(query, key)
      this.store.setSetting('location', { lat: loc.lat, lng: loc.lng, source: 'manual', label: loc.label.slice(0, 28) })
      toast(`Exploring ${loc.label.slice(0, 32)}`)
      if (this.deck.inRadiusCount(this.store.settings.radiusMi) < 8) {
        toast('Thin coverage here — pulling live Google results…')
        const found = await liveSearch({ lat: loc.lat, lng: loc.lng, key, radiusMeters: Math.min(25, this.store.settings.radiusMi) * 1200 })
        const added = this.deck.addLive(found)
        toast(added ? `${added} live spots loaded` : 'No quality spots found nearby')
      }
      this.onSettingsChanged?.()
      this.render()
    } catch (e) {
      const cspBlocked = e instanceof TypeError
      toast(cspBlocked ? 'The hosted preview blocks outside calls — live search works when Chews runs at its own URL' : `Live search: ${e.message}`)
    }
  }

  byokCard(s) {
    const house = !!CONFIG.placesKey
    const card = el(`
      <section class="panel">
        <div class="panel-label">Live search${house ? '' : ' · bring your own key'}</div>
        ${house
          ? `<p class="panel-note">Address + live search are on the house — no key needed. Optionally use your own Google Places key instead (stored only on this device).</p>`
          : `<p class="panel-note">Chews can search any area live using your own Google Places API key. The key is stored only on this device and calls go straight from your browser to Google (you pay Google directly, ~3¢ per area search).</p>`}
        <p class="panel-note dim">Heads up: the hosted claude.ai preview blocks location and outside calls — GPS and live search work when Chews runs at its own URL (locally or deployed).</p>
        <div class="addr-row">
          <input type="password" autocomplete="off" placeholder="AIza…" value="${esc(s.byokKey || '')}" aria-label="Google Places API key">
          <button class="btn btn-ghost btn-key">${s.byokKey ? 'Update' : 'Save'}</button>
        </div>
        ${s.byokKey ? '<p class="panel-note dim">Key saved ✓ — address search is live. Clear it by saving an empty field.</p>' : ''}
      </section>
    `)
    card.querySelector('.btn-key').addEventListener('click', () => {
      const v = card.querySelector('input').value.trim()
      this.store.setSetting('byokKey', v)
      toast(v ? 'Key saved on this device' : 'Key cleared')
      this.render()
    })
    return card
  }

  tasteCard(p) {
    // Honest warmup target: never promise more swipes than exist in range.
    const inRange = this.deck.inRadiusCount(this.store.settings.radiusMi)
    const target = Math.max(1, Math.min(CONFIG.coldStart.fullConfidenceSwipes, inRange))
    const pct = Math.min(100, Math.round((p.total / target) * 100))
    const status =
      p.total === 0
        ? 'Blank slate — everything is on the table.'
        : inRange < 8
          ? 'Not many spots in range to learn from — widen your radius for a smarter deck.'
          : p.total < target
            ? `Warming up — preferences fade in as you swipe (${p.total}/${target}).`
            : 'Dialed in — your deck is personal now.'
    const card = el(`
      <section class="panel">
        <div class="panel-label">Taste profile</div>
        <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
        <p class="panel-note">${esc(status)}</p>
        <div class="bars"></div>
        <div class="tag-cloud"></div>
      </section>
    `)
    const bars = card.querySelector('.bars')
    const rows = p.rows.filter((r) => r.n >= 1).slice(0, 8)
    if (rows.length) {
      for (const r of rows) {
        bars.appendChild(
          el(`
          <div class="bar-row">
            <span class="bar-label">${esc(r.cuisine)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${Math.round(r.affinity * 100)}%"></span></span>
            <span class="bar-value">${Math.round(r.affinity * 100)}<em>·${r.n}</em></span>
          </div>`)
        )
      }
    } else {
      bars.appendChild(el('<p class="panel-note dim">Swipe a little and your cuisine chart shows up here.</p>'))
    }
    const tags = card.querySelector('.tag-cloud')
    for (const t of p.topTags) tags.appendChild(el(`<span class="chip chip-tag">${esc(t.tag)}</span>`))
    return card
  }

  locationCard(s) {
    const label = s.location ? (s.location.source === 'gps' ? 'Using your location' : s.location.label || 'Manual spot') : 'No location set'
    const card = el(`
      <section class="panel">
        <div class="panel-label">Location</div>
        <p class="panel-note">${esc(label)}</p>
        <div class="chip-row wrap">
          <button class="chip chip-btn" data-loc="gps">📍 Use my location</button>
          ${FALLBACK_SPOTS.map((f) => `<button class="chip chip-btn" data-spot="${esc(f.name)}">${esc(f.name)}</button>`).join('')}
        </div>
        <div class="addr-row">
          <input type="text" class="addr-input" placeholder="Or search any address or city…" aria-label="Search address">
          <button class="btn btn-ghost btn-addr">Go</button>
        </div>
      </section>
    `)
    const addrInput = card.querySelector('.addr-input')
    const go = () => addrInput.value.trim() && this.goToAddress(addrInput.value.trim())
    card.querySelector('.btn-addr').addEventListener('click', go)
    addrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    card.querySelector('[data-loc="gps"]').addEventListener('click', async () => {
      try {
        const loc = await locate()
        const { spot, miles } = nearestSpot(loc)
        if (miles > 40) {
          this.store.setSetting('location', { ...spot, source: 'manual', label: `${spot.name} (demo)` })
          toast(`You're outside the Bay Area dataset — exploring ${spot.name}`)
        } else {
          this.store.setSetting('location', { ...loc, label: 'Near you' })
          toast('Location updated')
        }
      } catch (e) {
        toast(locateFailureCopy(e?.reason))
      }
      this.onSettingsChanged?.()
      this.render()
    })
    card.querySelectorAll('[data-spot]').forEach((b) =>
      b.addEventListener('click', () => {
        const f = FALLBACK_SPOTS.find((x) => x.name === b.dataset.spot)
        this.store.setSetting('location', { lat: f.lat, lng: f.lng, source: 'manual', label: f.name })
        toast(`Exploring ${f.name}`)
        this.onSettingsChanged?.()
        this.render()
      })
    )
    return card
  }

  radiusCard(s) {
    const count = this.deck.inRadiusCount(s.radiusMi)
    const card = el(`
      <section class="panel">
        <div class="panel-label">Filters</div>
        <div class="radius-row">
          <input type="range" min="${CONFIG.radius.min}" max="${CONFIG.radius.max}" step="1" value="${s.radiusMi}" aria-label="Search radius in miles">
          <span class="radius-value">${s.radiusMi} mi</span>
        </div>
        <p class="panel-note radius-count">${count} restaurants in range</p>
        <div class="chip-row">
          ${[2, 5, 10, 25].map((m) => `<button class="chip chip-btn ${m === s.radiusMi ? 'on' : ''}" data-mi="${m}">${m} mi</button>`).join('')}
        </div>
        <div class="filter-caption">Price up to</div>
        <div class="chip-row">
          <button class="chip chip-btn ${!s.maxPrice ? 'on' : ''}" data-price="0">Any</button>
          ${[1, 2, 3, 4].map((n) => `<button class="chip chip-btn ${s.maxPrice === n ? 'on' : ''}" data-price="${n}">${'$'.repeat(n)}</button>`).join('')}
        </div>
        <div class="chip-row">
          <button class="chip chip-btn ${s.openNowOnly ? 'on' : ''}" data-toggle="openNowOnly">● Open now only</button>
          <button class="chip chip-btn ${s.vegOnly ? 'on' : ''}" data-toggle="vegOnly">🌿 Places with veg options</button>
        </div>
      </section>
    `)
    const slider = card.querySelector('input')
    const value = card.querySelector('.radius-value')
    const note = card.querySelector('.radius-count')
    const apply = (mi) => {
      this.store.setSetting('radiusMi', mi)
      value.textContent = `${mi} mi`
      note.textContent = `${this.deck.inRadiusCount(mi)} restaurants in range`
      this.onSettingsChanged?.()
    }
    slider.addEventListener('input', () => apply(Number(slider.value)))
    card.querySelectorAll('[data-mi]').forEach((b) =>
      b.addEventListener('click', () => {
        slider.value = b.dataset.mi
        apply(Number(b.dataset.mi))
        this.render()
      })
    )
    card.querySelectorAll('[data-price]').forEach((b) =>
      b.addEventListener('click', () => {
        this.store.setSetting('maxPrice', Number(b.dataset.price))
        this.onSettingsChanged?.()
        this.render()
      })
    )
    card.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle
        this.store.setSetting(k, !this.store.settings[k])
        this.onSettingsChanged?.()
        this.render()
      })
    )
    return card
  }

  statsCard(p) {
    const matches = this.store.matches.length
    const visits = Object.values(this.store.visits).reduce((n, v) => n + v.count, 0)
    const card = el(`
      <section class="panel">
        <div class="panel-label">Stats</div>
        <div class="stat-row">
          <div class="stat"><span class="stat-num">${p.total}</span><span class="stat-name">swipes</span></div>
          <div class="stat"><span class="stat-num">${matches}</span><span class="stat-name">matches</span></div>
          <div class="stat"><span class="stat-num">${visits}</span><span class="stat-name">meals</span></div>
        </div>
        <button class="btn btn-danger btn-reset">Reset everything</button>
      </section>
    `)
    const btn = card.querySelector('.btn-reset')
    btn.addEventListener('click', () => {
      if (!this.resetArmed) {
        this.resetArmed = true
        btn.textContent = 'Tap again to confirm reset'
        setTimeout(() => {
          this.resetArmed = false
          btn.textContent = 'Reset everything'
        }, 2500)
        return
      }
      this.resetArmed = false
      this.onReset?.()
    })
    return card
  }

  footerCard() {
    const m = this.dataMeta
    return el(`
      <p class="data-footer">${m.count} ${esc(m.city)} restaurants · dishes researched ${esc(m.generatedAt)} · refreshed every ${m.refreshMonths} months</p>
    `)
  }
}
