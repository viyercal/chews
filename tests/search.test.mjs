import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex, search, orderResults } from '../js/core/search.js'

const resto = (over = {}) => ({
  id: over.id || 'r1', name: 'Test Spot', cuisine: 'Mexican', tags: ['casual'], price: 2,
  rating: 4.5, ratingCount: 500, lat: 37.76, lng: -122.41,
  signatureDish: { name: 'Al Pastor Tacos', description: 'Spit-roasted pork tacos.' },
  menu: [], why: '', city: 'San Francisco', ...over,
})

const POOL = [
  resto({ id: 'taqueria', name: "Lupe's Taqueria", signatureDish: { name: 'Birria Quesotacos', description: 'Rich consommé for dipping.' } }),
  resto({ id: 'ramen', name: 'Ramen Koji', cuisine: 'Ramen', tags: ['noodles', 'soup'], signatureDish: { name: 'Tonkotsu Ramen', description: 'Creamy pork broth.' } }),
  resto({
    id: 'thai', name: 'Baan Thai', cuisine: 'Thai', tags: ['spicy', 'noodles'],
    signatureDish: { name: 'Pad Kee Mao', description: 'Drunken noodles with serious spice.' },
  }),
  resto({ id: 'burger', name: 'Patty Palace', cuisine: 'Burgers', signatureDish: { name: 'Double Smash Burger', description: 'Crispy edges, soft bun.' } }),
  resto({
    id: 'mention', name: 'Casa Verde', signatureDish: { name: 'Enchiladas Suizas', description: 'Better than any birria around, some say.' },
  }),
]

test('restaurant-name query ranks that restaurant first', () => {
  const hits = search(buildSearchIndex(POOL), 'patty palace')
  assert.equal(hits[0].resto.id, 'burger')
})

test('dish query: signature-dish hit outranks a description mention', () => {
  const hits = search(buildSearchIndex(POOL), 'birria')
  assert.equal(hits[0].resto.id, 'taqueria')
  assert.ok(hits.some((h) => h.resto.id === 'mention')) // still findable, just lower
})

test('prefix typing works mid-word', () => {
  const hits = search(buildSearchIndex(POOL), 'tonko')
  assert.equal(hits[0].resto.id, 'ramen')
})

test('multi-token query prefers the place matching every word', () => {
  const hits = search(buildSearchIndex(POOL), 'spicy noodles')
  assert.equal(hits[0].resto.id, 'thai') // tag spicy + tag noodles beats ramen's noodles-only
  assert.ok(!hits.some((h) => h.resto.id === 'ramen')) // full matches exist → partials dropped
})

test('plural/singular tolerance both directions', () => {
  const idx = buildSearchIndex(POOL)
  assert.equal(search(idx, 'burgers')[0].resto.id, 'burger') // plural query, singular dish
  assert.equal(search(idx, 'enchilada')[0].resto.id, 'mention') // singular query, plural dish
})

test('empty and garbage queries return nothing', () => {
  const idx = buildSearchIndex(POOL)
  assert.deepEqual(search(idx, '   '), [])
  assert.deepEqual(search(idx, 'zzzqqq'), [])
})

const APOS_POOL = [
  ...POOL,
  resto({ id: 'sanaa', name: 'Sana’a cafe', cuisine: 'Cafe', tags: ['coffee'], signatureDish: { name: 'Adeni Chai', description: 'Spiced Yemeni tea.' } }),
  resto({ id: 'ofarrell', name: "O'Farrell Grill", signatureDish: { name: 'Ribeye', description: 'Char-grilled.' } }),
  resto({ id: 'plain', name: 'Corner Cafe', cuisine: 'Cafe', tags: ['coffee'], signatureDish: { name: 'Latte', description: 'Smooth.' } }),
]

test('apostrophes: sanaa / sana\'a / sana all find Sana’a', () => {
  const idx = buildSearchIndex(APOS_POOL)
  for (const q of ['sanaa', "sana'a", 'sana', 'sana’a cafe']) assert.equal(search(idx, q)[0].resto.id, 'sanaa', q)
  assert.equal(search(idx, 'farrell')[0].resto.id, 'ofarrell') // split form kept
})

test('one-letter typo still lands on the place', () => {
  const idx = buildSearchIndex(APOS_POOL)
  assert.equal(search(idx, "sara'a cafe")[0].resto.id, 'sanaa')
  assert.equal(search(idx, 'ramin koji')[0].resto.id, 'ramen')
  assert.deepEqual(search(idx, 'zzzqqq'), []) // garbage still empty
})

test('nameHit flags name-aimed queries, not dish queries', () => {
  const idx = buildSearchIndex(APOS_POOL)
  assert.equal(search(idx, 'sanaa cafe')[0].nameHit, true)
  assert.equal(search(idx, 'patty')[0].nameHit, true)
  const chai = search(idx, 'adeni chai')[0]
  assert.equal(chai.resto.id, 'sanaa')
  assert.equal(chai.nameHit, false)
})

test('category words that appear in many names are not name hits', () => {
  const pool = [...APOS_POOL]
  for (let i = 0; i < 10; i++) pool.push(resto({ id: `c${i}`, name: `Brand ${i} Coffee`, cuisine: 'Cafe', tags: ['coffee'] }))
  for (let i = 0; i < 3; i++) pool.push(resto({ id: `p${i}`, name: 'Philz Coffee', cuisine: 'Cafe', tags: ['coffee'] }))
  const idx = buildSearchIndex(pool)
  assert.ok(search(idx, 'coffee', { limit: 50 }).every((h) => !h.nameHit)) // 13 names → category
  const philz = search(idx, 'philz')
  assert.equal(philz.length, 3)
  assert.ok(philz.every((h) => h.nameHit)) // chain locations stay name hits
})

test('strong = the query lands in name/dish/cuisine/tags, not just a description', () => {
  const idx = buildSearchIndex(APOS_POOL)
  const byId = (q) => Object.fromEntries(search(idx, q, { limit: Infinity }).map((h) => [h.resto.id, h.strong]))
  const coffee = byId('coffee')
  assert.equal(coffee.sanaa, true) // tag + cuisine
  assert.equal(coffee.plain, true)
  const birria = byId('birria')
  assert.equal(birria.taqueria, true) // signature dish
  assert.equal(birria.mention, false) // description only
})

test('orderResults: about-it first, open before closed, then nearest', () => {
  const rows = [
    { id: 'far-named', strong: true, closed: false, d: 9.4, score: 16.5 },
    { id: 'near-tag', strong: true, closed: false, d: 1.0, score: 8.8 },
    { id: 'near-closed', strong: true, closed: true, d: 0.2, score: 16.9 },
    { id: 'mention', strong: false, closed: false, d: 0.1, score: 2 },
    { id: 'nearest', strong: true, closed: false, d: 0.3, score: 16.8 },
  ]
  assert.deepEqual(orderResults(rows).map((r) => r.id), ['nearest', 'near-tag', 'far-named', 'near-closed', 'mention'])
})
