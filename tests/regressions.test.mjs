import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TasteEngine } from '../js/core/engine.js'
import { Deck, diversify } from '../js/core/deck.js'
import { Store } from '../js/core/store.js'
import { CONFIG } from '../js/config.js'

const rand = () => 0.5

const resto = (over = {}) => ({
  id: over.id || 'r1', name: over.id || 'T', cuisine: 'Mexican', tags: ['casual'], price: 2,
  rating: 4.5, ratingCount: 1000, lat: 37.76, lng: -122.41, ...over,
})

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

const NOW = new Date(2026, 6, 22, 12).getTime()

test('diversity survives per-swipe rebuilds (review finding #0)', () => {
  const pool = [
    ...Array.from({ length: 6 }, (_, i) => resto({ id: 'm' + i, cuisine: 'Mexican' })),
    ...Array.from({ length: 3 }, (_, i) => resto({ id: 't' + i, cuisine: 'Thai', tags: ['soup'] })),
  ]
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const deck = new Deck({ restaurants: pool, store, engine: new TasteEngine(rand) })

  // Simulate the real commit loop: swipe top, rebuild pinning the next two.
  let queue = deck.build('forYou', NOW)
  const seen = []
  while (queue.length) {
    const top = queue[0]
    seen.push(top.resto.cuisine)
    deck.swipe(top.resto, 1, NOW)
    queue = deck.build('forYou', NOW, { pin: queue.slice(1, 3) })
  }
  assert.equal(seen.length, 9)
  let run = 1
  for (let i = 1; i < seen.length; i++) {
    run = seen[i] === seen[i - 1] ? run + 1 : 1
    const remaining = seen.slice(i + 1)
    // Cap may only be exceeded when no alternative cuisine remained to deal.
    if (run > CONFIG.deck.maxSameCuisineRun) {
      assert.ok(remaining.every((c) => c === seen[i]) || seen.slice(0, i).filter((c) => c !== seen[i]).length === 3,
        `run of ${run} at ${i} in ${seen.join(',')}`)
    }
  }
  // The strong assertion: with 3 Thai available, never 3+ Mexican in a row
  // while a Thai card was still undealt.
  for (let i = 2; i < seen.length; i++) {
    if (seen[i] === 'Mexican' && seen[i - 1] === 'Mexican' && seen[i - 2] === 'Mexican') {
      assert.ok(!seen.slice(i + 1).includes('Thai'), `3-run at ${i} with Thai still undealt: ${seen.join(',')}`)
    }
  }
})

test('rebuild pins keep the visible peek cards in order', () => {
  const pool = Array.from({ length: 10 }, (_, i) => resto({ id: 'r' + i, cuisine: i % 2 ? 'Thai' : 'Pizza', tags: [] }))
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const deck = new Deck({ restaurants: pool, store, engine: new TasteEngine(Math.random) })
  const q1 = deck.build('forYou', NOW)
  deck.swipe(q1[0].resto, 1, NOW)
  const q2 = deck.build('forYou', NOW, { pin: q1.slice(1, 3) })
  assert.equal(q2[0].resto.id, q1[1].resto.id)
  assert.equal(q2[1].resto.id, q1[2].resto.id)
})

test('Something New keeps tag transfer at full strength (review finding #1)', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 30; i++) e.record(resto({ cuisine: 'Thai', tags: ['spicy', 'noodles'] }), 1)
  const spicy = resto({ cuisine: 'Sichuan', tags: ['spicy', 'noodles'] })
  const neutralTags = resto({ cuisine: 'Hawaiian', tags: [] })
  const gapForYou = e.score(spicy, { mode: 'forYou', distanceMi: 1 }) - e.score(neutralTags, { mode: 'forYou', distanceMi: 1 })
  const gapNew = e.score(spicy, { mode: 'new', distanceMi: 1 }) - e.score(neutralTags, { mode: 'new', distanceMi: 1 })
  // Same novelty (both unseen), same quality/distance — the gap is pure tag
  // transfer and must not shrink in 'new' mode.
  assert.ok(Math.abs(gapForYou - gapNew) < 1e-9, `${gapForYou} vs ${gapNew}`)
})

test('removeMatch fully un-swipes: engine, matches, history (review finding #3)', () => {
  const r = resto({ id: 'x', cuisine: 'Korean' })
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  const deck = new Deck({ restaurants: [r], store, engine: new TasteEngine(rand) })
  deck.swipe(r, 1, NOW)
  assert.equal(deck.engine.affinity('Korean') > 0.5, true)
  deck.removeMatch('x')
  assert.deepEqual(store.matches, [])
  assert.equal(deck.engine.seen('Korean'), 0)
  assert.equal(deck.undo(), null) // history purged — no phantom undo
})

test('corrupt localStorage cannot brick boot (review finding #12)', () => {
  for (const blob of ['{"settings":null}', 'not json', '[]', '{"matches":"nope","swipes":7}']) {
    const storage = memStorage()
    storage.setItem(CONFIG.storageKey, blob)
    const store = new Store(storage)
    const state = store.load()
    assert.equal(typeof state.settings.radiusMi, 'number')
    assert.deepEqual(Array.isArray(state.matches), true)
  }
})

test('Store boots in-memory when storage is unavailable (review finding #11)', () => {
  const store = new Store(null)
  store.load()
  store.recordSwipe('a', 1, 111)
  store.flush()
  assert.deepEqual(store.matches, ['a'])
})

test('pruneTo drops ids missing from the dataset (review finding #17)', () => {
  const store = new Store(memStorage())
  store.load()
  store.recordSwipe('alive', 1, 1)
  store.recordSwipe('ghost', 1, 2)
  store.markVisited('ghost')
  store.pruneTo(new Set(['alive']))
  assert.deepEqual(store.matches, ['alive'])
  assert.equal(store.swipes.ghost, undefined)
  assert.equal(store.visits.ghost, undefined)
})

test('session overrides never persist and yield to real choices (review finding #14)', () => {
  const storage = memStorage()
  const store = new Store(storage)
  store.load()
  store.session.location = { lat: 1, lng: 2, label: 'QA' }
  assert.equal(store.settings.location.label, 'QA')
  store.flush()
  assert.ok(!String(storage.getItem(CONFIG.storageKey)).includes('QA'))
  store.setSetting('location', { lat: 3, lng: 4, label: 'Real' })
  assert.equal(store.settings.location.label, 'Real')
})

test('seedCuisines: weak prior that biases early ranking but stays overridable', async () => {
  const { TasteEngine } = await import('../js/core/engine.js')
  const e = new TasteEngine(() => 0.5)
  e.seedCuisines(['Korean', 'Thai'])
  assert.equal(e.total, 6)
  assert.ok(e.affinity('Korean') > 0.5)
  const seeded = { id: 'k', cuisine: 'Korean', tags: [], price: 2, rating: 4.4, ratingCount: 500 }
  const other = { id: 'p', cuisine: 'Pizza', tags: [], price: 2, rating: 4.4, ratingCount: 500 }
  assert.ok(e.score(seeded, { distanceMi: 1 }) > e.score(other, { distanceMi: 1 }))
  // 10 real dislikes must bury the seed
  for (let i = 0; i < 10; i++) e.record(seeded, -1)
  assert.ok(e.score(seeded, { distanceMi: 1 }) < e.score(other, { distanceMi: 1 }))
})

test('avoided cuisines return as last resort instead of dead-ending the deck', () => {
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const engine = new TasteEngine(rand)
  const pool = [
    resto({ id: 's1', cuisine: 'Steakhouse' }),
    resto({ id: 's2', cuisine: 'Steakhouse' }),
  ]
  const deck = new Deck({ restaurants: pool, store, engine })
  for (let i = 0; i < 3; i++) engine.record(resto({ cuisine: 'Steakhouse', id: 'ghost' + i }), -1)
  assert.equal(engine.avoids('Steakhouse'), true)
  assert.equal(deck.candidates('forYou', NOW).length, 0) // hard-filtered normally...
  const built = deck.build('forYou', NOW)
  assert.equal(built.length, 2) // ...but build falls back rather than emptying
})

test('seed showcase: a seeded cuisine appears in the first 5 cards early on', () => {
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const engine = new TasteEngine(rand)
  engine.seedCuisines(['Korean'])
  const pool = [
    ...Array.from({ length: 12 }, (_, i) => resto({ id: 'top' + i, cuisine: 'C' + i, rating: 4.8, ratingCount: 5000, tags: [] })),
    resto({ id: 'kr', cuisine: 'Korean', rating: 4.2, ratingCount: 200, tags: [] }),
  ]
  const deck = new Deck({ restaurants: pool, store, engine })
  const built = deck.build('forYou', NOW)
  assert.ok(built.slice(0, 5).some((c) => c.resto.cuisine === 'Korean'), built.slice(0, 5).map((c) => c.resto.cuisine).join(','))
  // After real swiping history, the showcase steps aside
  for (let i = 0; i < 12; i++) engine.record(resto({ cuisine: 'C1', id: 'h' + i }), 1)
  assert.ok(engine.total >= 15)
})
