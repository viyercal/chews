import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapLivePlace, categoryToCuisine } from '../js/core/live.js'
import { Store } from '../js/core/store.js'
import { CONFIG } from '../js/config.js'

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

const PLACE = {
  id: 'abc123',
  displayName: { text: 'Pho Superb' },
  formattedAddress: '12 Main St, Sacramento, CA 95814, USA',
  location: { latitude: 38.58, longitude: -121.49 },
  rating: 4.6,
  userRatingCount: 812,
  priceLevel: 'PRICE_LEVEL_MODERATE',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  primaryTypeDisplayName: { text: 'Vietnamese restaurant' },
  businessStatus: 'OPERATIONAL',
  editorialSummary: { text: 'Aromatic pho and grilled pork plates in a bright space.' },
  regularOpeningHours: { periods: [{ open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 21, minute: 30 } }] },
}

test('mapLivePlace produces a schema-compatible verified record', () => {
  const r = mapLivePlace(PLACE)
  assert.equal(r.id, 'live-abc123')
  assert.equal(r.live, true)
  assert.equal(r.cuisine, 'Vietnamese')
  assert.equal(r.city, 'Sacramento')
  assert.equal(r.price, 2)
  assert.equal(r.rating, 4.6)
  assert.deepEqual(r.hours, [[1, '10:00', '21:30']])
  assert.equal(r.signatureDish.name, 'Vietnamese')
  assert.ok(r.signatureDish.description.includes('pho'))
  assert.equal(r.verified, true)
})

test('categoryToCuisine maps common categories and falls back sanely', () => {
  assert.equal(categoryToCuisine('Ramen restaurant'), 'Ramen')
  assert.equal(categoryToCuisine('Ice cream shop'), 'Dessert')
  assert.equal(categoryToCuisine('Fusion tapas lounge'), 'New American')
})

test('liveCache survives pruneTo and match bookkeeping', () => {
  const store = new Store(memStorage())
  store.load()
  const live = mapLivePlace(PLACE)
  store.recordSwipe(live.id, 1, 111)
  store.cacheLive(live)
  store.pruneTo(new Set(['some-indexed-id'])) // live id not in dataset — must survive
  assert.deepEqual(store.matches, [live.id])
  assert.ok(store.state.liveCache[live.id])
})

test('quality bar is the only gate — chains included by owner decision', async () => {
  const { passesLiveQuality } = await import('../js/core/live.js')
  const subway = { ...PLACE, displayName: { text: 'Subway' }, rating: 4.5, userRatingCount: 106 }
  assert.equal(passesLiveQuality(subway), true) // clears the bar → deals
  const weakSubway = { ...subway, rating: 3.9 }
  assert.equal(passesLiveQuality(weakSubway), false) // the bar still applies to everyone
})

test('live entries carry no fake dish: cuisine hero, summary once, cuisine emoji', () => {
  const r = mapLivePlace(PLACE)
  assert.equal(r.signatureDish.name, 'Vietnamese')
  assert.equal(r.emoji, '🍜')
  assert.equal(r.why, '')
  assert.equal(r.liveSummary, PLACE.editorialSummary.text)
})

test('takeLiveBudget: grants against a daily cap, persists, resets next day', () => {
  const storage = memStorage()
  const store = new Store(storage)
  store.load()
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 7)
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 7)
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 7)
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 7)
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 3) // 28 spent → only 3 left
  assert.equal(store.takeLiveBudget(7, 31, '2026-08-15'), 0) // cap exhausted
  store.flush()
  const reloaded = new Store(storage)
  reloaded.load()
  assert.equal(reloaded.takeLiveBudget(7, 31, '2026-08-15'), 0) // survives reload
  assert.equal(reloaded.takeLiveBudget(7, 31, '2026-08-16'), 7) // fresh day, fresh budget
})

test('ringCenters: center first, ring cells ~2.2mi out, capped by cells', async () => {
  const { ringCenters } = await import('../js/core/live.js')
  const { milesBetween } = await import('../js/core/geo.js')
  const centers = ringCenters(39.7392, -104.9903, 7)
  assert.equal(centers.length, 7)
  assert.deepEqual(centers[0], [39.7392, -104.9903])
  for (const [lat, lng] of centers.slice(1)) {
    const d = milesBetween({ lat: 39.7392, lng: -104.9903 }, { lat, lng })
    assert.ok(d > 1.9 && d < 2.5, `ring cell ${d}mi from center`)
  }
  assert.equal(ringCenters(39.7392, -104.9903, 3).length, 3)
})

test('findFreshRescue: reuses a fresh nearby pull, rejects stale and far ones', async () => {
  const { findFreshRescue } = await import('../js/core/live.js')
  const { milesBetween } = await import('../js/core/geo.js')
  const NOW = 1755200000000
  const denver = { lat: 39.7392, lng: -104.9903 }
  const cache = {
    '39.74,-104.99': { at: NOW - 86400000, lat: 39.7392, lng: -104.9903, restos: [{ id: 'live-a' }] },
  }
  const opts = { reuseMiles: 2.5, maxAgeDays: 7, now: NOW, milesBetween }
  assert.ok(findFreshRescue(cache, denver, opts)) // 1 day old, same spot → reuse
  assert.ok(findFreshRescue(cache, { lat: 39.755, lng: -104.99 }, opts)) // ~1.1mi away → reuse
  assert.equal(findFreshRescue(cache, { lat: 39.9392, lng: -104.99 }, opts), null) // ~14mi → new pull
  assert.equal(findFreshRescue(cache, denver, { ...opts, now: NOW + 8 * 86400000 }), null) // 8 days stale
  assert.equal(findFreshRescue({}, denver, opts), null)
})

test('cacheRescue: persists pulls, LRU-capped at maxEntries', () => {
  const storage = memStorage()
  const store = new Store(storage)
  store.load()
  for (let i = 0; i < 4; i++) {
    store.cacheRescue({ lat: 39 + i, lng: -104, restos: [{ id: `live-${i}` }] }, { maxEntries: 3, at: 1000 + i })
  }
  store.flush()
  const reloaded = new Store(storage)
  reloaded.load()
  const entries = Object.values(reloaded.rescueCache)
  assert.equal(entries.length, 3)
  assert.ok(!entries.some((e) => e.restos[0].id === 'live-0')) // oldest evicted
})
