// Merges verbatim Google Maps values (rating / ratingCount / price) into
// data/restaurants.json. Usage: node scripts/apply_google_corrections.mjs corrections.json
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = join(root, 'data/restaurants.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const corrections = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const byName = new Map(data.restaurants.map((r) => [r.name.toLowerCase(), r]))
let applied = 0
let skippedLow = 0
let unmatched = 0
const closed = []

for (const c of corrections) {
  const r = byName.get(String(c.name || '').toLowerCase())
  if (!r) { unmatched++; console.warn('no match:', c.name); continue }
  if (c.confidence === 'low') {
    skippedLow++
    if (/closed/i.test(c.note || '')) closed.push(r.name)
    continue
  }
  let changed = false
  if (c.rating != null && c.rating >= 3 && c.rating <= 5 && c.rating !== r.rating) { r.rating = c.rating; changed = true }
  if (c.ratingCount != null && c.ratingCount > 0 && c.ratingCount !== r.ratingCount) { r.ratingCount = Math.round(c.ratingCount); changed = true }
  if (c.price != null && c.price >= 1 && c.price <= 4 && c.price !== r.price) { r.price = c.price; changed = true }
  if (changed) applied++
}

data.verifiedAt = new Date().toISOString().slice(0, 10)
writeFileSync(dataPath, JSON.stringify(data, null, 1))
console.log(`applied ${applied} changed entries; ${skippedLow} low-confidence skipped; ${unmatched} unmatched`)
if (closed.length) console.log('POSSIBLY CLOSED (review + consider removing):', closed.join(', '))
