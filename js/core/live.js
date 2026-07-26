// BYOK live search: geocode an address and pull nearby restaurants straight
// from the Places API with the USER'S OWN key (stored only on-device; requests
// go browser → Google). Used when the user roams outside the indexed cities.

const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }

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

// Pure mapper — tested without network.
export function mapLivePlace(p) {
  const category = p.primaryTypeDisplayName?.text || 'Restaurant'
  const summary = p.editorialSummary?.text || ''
  return {
    id: `live-${p.id}`,
    live: true,
    name: p.displayName.text,
    cuisine: categoryToCuisine(category),
    neighborhood: '',
    city: (String(p.formattedAddress || '').match(/,\s*([A-Za-z .]+),\s*[A-Z]{2}/) || [])[1] || '',
    address: String(p.formattedAddress || '').replace(/, USA$/, ''),
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating || 0,
    ratingCount: p.userRatingCount || 0,
    price: PRICE[p.priceLevel] || 2,
    emoji: '🔎',
    signatureDish: {
      name: category.replace(/ restaurant$/i, '') || 'Local find',
      description: summary || 'Live Google result — menu research not yet available for this spot.',
    },
    menu: [],
    tags: [],
    why: summary,
    ...(toHoursCompact(p.regularOpeningHours) ? { hours: toHoursCompact(p.regularOpeningHours) } : {}),
    mapsUrl: p.googleMapsUri,
    googleCategory: category,
    verified: true,
  }
}

const FIELDS =
  'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.primaryTypeDisplayName,places.businessStatus,places.regularOpeningHours,places.editorialSummary'

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
  return places
    .filter((p) => p.businessStatus === 'OPERATIONAL' && (p.rating || 0) >= minRating && (p.userRatingCount || 0) >= minCount)
    .map(mapLivePlace)
}
