import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TasteEngine } from '../js/core/engine.js'
import { CONFIG } from '../js/config.js'

const rand = () => 0.5
const DAY = 86400 * 1000
const T0 = new Date(2026, 6, 25).getTime()

const resto = (over = {}) => ({
  id: over.id || 'r1', cuisine: 'Korean', tags: ['bbq'], price: 2,
  rating: 4.5, ratingCount: 1000, ...over,
})

test('one 🔥 meal weighs like ten swipe-likes', () => {
  const meals = new TasteEngine(rand)
  meals.recordMeal(resto(), 'fire', T0)
  const swipes = new TasteEngine(rand)
  for (let i = 0; i < CONFIG.meals.fire; i++) swipes.record(resto(), 1, { at: T0 })
  assert.equal(meals.affinity('Korean'), swipes.affinity('Korean'))
  assert.equal(meals.total, swipes.total)
})

test('a miss meal buries a cuisine that swipes liked', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 3; i++) e.record(resto(), 1, { at: T0 })
  assert.ok(e.affinity('Korean') > 0.5)
  e.recordMeal(resto(), 'miss', T0)
  assert.ok(e.affinity('Korean') < 0.5)
})

test('fine is a mild positive', () => {
  const e = new TasteEngine(rand)
  e.recordMeal(resto(), 'fine', T0)
  assert.ok(e.affinity('Korean') > 0.5)
  assert.equal(e.total, CONFIG.meals.fine)
})

test('evidence halves after one half-life; confidence decays with it', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 10; i++) e.record(resto(), 1, { at: T0 })
  const totalBefore = e.total
  const likesBefore = e.cuisines.Korean.likes
  e.record(resto({ cuisine: 'Thai', tags: [] }), 1, { at: T0 + CONFIG.decay.halfLifeDays * DAY })
  assert.ok(Math.abs(e.cuisines.Korean.likes - likesBefore / 2) < 0.01)
  assert.ok(Math.abs(e.total - (totalBefore / 2 + 1)) < 0.01)
})

test('stale evidence stops dominating: old likes fade against fresh dislikes', () => {
  const e = new TasteEngine(rand)
  for (let i = 0; i < 8; i++) e.record(resto(), 1, { at: T0 }) // 2024-ish palate
  const later = T0 + 2 * CONFIG.decay.halfLifeDays * DAY
  for (let i = 0; i < 3; i++) e.record(resto(), -1, { at: later })
  assert.ok(e.affinity('Korean') < 0.5) // 8 old likes (→2) lose to 3 fresh dislikes
})

test('tiny decayed entries are pruned', () => {
  const e = new TasteEngine(rand)
  e.record(resto(), 1, { at: T0 })
  e.record(resto({ cuisine: 'Thai', tags: [] }), 1, { at: T0 + 10 * CONFIG.decay.halfLifeDays * DAY })
  assert.equal(e.cuisines.Korean, undefined)
})

test('decay clock serializes; legacy profiles load fresh', () => {
  const e = new TasteEngine(rand)
  e.record(resto(), 1, { at: T0 })
  const revived = TasteEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), rand)
  assert.equal(revived.lastDecayAt, T0)
  const legacy = TasteEngine.fromJSON({ cuisines: { Korean: { likes: 5, dislikes: 0 } }, total: 5 }, rand)
  assert.equal(legacy.lastDecayAt, null)
  legacy.record(resto({ cuisine: 'Thai', tags: [] }), 1, { at: T0 })
  assert.equal(legacy.cuisines.Korean.likes, 5) // no retroactive decay on first touch
})

test('profile displays integer totals despite float internals (user-reported)', () => {
  const e = new TasteEngine(rand)
  e.seedCuisines(['Korean'])
  for (let i = 0; i < 10; i++) e.record(resto(), 1, { at: T0 + i * 3 * DAY })
  e.record(resto(), 1, { at: T0 + 200 * DAY }) // decay makes total fractional
  assert.ok(!Number.isInteger(e.total)) // internal float is expected...
  assert.ok(Number.isInteger(e.profile().total)) // ...but never shown to a human
})
