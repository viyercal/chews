import { test } from 'node:test'
import assert from 'node:assert/strict'

// duo.js uses TextEncoder/atob — all available in node ≥16 globals.
const { encodeDuo, decodeDuo, duoTokenFromHash } = await import('../js/core/duo.js')

test('duo payload round-trips ids and location', () => {
  const token = encodeDuo({ ids: ['la-taqueria', 'zuni-cafe', 'bi-rite-market'], loc: { lat: 37.7599, lng: -122.4148 } })
  const p = decodeDuo(token)
  assert.deepEqual(p.ids, ['la-taqueria', 'zuni-cafe', 'bi-rite-market'])
  assert.equal(p.loc.lat, 37.7599)
})

test('live entries are excluded and lists are capped at 12', () => {
  const ids = ['live-abc', ...Array.from({ length: 20 }, (_, i) => 'spot-' + i)]
  const p = decodeDuo(encodeDuo({ ids }))
  assert.equal(p.ids.length, 12)
  assert.ok(!p.ids.includes('live-abc'))
})

test('a duo needs at least 2 shareable spots', () => {
  assert.equal(encodeDuo({ ids: ['only-one'] }), null)
  assert.equal(encodeDuo({ ids: ['live-a', 'live-b', 'real-one'] }), null)
})

test('malformed tokens are rejected, not thrown', () => {
  for (const bad of ['garbage', '', 'eyJub3QiOiJ2YWxpZCJ9', encodeDuo({ ids: ['a', 'b'] }).slice(0, 5)]) {
    assert.equal(decodeDuo(bad), null)
  }
})

test('hash parsing extracts tokens and ignores noise', () => {
  const token = encodeDuo({ ids: ['a-spot', 'b-spot'] })
  assert.equal(duoTokenFromHash(`#duo=${token}`), token)
  assert.equal(duoTokenFromHash('#other=x'), null)
  assert.equal(duoTokenFromHash(''), null)
})

test('unicode-safe encoding (diacritics in future payload fields)', () => {
  const token = encodeDuo({ ids: ['lẩu-hải-sản', 'phở-hà-nội'] })
  assert.deepEqual(decodeDuo(token).ids, ['lẩu-hải-sản', 'phở-hà-nội'])
})
