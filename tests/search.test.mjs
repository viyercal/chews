import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex, search } from '../js/core/search.js'

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
