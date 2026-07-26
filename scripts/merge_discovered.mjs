// Merges discovered places (API facts) + editorial layer (agent-written, review-
// grounded) into data/restaurants.json. STRUCTURAL CHECK: every dish's `basis`
// must be a verbatim substring of that place's own reviews/editorialSummary —
// dish claims that can't cite their source are dropped, never shipped.
//
//   node scripts/merge_discovered.mjs data/editorial.json
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const discovered = JSON.parse(readFileSync(join(root, 'data/discovered.json'), 'utf8'))
const editorial = JSON.parse(readFileSync(process.argv[2] || join(root, 'data/editorial.json'), 'utf8'))
const data = JSON.parse(readFileSync(join(root, 'data/restaurants.json'), 'utf8'))

const byPlaceId = new Map(discovered.map((d) => [d.placeId, d]))
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim()
const existingNames = new Set(data.restaurants.map((r) => norm(r.name)))

const cityOf = (addr, cityKey) => {
  const m = addr.match(/,\s*([A-Za-z .]+),\s*CA/)
  if (m) return m[1].trim()
  return cityKey === 'sj' ? 'San Jose' : 'San Francisco'
}

let added = 0
let droppedUngrounded = 0
let droppedSkip = 0
const report = []

for (const e of editorial) {
  const d = byPlaceId.get(e.placeId)
  if (!d) continue
  if (e.skip) { droppedSkip++; continue }
  if (existingNames.has(norm(d.name))) continue

  const corpus = norm([d.editorialSummary, ...(d.reviews || [])].join(' \n '))
  const grounded = (basis) => basis && corpus.includes(norm(basis))

  if (!grounded(e.signatureDish?.basis)) {
    droppedUngrounded++
    report.push(`ungrounded signature: ${d.name} — "${(e.signatureDish?.basis || '').slice(0, 60)}"`)
    continue
  }
  const menu = (e.menu || []).filter((m) => grounded(m.basis)).slice(0, 4)
    .map((m) => ({ name: m.name, price: m.price || '', description: m.description || '' }))

  data.restaurants.push({
    name: d.name,
    cuisine: e.cuisine,
    neighborhood: e.neighborhood || '',
    city: cityOf(d.address, d.cityKey),
    address: d.address.replace(/,\s*[A-Za-z .]+,\s*CA\s*\d*$/, ''),
    lat: d.lat,
    lng: d.lng,
    rating: d.rating,
    ratingCount: d.ratingCount,
    price: d.price,
    emoji: e.emoji || '🍽️',
    signatureDish: { name: e.signatureDish.name, description: e.signatureDish.description || '' },
    menu,
    tags: [...new Set(e.tags || [])].slice(0, 8),
    why: e.why || '',
    ...(d.hours ? { hours: d.hours } : {}),
    mapsUrl: d.mapsUrl,
    googleCategory: d.googleCategory,
    verified: true,
  })
  existingNames.add(norm(d.name))
  added++
}

data.verifiedAt = new Date().toISOString().slice(0, 10)
data.verifiedBy = 'places-api'
writeFileSync(join(root, 'data/restaurants.json'), JSON.stringify(data, null, 1))
console.log(`added ${added}; dropped ${droppedUngrounded} ungrounded + ${droppedSkip} agent-skipped; total ${data.restaurants.length}`)
if (report.length) console.log(report.slice(0, 12).join('\n'))
