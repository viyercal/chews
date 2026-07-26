import { CONFIG } from '../config.js'

const DEFAULTS = () => ({
  settings: {
    radiusMi: CONFIG.radius.default,
    mode: 'forYou',           // 'forYou' | 'new'
    location: null,           // { lat, lng, source: 'gps' | 'manual', label? }
    onboarded: false,
    openNowOnly: true,        // hide places known to be closed right now
    maxPrice: 0,              // 0 = any; 1-4 caps the price level
    vegOnly: false,           // only vegetarian/vegan-friendly tagged places
    byokKey: '',              // user's own Places API key for live search (device-only)
  },
  swipes: {},                 // { [id]: { dir: 1|-1, at: epochMs } }
  matches: [],                // right-swiped ids, most recent first
  visits: {},                 // { [id]: { count, lastAt } }
  taste: null,                // TasteEngine.toJSON()
  liveCache: {},              // { [id]: restaurant } — matched live-search finds
})

// Sandboxed iframes / blocked-storage browsers throw on the mere *access* of
// localStorage — the app must still boot (in-memory) when that happens.
const safeStorage = () => {
  try { return globalThis.localStorage ?? null } catch { return null }
}

const asObj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null)

// Dumb persistence: owns the saved shape and localStorage, none of the ranking math.
export class Store {
  constructor(storage = safeStorage(), key = CONFIG.storageKey) {
    this.storage = storage
    this.key = key
    this.state = DEFAULTS()
    this.session = {} // non-persisted overrides (e.g. ?loc= QA links)
    this._t = null
    // Adopt other tabs' writes instead of clobbering them with our snapshot.
    try {
      globalThis.addEventListener?.('storage', (e) => {
        if (e.key === this.key && e.newValue) this.adopt(e.newValue)
      })
      const flushNow = () => this.flush()
      globalThis.addEventListener?.('pagehide', flushNow)
      globalThis.document?.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush()
      })
    } catch {}
  }

  hydrate(raw) {
    const d = DEFAULTS()
    const saved = asObj(JSON.parse(raw)) || {}
    // Deep-default every section so corrupt/legacy blobs can never brick boot.
    return {
      settings: { ...d.settings, ...(asObj(saved.settings) || {}) },
      swipes: asObj(saved.swipes) || d.swipes,
      matches: Array.isArray(saved.matches) ? saved.matches.filter((m) => typeof m === 'string') : d.matches,
      visits: asObj(saved.visits) || d.visits,
      taste: asObj(saved.taste) || d.taste,
      liveCache: asObj(saved.liveCache) || d.liveCache,
    }
  }

  cacheLive(resto) {
    this.state.liveCache[resto.id] = resto
    this.save()
  }

  load() {
    try {
      const raw = this.storage?.getItem(this.key)
      if (raw) this.state = this.hydrate(raw)
    } catch { this.state = DEFAULTS() }
    return this.state
  }

  adopt(raw) {
    try {
      const theirs = this.hydrate(raw)
      // Union the activity maps (their entries win only where we have none);
      // keep our settings — the active tab is the one being interacted with.
      this.state.swipes = { ...theirs.swipes, ...this.state.swipes }
      this.state.visits = { ...theirs.visits, ...this.state.visits }
      this.state.matches = [...new Set([...this.state.matches, ...theirs.matches])]
      if ((theirs.taste?.total || 0) > (this.state.taste?.total || 0)) this.state.taste = theirs.taste
    } catch {}
  }

  save() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.flush(), 120)
  }

  flush() {
    clearTimeout(this._t)
    try { this.storage?.setItem(this.key, JSON.stringify(this.state)) } catch {}
  }

  // Drop persisted ids that no longer exist after a dataset refresh.
  // Live-search finds are their own source of truth via liveCache.
  pruneTo(validIds) {
    const valid = (id) => validIds.has(id) || !!this.state.liveCache[id]
    let changed = false
    for (const id of Object.keys(this.state.swipes)) {
      if (!valid(id)) { delete this.state.swipes[id]; changed = true }
    }
    for (const id of Object.keys(this.state.visits)) {
      if (!valid(id)) { delete this.state.visits[id]; changed = true }
    }
    const m = this.state.matches.filter(valid)
    if (m.length !== this.state.matches.length) { this.state.matches = m; changed = true }
    if (changed) this.save()
  }

  get settings() { return { ...this.state.settings, ...this.session } }
  get swipes() { return this.state.swipes }
  get matches() { return this.state.matches }
  get visits() { return this.state.visits }

  setSetting(k, v) {
    delete this.session[k] // a real user choice beats any session override
    this.state.settings[k] = v
    this.save()
  }

  recordSwipe(id, dir, at = Date.now()) {
    const prev = this.state.swipes[id] || null
    this.state.swipes[id] = { dir, at }
    this.state.matches = this.state.matches.filter((m) => m !== id)
    if (dir > 0) this.state.matches.unshift(id)
    this.save()
    return prev
  }

  undoSwipe(id, prev) {
    if (prev) this.state.swipes[id] = prev
    else delete this.state.swipes[id]
    this.state.matches = this.state.matches.filter((m) => m !== id)
    if (prev && prev.dir > 0) this.state.matches.unshift(id)
    this.save()
  }

  markVisited(id, at = Date.now()) {
    const v = this.state.visits[id] || { count: 0, lastAt: 0 }
    this.state.visits[id] = { ...v, count: v.count + 1, lastAt: at }
    this.save()
  }

  setVisitVerdict(id, verdict) {
    if (!this.state.visits[id]) return
    this.state.visits[id].lastVerdict = verdict
    this.save()
  }

  removeMatch(id) {
    this.state.matches = this.state.matches.filter((m) => m !== id)
    delete this.state.swipes[id]
    this.save()
  }

  saveTaste(json) {
    this.state.taste = json
    this.save()
  }

  reset() {
    this.state = DEFAULTS()
    try { this.storage?.removeItem(this.key) } catch {}
  }
}
