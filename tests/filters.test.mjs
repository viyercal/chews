import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TasteEngine } from '../js/core/engine.js'
import { Deck } from '../js/core/deck.js'
import { Store } from '../js/core/store.js'
import { CONFIG } from '../js/config.js'

const rand = () => 0.5

const resto = (over = {}) => ({
  id: over.id || 'r1', name: 'T', cuisine: 'Mexican', tags: ['casual'], price: 2,
  rating: 4.5, ratingCount: 1000, lat: 37.76, lng: -122.41, ...over,
})

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

const mkDeck = (restaurants, settings = {}) => {
  const store = new Store(memStorage())
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  for (const [k, v] of Object.entries(settings)) store.setSetting(k, v)
  return { deck: new Deck({ restaurants, store, engine: new TasteEngine(rand) }), store }
}

// Wednesday noon / Wednesday 11pm, local time
const WED_NOON = new Date(2026, 6, 22, 12).getTime()
const WED_LATE = new Date(2026, 6, 22, 23).getTime()

test('openNowOnly hides known-closed, keeps open and unknown', () => {
  const open = resto({ id: 'open', hours: [[3, '11:00', '22:00']] })
  const closed = resto({ id: 'closed', hours: [[3, '17:00', '21:00']] })
  const unknown = resto({ id: 'unknown' })
  const { deck } = mkDeck([open, closed, unknown], { openNowOnly: true })
  assert.deepEqual(deck.candidates('forYou', WED_NOON).map((c) => c.resto.id).sort(), ['open', 'unknown'])
  const late = deck.candidates('forYou', WED_LATE).map((c) => c.resto.id).sort()
  assert.deepEqual(late, ['unknown']) // both schedules closed at 11pm
})

test('openNowOnly off shows everything', () => {
  const closed = resto({ id: 'closed', hours: [[3, '17:00', '21:00']] })
  const { deck } = mkDeck([closed], { openNowOnly: false })
  assert.equal(deck.candidates('forYou', WED_NOON).length, 1)
})

test('maxPrice caps the deck', () => {
  const cheap = resto({ id: 'cheap', price: 1 })
  const spendy = resto({ id: 'spendy', price: 4 })
  const { deck, store } = mkDeck([cheap, spendy], { maxPrice: 2, openNowOnly: false })
  assert.deepEqual(deck.candidates('forYou', WED_NOON).map((c) => c.resto.id), ['cheap'])
  store.setSetting('maxPrice', 0)
  assert.equal(deck.candidates('forYou', WED_NOON).length, 2)
})

test('vegOnly keeps only veg-friendly tags', () => {
  const veg = resto({ id: 'veg', tags: ['vegetarian-friendly'] })
  const meat = resto({ id: 'meat', tags: ['meat-heavy'] })
  const { deck } = mkDeck([veg, meat], { vegOnly: true, openNowOnly: false })
  assert.deepEqual(deck.candidates('forYou', WED_NOON).map((c) => c.resto.id), ['veg'])
})

test('avoided cuisine (3 dislikes, 0 likes) leaves the deck', () => {
  const { deck } = mkDeck(
    [resto({ id: 'a', cuisine: 'Steakhouse' }), resto({ id: 'b', cuisine: 'Thai', tags: ['soup'] })],
    { openNowOnly: false }
  )
  for (let i = 0; i < CONFIG.avoid.dislikes; i++) deck.engine.record(resto({ cuisine: 'Steakhouse' }), -1)
  assert.deepEqual(deck.candidates('forYou', WED_NOON).map((c) => c.resto.id), ['b'])
  deck.engine.record(resto({ cuisine: 'Steakhouse' }), 1) // one like reopens it
  assert.equal(deck.candidates('forYou', WED_NOON).length, 2)
})

test('price affinity: disliked tier scores lower at full confidence', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 30; i++) e.record(resto({ cuisine: 'C' + i, price: 4, tags: [] }), -1)
  const pricey = resto({ cuisine: 'Fresh', price: 4, tags: [] })
  const cheap = resto({ cuisine: 'Fresh2', price: 1, tags: [] })
  assert.ok(e.score(cheap, { distanceMi: 1 }) > e.score(pricey, { distanceMi: 1 }))
})

test('session cuisine filter narrows the deck, never persists', () => {
  const storage = memStorage()
  const store = new Store(storage)
  store.load()
  store.setSetting('location', { lat: 37.76, lng: -122.41 })
  store.setSetting('openNowOnly', false)
  const deck = new Deck({
    restaurants: [resto({ id: 'mex' }), resto({ id: 'thai', cuisine: 'Thai', tags: ['soup'] })],
    store,
    engine: new TasteEngine(rand),
  })
  store.setSessionSetting('cuisines', ['Thai'])
  assert.deepEqual(deck.candidates('forYou', WED_NOON).map((c) => c.resto.id), ['thai'])
  store.clearSessionSetting('cuisines')
  assert.equal(deck.candidates('forYou', WED_NOON).length, 2)
  // Never persisted: a fresh store from the same storage has no cuisine filter.
  store.setSessionSetting('cuisines', ['Thai'])
  store.flush()
  const reloaded = new Store(storage)
  reloaded.load()
  assert.equal(reloaded.settings.cuisines, undefined)
})

test('cuisinesInRange counts in-radius cuisines for the picker', () => {
  const { deck } = mkDeck(
    [resto({ id: 'a' }), resto({ id: 'b' }), resto({ id: 'c', cuisine: 'Thai', tags: [] }), resto({ id: 'far', lat: 39.5 })],
    { openNowOnly: false }
  )
  assert.deepEqual(deck.cuisinesInRange(), [{ cuisine: 'Mexican', n: 2 }, { cuisine: 'Thai', n: 1 }])
})

test('settings deep-merge picks up new defaults for old profiles', () => {
  const storage = memStorage()
  storage.setItem(CONFIG.storageKey, JSON.stringify({ settings: { radiusMi: 5 } }))
  const store = new Store(storage)
  store.load()
  assert.equal(store.settings.radiusMi, 5)
  assert.equal(store.settings.openNowOnly, true)
  assert.equal(store.settings.maxPrice, 0)
})
