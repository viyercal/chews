import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TasteEngine } from '../js/core/engine.js'
import { Deck, diversify } from '../js/core/deck.js'
import { Store } from '../js/core/store.js'
import { milesBetween } from '../js/core/geo.js'
import { CONFIG } from '../js/config.js'

const rand = () => 0.5 // kills Thompson jitter for determinism

const resto = (over = {}) => ({
  id: over.id || 'r1',
  name: 'Test',
  cuisine: 'Mexican',
  tags: ['spicy', 'casual'],
  price: 2,
  rating: 4.5,
  ratingCount: 1000,
  lat: 37.76,
  lng: -122.41,
  ...over,
})

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

test('cold start: zero swipes means cuisine has no influence', () => {
  const e = new TasteEngine(rand)
  const a = resto({ cuisine: 'Mexican' })
  const b = resto({ cuisine: 'Thai', tags: ['soup'] })
  assert.equal(e.confidence(), 0)
  assert.equal(e.score(a, { distanceMi: 1 }), e.score(b, { distanceMi: 1 }))
})

test('confidence ramps linearly and caps at 1', () => {
  const e = new TasteEngine(rand)
  const n = CONFIG.coldStart.fullConfidenceSwipes
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(e.confidence() - Math.min(1, i / n)) < 1e-9)
    e.record(resto(), 1)
  }
  e.record(resto(), 1)
  assert.equal(e.confidence(), 1)
})

test('learning: liked cuisine outranks disliked cuisine once confident', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 15; i++) e.record(resto({ cuisine: 'Mexican' }), 1)
  for (let i = 0; i < 15; i++) e.record(resto({ cuisine: 'Thai', tags: ['soup'] }), -1)
  const mex = e.score(resto({ cuisine: 'Mexican' }), { distanceMi: 1 })
  const thai = e.score(resto({ cuisine: 'Thai', tags: ['soup'] }), { distanceMi: 1 })
  assert.ok(mex > thai)
})

test('tag transfer: liked tags boost an unseen cuisine', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 30; i++) e.record(resto({ cuisine: 'Thai', tags: ['spicy', 'noodles'] }), 1)
  const spicyNew = resto({ cuisine: 'Sichuan', tags: ['spicy', 'noodles'] })
  const mildNew = resto({ cuisine: 'Bakery', tags: ['sweet', 'bread'] })
  assert.equal(e.seen('Sichuan'), 0)
  assert.ok(e.tagAffinity(spicyNew) > e.tagAffinity(mildNew))
  assert.ok(e.score(spicyNew, { distanceMi: 1 }) > e.score(mildNew, { distanceMi: 1 }))
})

test('new mode rewards unexplored cuisines', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 30; i++) e.record(resto({ cuisine: 'Mexican' }), 1)
  const seen = resto({ cuisine: 'Mexican' })
  const unseen = resto({ cuisine: 'Ethiopian', tags: ['spicy', 'casual'] })
  const seenGap = e.score(seen, { mode: 'forYou', distanceMi: 1 }) - e.score(unseen, { mode: 'forYou', distanceMi: 1 })
  const newGap = e.score(seen, { mode: 'new', distanceMi: 1 }) - e.score(unseen, { mode: 'new', distanceMi: 1 })
  assert.ok(newGap < seenGap) // novelty closes (or flips) the gap in Something New
})

test('unrecord reverses record (undo)', () => {
  const e = new TasteEngine(rand)
  const strip = (j) => { const { lastDecayAt, ...rest } = j; return JSON.stringify(rest) } // decay clock isn't evidence
  const before = strip(e.toJSON())
  e.record(resto(), 1)
  e.unrecord(resto(), 1)
  assert.equal(strip(e.toJSON()), before)
})

test('engine serialization round-trips', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 7; i++) e.record(resto({ cuisine: i % 2 ? 'Thai' : 'Pizza' }), i % 3 ? 1 : -1)
  const revived = TasteEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), rand)
  assert.equal(revived.total, e.total)
  assert.equal(revived.affinity('Thai'), e.affinity('Thai'))
})

test('diversify: never more than 2 consecutive same-cuisine cards', () => {
  const list = []
  for (let i = 0; i < 10; i++) list.push({ resto: resto({ id: 'm' + i, cuisine: 'Mexican' }) })
  for (let i = 0; i < 4; i++) list.push({ resto: resto({ id: 't' + i, cuisine: 'Thai' }) })
  const out = diversify(list)
  assert.equal(out.length, 14)
  let run = 1
  for (let i = 1; i < out.length; i++) {
    run = out[i].resto.cuisine === out[i - 1].resto.cuisine ? run + 1 : 1
    if (out.slice(i).some((c) => c.resto.cuisine !== out[i].resto.cuisine)) {
      assert.ok(run <= CONFIG.deck.maxSameCuisineRun, `run of ${run} at ${i}`)
    }
  }
})

test('deck: radius filters, matches excluded, passes resurface after 14 days', () => {
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('radiusMi', 5)
  const near = resto({ id: 'near' })
  const far = resto({ id: 'far', lat: 38.5, lng: -121.5 })
  const deck = new Deck({ restaurants: [near, far], store, engine: new TasteEngine(rand) })

  const now = 1000000000000
  assert.deepEqual(deck.candidates('forYou', now).map((c) => c.resto.id), ['near'])
  assert.ok(milesBetween(store.settings.location, far) > 5)

  deck.swipe(near, 1, now)
  assert.equal(deck.candidates('forYou', now).length, 0) // matched → out of deck

  deck.undo()
  deck.swipe(near, -1, now)
  assert.equal(deck.candidates('forYou', now + 86400000).length, 0) // passed 1 day ago
  assert.equal(deck.candidates('forYou', now + 15 * 86400000).length, 1) // resurfaced
})

test('store: swipe/undo/matches bookkeeping', () => {
  const store = new Store(memStorage())
  store.load()
  const prev = store.recordSwipe('a', 1, 111)
  assert.equal(prev, null)
  assert.deepEqual(store.matches, ['a'])
  const prev2 = store.recordSwipe('a', -1, 222)
  assert.deepEqual(store.matches, [])
  store.undoSwipe('a', prev2)
  assert.deepEqual(store.matches, ['a'])
  assert.equal(store.swipes.a.at, 111)
})
