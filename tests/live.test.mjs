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

test('chain policy blocks Subway-tier chains in live results (user-reported)', async () => {
  const { passesLiveQuality, CHAIN_RE } = await import('../js/core/live.js')
  const subway = { ...PLACE, displayName: { text: 'Subway' }, rating: 4.5, userRatingCount: 106 }
  assert.equal(passesLiveQuality(subway), false)
  assert.equal(passesLiveQuality(PLACE), true) // real spot passes
  for (const chain of ['In-N-Out Burger', "McDonald's", 'Dutch Bros Coffee', 'Round Table Pizza']) {
    assert.ok(CHAIN_RE.test(chain), chain)
  }
  assert.ok(!CHAIN_RE.test('The Submarine House')) // no false positive on near-names
})

test('live entries carry no fake dish: cuisine hero, summary once, cuisine emoji', () => {
  const r = mapLivePlace(PLACE)
  assert.equal(r.signatureDish.name, 'Vietnamese')
  assert.equal(r.emoji, '🍜')
  assert.equal(r.why, '')
  assert.equal(r.liveSummary, PLACE.editorialSummary.text)
})
