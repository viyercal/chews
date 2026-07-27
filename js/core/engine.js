import { CONFIG } from '../config.js'

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// Beta-posterior taste model over cuisines, dish tags, and price tiers.
// Pure and DOM-free; `rand` is injectable so tests are deterministic.
export class TasteEngine {
  constructor(rand = Math.random) {
    this.rand = rand
    this.cuisines = Object.create(null) // { [cuisine]: { likes, dislikes } }
    this.tags = Object.create(null)
    this.prices = Object.create(null)
    this.seeds = [] // cuisines explicitly picked at onboarding
    this.total = 0
    this.lastDecayAt = null
  }

  // Exponential evidence decay, applied lazily (at most hourly). Confidence
  // decays too: come back after a year away and the deck re-explores.
  _decayTo(now) {
    if (!this.lastDecayAt) { this.lastDecayAt = now; return }
    const dt = now - this.lastDecayAt
    if (dt < 3600 * 1000) return
    const f = 0.5 ** (dt / (CONFIG.decay.halfLifeDays * 86400 * 1000))
    for (const map of [this.cuisines, this.tags, this.prices]) {
      for (const [k, c] of Object.entries(map)) {
        c.likes *= f
        c.dislikes *= f
        if (c.likes + c.dislikes < 0.05) delete map[k]
      }
    }
    this.total *= f
    this.lastDecayAt = now
  }

  record(resto, dir, { weight = 1, at = Date.now() } = {}) {
    this._decayTo(at)
    const field = dir > 0 ? 'likes' : 'dislikes'
    const bump = (map, key) => {
      if (key == null) return
      const c = map[key] || (map[key] = { likes: 0, dislikes: 0 })
      c[field] += weight
    }
    bump(this.cuisines, resto.cuisine)
    for (const t of resto.tags || []) bump(this.tags, t)
    bump(this.prices, resto.price)
    this.total += weight
  }

  // Outcome signal: 🔥 loved it / fine / miss — weighted far above a swipe.
  recordMeal(resto, verdict, at = Date.now()) {
    const weight = CONFIG.meals[verdict] ?? CONFIG.meals.fine
    this.record(resto, verdict === 'miss' ? -1 : 1, { weight, at })
  }

  unrecord(resto, dir) {
    const field = dir > 0 ? 'likes' : 'dislikes'
    const drop = (map, key) => {
      const c = key != null && map[key]
      if (c && c[field] > 0) c[field] = Math.max(0, c[field] - 1)
      if (c && c.likes < 0.001 && c.dislikes < 0.001) delete map[key]
    }
    drop(this.cuisines, resto.cuisine)
    for (const t of resto.tags || []) drop(this.tags, t)
    drop(this.prices, resto.price)
    this.total = Math.max(0, this.total - 1)
  }

  // 0 at first launch -> 1 after fullConfidenceSwipes. Gates all personalization,
  // so early swipes can't lock a user into their first few cuisines.
  confidence() {
    return clamp01(this.total / CONFIG.coldStart.fullConfidenceSwipes)
  }

  // Explicit onboarding picks: a WEAK prior (2 likes each, small confidence
  // bump) — deliberately chosen, quickly outweighed by real swipes.
  seedCuisines(cuisines) {
    // 3 likes each: strong enough that an explicit pick beats the cold-start
    // exploration bonus, still buried by ~10 real dislikes.
    for (const c of cuisines) {
      const cur = this.cuisines[c] || (this.cuisines[c] = { likes: 0, dislikes: 0 })
      cur.likes += 3
      if (!this.seeds.includes(c)) this.seeds.push(c)
    }
    this.total += Math.min(9, cuisines.length * 3)
  }

  seen(cuisine) {
    const c = this.cuisines[cuisine]
    return c ? c.likes + c.dislikes : 0
  }

  affinity(cuisine) {
    const c = this.cuisines[cuisine] || { likes: 0, dislikes: 0 }
    return (c.likes + 1) / (c.likes + c.dislikes + 2) // Beta mean, neutral prior
  }

  // Thompson-style: posterior mean + uncertainty jitter that shrinks with evidence.
  sampleAffinity(cuisine) {
    const jitter = (this.rand() - 0.5) / Math.sqrt(this.seen(cuisine) + 2)
    return clamp01(this.affinity(cuisine) + jitter)
  }

  // Evidence-weighted mean affinity over a restaurant's tags. Lets taste learned in
  // one cuisine (spicy, noodles, seafood...) transfer to cuisines never swiped on.
  tagAffinity(resto) {
    let num = 0
    let den = 0
    for (const t of resto.tags || []) {
      const c = this.tags[t]
      if (!c) continue
      const n = c.likes + c.dislikes
      const w = n / (n + 3)
      num += w * ((c.likes + 1) / (n + 2))
      den += w
    }
    return den > 0 ? num / den : 0.5
  }

  novelty(cuisine) {
    return 1 / Math.sqrt(1 + this.seen(cuisine))
  }

  // Beta mean over price-tier swipes, blending adjacent tiers at 40% weight.
  priceAffinity(tier) {
    let likes = 0
    let dislikes = 0
    for (const [t, c] of Object.entries(this.prices)) {
      const gap = Math.abs(Number(t) - tier)
      const w = gap === 0 ? 1 : gap === 1 ? 0.4 : 0
      likes += w * c.likes
      dislikes += w * c.dislikes
    }
    return (likes + 1) / (likes + dislikes + 2)
  }

  // Consistently rejected cuisine (N dislikes, zero likes) → stop dealing it.
  avoids(cuisine) {
    const c = this.cuisines[cuisine]
    return !!c && c.likes === 0 && c.dislikes >= CONFIG.avoid.dislikes
  }

  score(resto, { distanceMi = 0, radiusMi = CONFIG.radius.default, mode = 'forYou' } = {}) {
    const W = CONFIG.weights
    const quality =
      clamp01((resto.rating - 3.6) / 1.4) *
      (0.7 + 0.3 * clamp01(Math.log10((resto.ratingCount || 10) + 1) / 3.5))
    // Wider radius = user has said distance matters less; decay softens with it.
    const proximity = Math.exp(-distanceMi / Math.max(4, radiusMi * 0.75))
    const base = W.quality * quality + W.proximity * proximity

    const conf = this.confidence()
    const cuisineTerm = conf * W.affinity * (this.sampleAffinity(resto.cuisine) * 2 - 1)
    const tagTerm = conf * W.tagTransfer * (this.tagAffinity(resto) * 2 - 1)
    const priceTerm = conf * W.price * (this.priceAffinity(resto.price) * 2 - 1)

    // Cold-start coverage: while the profile is unformed, nudge unexplored
    // cuisines up so the first sessions sample broadly instead of letting
    // quality-ranking cluster on a few cuisines.
    const coldExplore = (1 - conf) * 0.12 * this.novelty(resto.cuisine)

    if (mode === 'new') {
      // Soften ONLY cuisine affinity; tag and price taste transfer at full
      // strength — that's what makes Something New feel personal.
      return base + 0.5 * cuisineTerm + tagTerm + priceTerm + W.explore * this.novelty(resto.cuisine) + coldExplore
    }
    return base + cuisineTerm + tagTerm + priceTerm + coldExplore
  }

  profile() {
    const rows = Object.entries(this.cuisines)
      .map(([cuisine, c]) => ({
        cuisine,
        likes: c.likes,
        dislikes: c.dislikes,
        n: Math.round(c.likes + c.dislikes), // counters are decayed floats
        affinity: this.affinity(cuisine),
      }))
      .sort((a, b) => b.affinity - a.affinity || b.n - a.n || a.cuisine.localeCompare(b.cuisine))
    const topTags = Object.entries(this.tags)
      .map(([tag, c]) => ({
        tag,
        n: c.likes + c.dislikes,
        affinity: (c.likes + 1) / (c.likes + c.dislikes + 2),
      }))
      .filter((t) => t.n >= 2 && t.affinity > 0.55)
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, 6)
    // Display summary — counters are decayed floats internally; humans get integers.
    return { rows, topTags, total: Math.round(this.total), confidence: this.confidence() }
  }

  toJSON() {
    return { cuisines: this.cuisines, tags: this.tags, prices: this.prices, seeds: this.seeds, total: this.total, lastDecayAt: this.lastDecayAt }
  }

  static fromJSON(json, rand) {
    const e = new TasteEngine(rand)
    if (json) {
      e.cuisines = Object.assign(Object.create(null), json.cuisines)
      e.tags = Object.assign(Object.create(null), json.tags)
      e.prices = Object.assign(Object.create(null), json.prices)
      e.seeds = Array.isArray(json.seeds) ? json.seeds : []
      e.total = json.total || 0
      // Older profiles have no decay clock — treat their evidence as fresh.
      e.lastDecayAt = json.lastDecayAt || null
    }
    return e
  }
}
