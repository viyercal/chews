import { CONFIG } from '../config.js'
import { milesBetween } from './geo.js'
import { hoursStatus } from './hours.js'

const DAY_MS = 86400000
const VEG_TAGS = ['vegetarian-friendly', 'vegan-friendly']

// Builds ranked card stacks from the dataset + store + engine. Pure given `now`.
export class Deck {
  constructor({ restaurants, store, engine }) {
    this.restaurants = restaurants
    this.store = store
    this.engine = engine
    this.history = [] // for undo: { resto, dir, prevSwipe }
  }

  // Session merge of BYOK live-search finds; dedupes by id.
  addLive(list) {
    const have = new Set(this.restaurants.map((r) => r.id))
    let added = 0
    for (const r of list) {
      if (!have.has(r.id)) { this.restaurants.push(r); have.add(r.id); added++ }
    }
    return added
  }

  status(resto, now) {
    const s = this.store.swipes[resto.id]
    if (!s) return 'fresh'
    if (s.dir > 0) return 'matched'
    return (now - s.at) / DAY_MS >= CONFIG.resurfaceDays ? 'fresh' : 'passed'
  }

  withDistance(location) {
    return this.restaurants.map((r) => ({
      resto: r,
      distanceMi: location ? milesBetween(location, r) : 0,
    }))
  }

  // The user-set filter chain, shared by the deck builder and the live
  // "N match your filters" note (which ignores swipe status).
  passesFilters(resto, distanceMi, date) {
    const { radiusMi, openNowOnly, maxPrice, vegOnly, cuisines, minRating, minReviews } = this.store.settings
    if (distanceMi > radiusMi) return false
    if (cuisines?.length && !cuisines.includes(resto.cuisine)) return false
    if (maxPrice && resto.price > maxPrice) return false
    if (minRating && resto.rating < minRating) return false
    if (minReviews && (resto.ratingCount || 0) < minReviews) return false
    if (vegOnly && !(resto.tags || []).some((t) => VEG_TAGS.includes(t))) return false
    if (openNowOnly && hoursStatus(resto, date).status === 'closed') return false
    return true
  }

  candidates(mode, now = Date.now(), { includeAvoided = false } = {}) {
    const { location } = this.store.settings
    const date = new Date(now)
    return this.withDistance(location).filter(({ resto, distanceMi }) => {
      if (!this.passesFilters(resto, distanceMi, date)) return false
      if (this.status(resto, now) !== 'fresh') return false
      const visit = this.store.visits[resto.id]
      if (mode === 'new' && visit && !visit.hidden) return false
      if (!includeAvoided && this.engine.avoids(resto.cuisine)) return false
      return true
    })
  }

  filteredCount(now = Date.now()) {
    const { location } = this.store.settings
    const date = new Date(now)
    return this.withDistance(location).filter(({ resto, distanceMi }) => this.passesFilters(resto, distanceMi, date)).length
  }

  // Candidates ignoring the user-set filters — used to explain empty decks.
  unfilteredCount(now = Date.now()) {
    const { location, radiusMi } = this.store.settings
    return this.withDistance(location).filter(
      ({ resto, distanceMi }) => distanceMi <= radiusMi && this.status(resto, now) === 'fresh'
    ).length
  }

  inRadiusCount(radiusMi) {
    const { location } = this.store.settings
    return this.withDistance(location).filter((c) => c.distanceMi <= radiusMi).length
  }

  // Cuisines available in range right now (fresh or not), with counts — feeds
  // the tonight-only cuisine picker so it never offers an empty filter.
  cuisinesInRange() {
    const { location, radiusMi } = this.store.settings
    const counts = {}
    for (const { resto, distanceMi } of this.withDistance(location)) {
      if (distanceMi <= radiusMi && resto.cuisine) counts[resto.cuisine] = (counts[resto.cuisine] || 0) + 1
    }
    return Object.entries(counts)
      .map(([cuisine, n]) => ({ cuisine, n }))
      .sort((a, b) => b.n - a.n || a.cuisine.localeCompare(b.cuisine))
  }

  // Cuisines of the most recently swiped cards — seeds the diversity guard
  // across queue rebuilds so runs can't span a rebuild boundary.
  recentCuisines(n = CONFIG.deck.maxSameCuisineRun) {
    return this.history.slice(-n).map((h) => h.resto.cuisine)
  }

  // `pin`: existing queue entries to keep at the front (the cards the user can
  // already see peeking) so a rebuild never visibly reshuffles them.
  build(mode, now = Date.now(), { pin = [] } = {}) {
    const { radiusMi } = this.store.settings
    const pinned = pin.filter((c) => this.status(c.resto, now) === 'fresh')
    const pinnedIds = new Set(pinned.map((c) => c.resto.id))
    let pool = this.candidates(mode, now)
    // Avoided cuisines are a demotion, not a wall: when nothing else is left,
    // deal them rather than dead-ending a deck with fresh spots in range.
    if (!pool.length && !pinned.length) pool = this.candidates(mode, now, { includeAvoided: true })
    const scored = pool
      .filter((c) => !pinnedIds.has(c.resto.id))
      .map((c) => ({ ...c, score: this.engine.score(c.resto, { distanceMi: c.distanceMi, radiusMi, mode }) }))
      .sort((a, b) => b.score - a.score)
    const seed = [...this.recentCuisines(), ...pinned.map((c) => c.resto.cuisine)]
    const assembled = [...pinned, ...diversify(scored, CONFIG.deck.maxSameCuisineRun, seed)]
    return this.showcaseSeeds(assembled).slice(0, CONFIG.deck.batchSize)
  }

  // A user who explicitly picked cuisines at onboarding must SEE one quickly:
  // if none of their seeds are in the first 5 cards while one exists in range,
  // promote the best-scoring seeded card. Early lifecycle only — real swipes
  // take over once the profile has data.
  showcaseSeeds(list) {
    const seeds = this.engine.seeds || []
    if (!seeds.length || this.engine.total >= 15) return list
    const window = Math.min(5, list.length)
    if (list.slice(0, window).some((c) => seeds.includes(c.resto.cuisine))) return list
    const idx = list.findIndex((c) => seeds.includes(c.resto.cuisine))
    if (idx < 0) return list
    const [item] = list.splice(idx, 1)
    list.splice(Math.min(2, list.length), 0, item)
    return list
  }

  // Hiding a regular strips its meal evidence from the taste model — Discover
  // stops chasing (or fleeing) a place the user disowned — and lets Something
  // New deal the place again. The swipe (Saved) is untouched.
  hideRegular(id, now = Date.now()) {
    const v = this.store.visits[id]
    if (!v || v.hidden) return
    const resto = this.restaurants.find((r) => r.id === id)
    if (resto) {
      // Legacy visits predate the per-meal log: reverse the one verdict we know.
      const log = v.log || (v.lastVerdict ? [{ v: v.lastVerdict, at: v.lastAt }] : [])
      for (const m of log) this.engine.unrecordMeal(resto, m.v, m.at, now)
      this.store.saveTaste(this.engine.toJSON())
    }
    this.store.hideVisit(id)
  }

  // Removing a match = full un-swipe: store, engine, and undo history move together.
  removeMatch(id) {
    const swipe = this.store.swipes[id]
    const resto = this.restaurants.find((r) => r.id === id)
    this.store.removeMatch(id)
    if (swipe && resto) {
      this.engine.unrecord(resto, swipe.dir)
      this.store.saveTaste(this.engine.toJSON())
    }
    this.history = this.history.filter((h) => h.resto.id !== id)
  }

  swipe(resto, dir, now = Date.now()) {
    const prevSwipe = this.store.recordSwipe(resto.id, dir, now)
    this.engine.record(resto, dir)
    this.store.saveTaste(this.engine.toJSON())
    this.history.push({ resto, dir, prevSwipe })
    if (this.history.length > 50) this.history.shift()
  }

  recordMeal(resto, verdict, at = Date.now()) {
    this.engine.recordMeal(resto, verdict, at)
    this.store.saveTaste(this.engine.toJSON())
  }

  undo() {
    const last = this.history.pop()
    if (!last) return null
    this.store.undoSwipe(last.resto.id, last.prevSwipe)
    this.engine.unrecord(last.resto, last.dir)
    this.store.saveTaste(this.engine.toJSON())
    return last.resto
  }
}

// Greedy re-order: never more than `maxRun` consecutive cards of one cuisine.
// `seedCuisines` is the virtual tail of cards already shown before this list —
// runs are counted across that boundary but the seed is not returned.
export function diversify(list, maxRun = CONFIG.deck.maxSameCuisineRun, seedCuisines = []) {
  const pool = [...list]
  const out = []
  while (pool.length) {
    const run = runLength(out, seedCuisines)
    let idx = 0
    if (run.count >= maxRun) {
      const alt = pool.findIndex((c) => c.resto.cuisine !== run.cuisine)
      if (alt >= 0) idx = alt
    }
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

function runLength(out, seedCuisines = []) {
  const tail = [...seedCuisines, ...out.map((c) => c.resto.cuisine)]
  if (!tail.length) return { cuisine: null, count: 0 }
  const cuisine = tail[tail.length - 1]
  let count = 0
  for (let i = tail.length - 1; i >= 0 && tail[i] === cuisine; i--) count++
  return { cuisine, count }
}
