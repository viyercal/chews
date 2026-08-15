// BYOK live search: geocode an address and pull nearby restaurants straight
// from the Places API with the USER'S OWN key (stored only on-device; requests
// go browser → Google). Used when the user roams outside the indexed cities.

const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }

// Quality bar is the only gate — chains included by owner decision (2026-07-26):
// if a spot clears the rating/review bar, it deals, whoever owns it.
export function passesLiveQuality(p, { minRating = 4.2, minCount = 100 } = {}) {
  return (
    p.businessStatus === 'OPERATIONAL' &&
    (p.rating || 0) >= minRating &&
    (p.userRatingCount || 0) >= minCount
  )
}

const CUISINE_EMOJI = {
  Mexican: '🌮', Chinese: '🥡', 'Dim Sum': '🥟', Japanese: '🍣', Sushi: '🍣', Ramen: '🍜',
  Korean: '🍖', Italian: '🍝', Pizza: '🍕', Thai: '🍛', Vietnamese: '🍜', Indian: '🍛',
  Seafood: '🦞', Steakhouse: '🥩', Burgers: '🍔', Sandwiches: '🥪', Mediterranean: '🥙',
  'Middle Eastern': '🧆', French: '🥖', Greek: '🥙', Cafe: '☕', Bakery: '🥐', Dessert: '🍨',
  Breakfast: '🍳', Vegan: '🥗', Hawaiian: '🍧', 'New American': '🍽️', Californian: '🥗',
}

const CATEGORY_TO_CUISINE = {
  mexican: 'Mexican', chinese: 'Chinese', japanese: 'Japanese', sushi: 'Sushi', ramen: 'Ramen',
  korean: 'Korean', italian: 'Italian', pizza: 'Pizza', thai: 'Thai', vietnamese: 'Vietnamese',
  indian: 'Indian', filipino: 'Filipino', mediterranean: 'Mediterranean', 'middle eastern': 'Middle Eastern',
  ethiopian: 'Ethiopian', french: 'French', spanish: 'Spanish', greek: 'Greek', seafood: 'Seafood',
  steak: 'Steakhouse', burger: 'Burgers', sandwich: 'Sandwiches', cafe: 'Cafe', coffee: 'Cafe',
  bakery: 'Bakery', dessert: 'Dessert', 'ice cream': 'Dessert', breakfast: 'Breakfast', brunch: 'Breakfast',
  vegan: 'Vegan', vegetarian: 'Vegan', hawaiian: 'Hawaiian', caribbean: 'Caribbean', american: 'New American',
  californian: 'Californian', peruvian: 'Peruvian', salvadoran: 'Salvadoran', burmese: 'Burmese', malaysian: 'Malaysian',
}

export function categoryToCuisine(category) {
  const c = String(category || '').toLowerCase()
  for (const [k, v] of Object.entries(CATEGORY_TO_CUISINE)) if (c.includes(k)) return v
  return 'New American'
}

export function toHoursCompact(reg) {
  if (!reg?.periods) return undefined
  const out = reg.periods
    .filter((p) => p.open)
    .map((p) => [
      p.open.day,
      `${String(p.open.hour).padStart(2, '0')}:${String(p.open.minute || 0).padStart(2, '0')}`,
      p.close ? `${String(p.close.hour).padStart(2, '0')}:${String(p.close.minute || 0).padStart(2, '0')}` : '24:00',
    ])
  return out.length ? out : undefined
}

// Pure mapper — tested without network. Live finds have NO researched dish:
// the card hero is the cuisine, the description is Google's own summary, and
// the sheet renders a dedicated live-result section instead of a fake dish.
export function mapLivePlace(p) {
  const category = p.primaryTypeDisplayName?.text || 'Restaurant'
  const summary = p.editorialSummary?.text || ''
  const cuisine = categoryToCuisine(category)
  return {
    id: `live-${p.id}`,
    live: true,
    name: p.displayName.text,
    cuisine,
    neighborhood: '',
    city: (String(p.formattedAddress || '').match(/,\s*([A-Za-z .]+),\s*[A-Z]{2}/) || [])[1] || '',
    address: String(p.formattedAddress || '').replace(/, USA$/, ''),
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating || 0,
    ratingCount: p.userRatingCount || 0,
    price: PRICE[p.priceLevel] || 2,
    ...(p.priceRange?.startPrice?.units
      ? { priceRange: `$${p.priceRange.startPrice.units}${p.priceRange.endPrice?.units ? `–${p.priceRange.endPrice.units}` : '+'}` }
      : {}),
    emoji: CUISINE_EMOJI[cuisine] || '🍽️',
    signatureDish: {
      name: cuisine,
      description: summary || `A well-rated ${cuisine.toLowerCase()} spot from live Google results.`,
    },
    menu: [],
    tags: [],
    why: '',
    liveSummary: summary,
    ...(toHoursCompact(p.regularOpeningHours) ? { hours: toHoursCompact(p.regularOpeningHours) } : {}),
    mapsUrl: p.googleMapsUri,
    googleCategory: category,
    verified: true,
  }
}

const FIELDS =
  'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,places.regularOpeningHours,places.editorialSummary'

export async function geocodeAddress(query, key) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.location,places.formattedAddress,places.displayName' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  })
  if (!res.ok) throw new Error(`geocode failed (${res.status})`)
  const p = (await res.json()).places?.[0]
  if (!p) throw new Error('no match for that address')
  return { lat: p.location.latitude, lng: p.location.longitude, label: p.displayName?.text || p.formattedAddress }
}

// Center + up to 6 ring cells ~3.5km out: covers a ~3.5mi disc with one call
// each, so a whole rescue pull stays a few tens of cents.
export function ringCenters(lat, lng, cells = 7, ringMeters = 3500) {
  const centers = [[lat, lng]]
  for (let i = 0; i < 6 && centers.length < cells; i++) {
    const b = (i * Math.PI) / 3
    centers.push([
      lat + (ringMeters * Math.cos(b)) / 111320,
      lng + (ringMeters * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180)),
    ])
  }
  return centers.slice(0, cells)
}

// Out-of-coverage rescue: a small budgeted sweep around the user. Relaxed
// quality gate — this is coverage of last resort, and ranking sorts the rest.
export async function liveRescue({ lat, lng, key, cells = 7, cellRadiusM = 2200, minRating = 4.0, minCount = 50 }) {
  const seen = new Set()
  const found = []
  let calls = 0
  for (const [la, ln] of ringCenters(lat, lng, cells)) {
    try {
      const batch = await liveSearch({ lat: la, lng: ln, key, radiusMeters: cellRadiusM, minRating, minCount })
      calls++
      for (const r of batch) if (!seen.has(r.id)) { seen.add(r.id); found.push(r) }
    } catch (e) {
      if (calls === 0) throw e // first call failing = key/CSP problem, surface it
      break // partial results beat burning budget on a flaking network
    }
  }
  return { found, calls }
}

export async function liveSearch({ lat, lng, key, radiusMeters = 4000, minRating = 4.2, minCount = 100 }) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    }),
  })
  if (!res.ok) throw new Error(`live search failed (${res.status})`)
  const places = (await res.json()).places || []
  return places.filter((p) => passesLiveQuality(p, { minRating, minCount })).map(mapLivePlace)
}
