// PRODUCTION data path: pulls rating / userRatingCount / priceLevel / category /
// canonical Maps URL / opening hours VERBATIM from the Google Places API.
// Zero LLM involvement — hallucination is structurally impossible here.
//
//   GOOGLE_MAPS_API_KEY=... node scripts/fetch_places.mjs [--dry]
//
// Identity check: a match is only accepted if the returned place sits within
// 0.6 mi of our stored coordinates — we can never adopt the wrong branch's data.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.GOOGLE_MAPS_API_KEY
if (!KEY) {
  console.error('Set GOOGLE_MAPS_API_KEY. Create one at https://console.cloud.google.com (Places API (New)).')
  process.exit(1)
}
const DRY = process.argv.includes('--dry')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = join(root, 'data/restaurants.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8'))

const PRICE = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
}

const milesBetween = (a, b) => {
  const t = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * t) / 2) ** 2 +
    Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lng - a.lng) * t) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

async function lookup(r) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask':
        'places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,places.location,places.regularOpeningHours',
    },
    body: JSON.stringify({ textQuery: `${r.name} ${r.address} ${r.city || ''}`.trim(), maxResultCount: 1 }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()).places?.[0]
}

function toHours(regular) {
  if (!regular?.periods) return undefined
  const out = []
  for (const p of regular.periods) {
    if (!p.open) continue
    const day = p.open.day
    const o = `${String(p.open.hour).padStart(2, '0')}:${String(p.open.minute || 0).padStart(2, '0')}`
    const c = p.close ? `${String(p.close.hour).padStart(2, '0')}:${String(p.close.minute || 0).padStart(2, '0')}` : '24:00'
    out.push([day, o, c])
  }
  return out.length ? out : undefined
}

const ALL = process.argv.includes('--all')
let updated = 0
const problems = []
for (const r of data.restaurants) {
  if (r.verified && !ALL) continue // targeted re-runs only touch stragglers
  try {
    const p = await lookup(r)
    if (!p) { problems.push(`${r.name}: no match`); continue }
    const dist = milesBetween(r, { lat: p.location.latitude, lng: p.location.longitude })
    if (dist > 0.6) { problems.push(`${r.name}: match ${dist.toFixed(1)} mi away — rejected`); continue }
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
      problems.push(`${r.name}: businessStatus=${p.businessStatus} — flag for removal`)
      continue
    }
    if (p.rating) r.rating = p.rating
    if (p.userRatingCount) r.ratingCount = p.userRatingCount
    if (p.priceLevel && PRICE[p.priceLevel]) r.price = PRICE[p.priceLevel]
    if (p.priceRange?.startPrice?.units) {
      const end = p.priceRange.endPrice?.units
      r.priceRange = end ? `$${p.priceRange.startPrice.units}–${end}` : `$${p.priceRange.startPrice.units}+`
    }
    if (p.googleMapsUri) r.mapsUrl = p.googleMapsUri
    if (p.primaryTypeDisplayName?.text) r.googleCategory = p.primaryTypeDisplayName.text
    const hours = toHours(p.regularOpeningHours)
    if (hours) r.hours = hours
    r.verified = true
    updated++
    await new Promise((s) => setTimeout(s, 120))
  } catch (e) {
    problems.push(`${r.name}: ${e.message}`)
  }
}

data.verifiedAt = new Date().toISOString().slice(0, 10)
data.verifiedBy = 'places-api'
if (!DRY) writeFileSync(dataPath, JSON.stringify(data, null, 1))
console.log(`verified ${updated}/${data.restaurants.length} via Places API${DRY ? ' (dry run — not written)' : ''}`)
if (problems.length) console.log('PROBLEMS:\n- ' + problems.join('\n- '))
console.log('\nNext: node scripts/integrate_data.mjs && node scripts/build.mjs')
