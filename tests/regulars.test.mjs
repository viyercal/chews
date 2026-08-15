import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TasteEngine } from '../js/core/engine.js'
import { Deck } from '../js/core/deck.js'
import { Store } from '../js/core/store.js'
import { CONFIG } from '../js/config.js'

const rand = () => 0.5
const DAY = 86400 * 1000
const T0 = new Date(2026, 6, 22, 12).getTime() // Wednesday noon

const resto = (over = {}) => ({
  id: over.id || 'r1', name: 'T', cuisine: 'Korean', tags: ['bbq'], price: 2,
  rating: 4.5, ratingCount: 1000, lat: 37.76, lng: -122.41, ...over,
})

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

const mk = (restaurants) => {
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const engine = new TasteEngine(rand)
  return { deck: new Deck({ restaurants, store, engine }), store, engine }
}

test('hiding a regular reverses its meal evidence, keeps the swipe', () => {
  const r = resto()
  const { deck, store, engine } = mk([r])
  deck.swipe(r, 1, T0)
  store.markVisited(r.id, T0)
  deck.recordMeal(r, 'fire', T0)
  store.setVisitVerdict(r.id, 'fire', T0)
  assert.equal(engine.cuisines.Korean.likes, 1 + CONFIG.meals.fire)
  deck.hideRegular(r.id, T0)
  assert.equal(engine.cuisines.Korean.likes, 1) // the swipe survives; the meal doesn't
  assert.equal(store.visits[r.id].hidden, true)
})

test('hiding reverses every logged meal, and never twice', () => {
  const r = resto()
  const { deck, store, engine } = mk([r])
  for (const v of ['fire', 'fine']) {
    store.markVisited(r.id, T0)
    deck.recordMeal(r, v, T0)
    store.setVisitVerdict(r.id, v, T0)
  }
  assert.equal(engine.cuisines.Korean.likes, CONFIG.meals.fire + CONFIG.meals.fine)
  deck.hideRegular(r.id, T0)
  assert.equal(engine.cuisines.Korean, undefined)
  deck.hideRegular(r.id, T0) // no-op: already hidden, log already reconciled
  assert.equal(engine.total, 0)
})

test('legacy regulars (no meal log) reverse their last verdict on hide', () => {
  const r = resto()
  const { deck, store, engine } = mk([r])
  engine.recordMeal(r, 'fire', T0)
  store.state.visits[r.id] = { count: 2, lastAt: T0, lastVerdict: 'fire' } // pre-log shape
  deck.hideRegular(r.id, T0)
  assert.equal(engine.cuisines.Korean, undefined)
  assert.equal(engine.total, 0)
})

test('a hidden regular becomes dealable again in Something New', () => {
  const r = resto()
  const { deck, store } = mk([r])
  store.markVisited(r.id, T0)
  assert.equal(deck.candidates('new', T0).length, 0)
  deck.hideRegular(r.id, T0)
  assert.equal(deck.candidates('new', T0).length, 1)
})

test('eating there again revives a hidden regular', () => {
  const r = resto()
  const { deck, store } = mk([r])
  store.markVisited(r.id, T0)
  deck.hideRegular(r.id, T0)
  assert.equal(store.visits[r.id].hidden, true)
  store.markVisited(r.id, T0 + DAY)
  assert.ok(!store.visits[r.id].hidden)
  assert.equal(store.visits[r.id].count, 2)
})

test('hidden state and the meal log survive a save/load round-trip', () => {
  const storage = memStorage()
  const a = new Store(storage)
  a.load()
  a.markVisited('x', T0)
  a.setVisitVerdict('x', 'fire', T0)
  a.markVisited('y', T0)
  a.hideVisit('y')
  a.flush()
  const b = new Store(storage)
  b.load()
  assert.deepEqual(b.visits.x.log, [{ v: 'fire', at: T0 }])
  assert.equal(b.visits.y.hidden, true)
})
