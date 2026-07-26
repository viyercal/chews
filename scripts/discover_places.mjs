// Discovers new restaurants for the index via Places API grid sweep — zero LLM.
// Facts (rating/count/price/hours/coords/links) are verbatim; review texts are
// captured so the editorial layer (signature dish) can be grounded in them.
//
//   GOOGLE_MAPS_API_KEY=... node scripts/discover_places.mjs [--city sf|sj|all]
//
// Writes data/discovered.json. Merge with scripts/merge_discovered.mjs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.GOOGLE_MAPS_API_KEY
if (!KEY) { console.error('Set GOOGLE_MAPS_API_KEY'); process.exit(1) }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cityArg = process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : 'all'

// Neighborhood grid centers (lat, lng) — 1.2km cells, popularity-ranked.
const SF = [
  [37.7599, -122.4148], [37.7648, -122.4230], [37.7484, -122.4156], [37.7509, -122.4310],
  [37.7793, -122.4192], [37.7834, -122.4090], [37.7873, -122.4020], [37.7946, -122.4048],
  [37.7989, -122.4076], [37.8003, -122.4090], [37.7952, -122.4222], [37.7876, -122.4256],
  [37.7857, -122.4322], [37.7726, -122.4306], [37.7690, -122.4460], [37.7813, -122.4637],
  [37.7828, -122.4837], [37.7635, -122.4666], [37.7431, -122.4692], [37.7648, -122.3900],
  [37.7570, -122.3888], [37.7395, -122.4220], [37.7247, -122.4348], [37.7340, -122.4670],
  [37.7999, -122.4370], [37.8022, -122.4187],
]
const SJ = [
  [37.3352, -121.8902], [37.3480, -121.8950], [37.3097, -121.9010], [37.3320, -121.9000],
  [37.3520, -121.9020], [37.3382, -121.8560], [37.3230, -121.8330], [37.3005, -121.8480],
  [37.2570, -121.8790], [37.2870, -121.9320], [37.3230, -121.9480], [37.3200, -121.9780],
  [37.3700, -121.9220], [37.3900, -121.8800], [37.3340, -121.9180], [37.2510, -121.9080],
  [37.3620, -121.8420], [37.2900, -121.8100],
]

import { CHAIN_RE as CHAIN_BLOCKLIST } from '../js/core/live.js' // one chain policy everywhere

const QUALITY = { sf: { minRating: 4.3, minCount: 250 }, sj: { minRating: 4.2, minCount: 150 } }

const existing = JSON.parse(readFileSync(join(root, 'data/restaurants.json'), 'utf8')).restaurants
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const existingNames = new Set(existing.map((r) => norm(r.name)))

const mi = (a, b) => {
  const t = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * t) / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lng - a.lng) * t) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

async function nearby(lat, lng) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,places.regularOpeningHours',
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 1200 } },
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()).places || []
}

async function details(id) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'editorialSummary,reviews' },
  })
  if (!res.ok) return {}
  return await res.json()
}

const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }
const toHours = (reg) => {
  if (!reg?.periods) return undefined
  const out = reg.periods.filter((p) => p.open).map((p) => [
    p.open.day,
    `${String(p.open.hour).padStart(2, '0')}:${String(p.open.minute || 0).padStart(2, '0')}`,
    p.close ? `${String(p.close.hour).padStart(2, '0')}:${String(p.close.minute || 0).padStart(2, '0')}` : '24:00',
  ])
  return out.length ? out : undefined
}

const grids = cityArg === 'sf' ? { sf: SF } : cityArg === 'sj' ? { sj: SJ } : { sf: SF, sj: SJ }
const found = new Map()
let calls = 0
for (const [cityKey, grid] of Object.entries(grids)) {
  const q = QUALITY[cityKey]
  for (const [lat, lng] of grid) {
    try {
      const places = await nearby(lat, lng)
      calls++
      for (const p of places) {
        if (found.has(p.id)) continue
        if (p.businessStatus !== 'OPERATIONAL') continue
        if (!p.rating || p.rating < q.minRating || (p.userRatingCount || 0) < q.minCount) continue
        if (CHAIN_BLOCKLIST.test(p.displayName.text)) continue
        if (existingNames.has(norm(p.displayName.text))) continue
        const loc = { lat: p.location.latitude, lng: p.location.longitude }
        if (existing.some((r) => mi(r, loc) < 0.09 && norm(r.name).includes(norm(p.displayName.text).slice(0, 8)))) continue
        found.set(p.id, {
          placeId: p.id,
          name: p.displayName.text,
          address: p.formattedAddress.replace(/, USA$/, ''),
          lat: +loc.lat.toFixed(5),
          lng: +loc.lng.toFixed(5),
          rating: p.rating,
          ratingCount: p.userRatingCount,
          price: PRICE[p.priceLevel] || 2,
          mapsUrl: p.googleMapsUri,
          googleCategory: p.primaryTypeDisplayName?.text || '',
          hours: toHours(p.regularOpeningHours),
          cityKey,
        })
      }
      await new Promise((s) => setTimeout(s, 100))
    } catch (e) {
      console.warn(`cell ${lat},${lng}: ${e.message.slice(0, 120)}`)
    }
  }
}
console.log(`grid sweep: ${calls} cells → ${found.size} new quality candidates`)

// Reviews + editorial summary for accepted candidates (grounds the dish layer).
const list = [...found.values()]
let enriched = 0
for (const c of list) {
  const d = await details(c.placeId)
  c.editorialSummary = d.editorialSummary?.text || ''
  c.reviews = (d.reviews || []).map((r) => (r.text?.text || '').slice(0, 400)).filter(Boolean).slice(0, 5)
  if (c.reviews.length) enriched++
  await new Promise((s) => setTimeout(s, 80))
}
console.log(`details pass: ${enriched}/${list.length} with review texts`)

const outPath = join(root, 'data/discovered.json')
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : []
const merged = [...prev.filter((p) => !found.has(p.placeId)), ...list]
writeFileSync(outPath, JSON.stringify(merged, null, 1))
console.log(`wrote ${merged.length} candidates to data/discovered.json`)
