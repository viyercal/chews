// Targeted census → hydrate for a small area: Text Search from several query
// angles (grid sweeps under-count coffee shops — Nearby caps at 20/cell and
// ranks by popularity), diff against the index, then pull details + reviews
// for the new quality spots so the editorial layer can ground dish claims.
// Zero LLM. Facts are verbatim Places API.
//
//   GOOGLE_MAPS_API_KEY=... CHEWS_KEY_REFERER=https://viyercal.github.io/chews/ \
//   node scripts/census_hydrate.mjs --name coffee-nobhill \
//     --centers "37.793,-122.416;37.7941,-122.4078" --queries "coffee shop;cafe" \
//     --within 1.2 --gate 4.2/80 --types coffee_shop,cafe,tea_house [--census-only]
//
// Writes data/pending/<name>.census.json (every hit, with in-index flag) and,
// unless --census-only, appends accepted candidates to data/discovered.json
// (so merge_discovered.mjs works unchanged) + data/pending/<name>.queue.json
// for the editorial agents.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.GOOGLE_MAPS_API_KEY
if (!KEY) { console.error('Set GOOGLE_MAPS_API_KEY'); process.exit(1) }
const REFERER = process.env.CHEWS_KEY_REFERER
const authHeaders = { 'X-Goog-Api-Key': KEY, ...(REFERER ? { Referer: REFERER } : {}) }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const NAME = arg('--name', 'census')
const CENTERS = arg('--centers', '').split(';').filter(Boolean).map((s) => s.split(',').map(Number))
const QUERIES = arg('--queries', 'coffee shop;cafe').split(';').map((s) => s.trim()).filter(Boolean)
const WITHIN = Number(arg('--within', 1.2))
const [MIN_RATING, MIN_COUNT] = arg('--gate', '4.2/80').split('/').map(Number)
const TYPES = new Set(arg('--types', 'coffee_shop,cafe,tea_house,bakery').split(',').map((s) => s.trim()))
const CITY_KEY = arg('--city', 'sf')
const MAX_PAGES = Number(arg('--pages', 3))
const CENSUS_ONLY = process.argv.includes('--census-only')
const FROM_CENSUS = process.argv.includes('--from-census') // reuse a saved census, skip text search
const BIAS_M = Number(arg('--bias', 700))
// Other food types found along the way (a brunch spot the grid missed) are
// kept only at the stricter general gate; non-food/bar types never.
const [EXTRA_RATING, EXTRA_COUNT] = arg('--extra-gate', '9/999999').split('/').map(Number)
const EXCLUDE = new Set(arg('--exclude-types', 'bar,cocktail_bar,sports_bar,convenience_store,association_or_organization,catering_service,tea_store').split(','))
if (!CENTERS.length) { console.error('Need --centers "lat,lng;lat,lng"'); process.exit(1) }

const existing = JSON.parse(readFileSync(join(root, 'data/restaurants.json'), 'utf8')).restaurants
const discoveredPath = join(root, 'data/discovered.json')
const discovered = existsSync(discoveredPath) ? JSON.parse(readFileSync(discoveredPath, 'utf8')) : []
const knownPlaceIds = new Set(discovered.map((d) => d.placeId))
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const mi = (a, b) => {
  const t = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * t) / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lng - a.lng) * t) / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}
// Same name within ~0.3 mi = the same place (chains elsewhere are new spots).
const inIndex = (name, loc) => existing.some((r) => norm(r.name) === norm(name) && mi(r, loc) < 0.3)
const centroid = { lat: CENTERS.reduce((a, c) => a + c[0], 0) / CENTERS.length, lng: CENTERS.reduce((a, c) => a + c[1], 0) / CENTERS.length }

let calls = 0
async function textSearch(query, [lat, lng], pageToken) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      'X-Goog-FieldMask':
        'nextPageToken,places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.primaryType,places.primaryTypeDisplayName,places.businessStatus,places.regularOpeningHours',
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: BIAS_M } },
    }),
  })
  calls++
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return await res.json()
}

async function details(id) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    headers: { ...authHeaders, 'X-Goog-FieldMask': 'editorialSummary,reviews,priceRange' },
  })
  calls++
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

// ---- Census ----
const censusPath = join(root, `data/pending/${NAME}.census.json`)
const hits = new Map()
if (FROM_CENSUS) for (const h of JSON.parse(readFileSync(censusPath, 'utf8'))) hits.set(h.placeId, h)
for (const center of FROM_CENSUS ? [] : CENTERS) {
  for (const q of QUERIES) {
    let token
    for (let page = 0; page < MAX_PAGES; page++) {
      let data
      try { data = await textSearch(q, center, token) } catch (e) { console.warn(`  ${q} @ ${center}: ${e.message.slice(0, 160)}`); break }
      let fresh = 0
      for (const p of data.places || []) {
        const loc = { lat: p.location.latitude, lng: p.location.longitude }
        if (mi(centroid, loc) > WITHIN) continue
        if (!hits.has(p.id)) fresh++
        const h = hits.get(p.id) || {
          placeId: p.id, name: p.displayName.text, address: p.formattedAddress.replace(/, USA$/, ''),
          lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5), rating: p.rating || 0, ratingCount: p.userRatingCount || 0,
          price: PRICE[p.priceLevel] || 2, mapsUrl: p.googleMapsUri, primaryType: p.primaryType || '',
          googleCategory: p.primaryTypeDisplayName?.text || '', operational: p.businessStatus === 'OPERATIONAL',
          hours: toHours(p.regularOpeningHours), distMi: +mi(centroid, loc).toFixed(2), queries: [],
        }
        if (!h.queries.includes(q)) h.queries.push(q)
        hits.set(p.id, h)
      }
      token = data.nextPageToken
      if (!token || !fresh) break
      await new Promise((s) => setTimeout(s, 150))
    }
  }
}

const all = [...hits.values()].map((h) => {
  const typeOk = TYPES.has(h.primaryType)
  const excluded = EXCLUDE.has(h.primaryType)
  const gateOk = h.operational && !excluded && (typeOk
    ? h.rating >= MIN_RATING && h.ratingCount >= MIN_COUNT
    : h.rating >= EXTRA_RATING && h.ratingCount >= EXTRA_COUNT)
  return { ...h, inIndex: inIndex(h.name, h), typeOk, gateOk }
})
mkdirSync(join(root, 'data/pending'), { recursive: true })
writeFileSync(censusPath, JSON.stringify(all, null, 1))
const accepted = all.filter((h) => !h.inIndex && h.gateOk && !knownPlaceIds.has(h.placeId))
const byType = {}
for (const h of all) byType[h.primaryType || '?'] = (byType[h.primaryType || '?'] || 0) + 1
console.log(`census: ${calls} text-search calls → ${all.length} places within ${WITHIN} mi`)
console.log(`  already indexed: ${all.filter((h) => h.inIndex).length}; type-ok: ${all.filter((h) => h.typeOk).length}; gate-ok (≥${MIN_RATING}/${MIN_COUNT}): ${all.filter((h) => h.gateOk).length}`)
console.log(`  NEW accepted (gate + not indexed): ${accepted.length} (${accepted.filter((h) => h.typeOk).length} target types + ${accepted.filter((h) => !h.typeOk).length} other food at ≥${EXTRA_RATING}/${EXTRA_COUNT})`)
console.log('  primary types:', JSON.stringify(byType))
console.log('  rejected by gate (type-ok, not indexed):', all.filter((h) => !h.inIndex && h.typeOk && !h.gateOk).map((h) => `${h.name} ${h.rating}/${h.ratingCount}`).slice(0, 40).join(' · '))
if (CENSUS_ONLY) process.exit(0)

// ---- Details for accepted candidates ----
let enriched = 0
const list = []
for (const h of accepted) {
  const d = await details(h.placeId)
  const c = {
    placeId: h.placeId, name: h.name, address: h.address, lat: h.lat, lng: h.lng, rating: h.rating, ratingCount: h.ratingCount,
    price: h.price,
    ...(d.priceRange?.startPrice?.units
      ? { priceRange: `$${d.priceRange.startPrice.units}${d.priceRange.endPrice?.units ? `–${d.priceRange.endPrice.units}` : '+'}` }
      : {}),
    mapsUrl: h.mapsUrl, googleCategory: h.googleCategory, hours: h.hours, cityKey: CITY_KEY,
    editorialSummary: d.editorialSummary?.text || '',
    reviews: (d.reviews || []).map((r) => [...(r.text?.text || '')].slice(0, 400).join('')).filter(Boolean).slice(0, 5),
  }
  if (c.reviews.length) enriched++
  list.push(c)
  await new Promise((s) => setTimeout(s, 80))
}
writeFileSync(discoveredPath, JSON.stringify([...discovered, ...list], null, 1))
writeFileSync(join(root, `data/pending/${NAME}.queue.json`), JSON.stringify(list, null, 1))
console.log(`details: ${enriched}/${list.length} with review texts; total API calls ${calls}`)
console.log(`appended ${list.length} to data/discovered.json; queue → data/pending/${NAME}.queue.json`)
