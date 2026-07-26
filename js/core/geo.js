const EARTH_RADIUS_MI = 3958.8
const toRad = (deg) => (deg * Math.PI) / 180

export function milesBetween(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h))
}

export function fmtMiles(mi) {
  if (mi < 0.15) return 'right here'
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

// Rejects with { reason } so callers can explain WHY instead of shrugging:
// 'policy'      — the embedding page (e.g. a hosted preview iframe) forbids
//                 geolocation entirely; no prompt will ever appear
// 'denied'      — the user (or browser setting) refused the prompt
// 'unavailable' — no position fix available
// 'timeout'     — no fix within the deadline
export function locate({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject({ reason: 'unsupported' })
    try {
      if (document.featurePolicy && !document.featurePolicy.allowsFeature('geolocation')) {
        return reject({ reason: 'policy' })
      }
    } catch {}
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' }),
      (err) => reject({ reason: err.code === 1 ? 'denied' : err.code === 2 ? 'unavailable' : 'timeout' }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
    )
  })
}

export const locateFailureCopy = (reason) =>
  reason === 'policy'
    ? 'This hosted preview can’t access location — pick a spot instead (the standalone app can).'
    : reason === 'denied'
      ? 'Location permission was denied — allow it in your browser settings, or pick a spot.'
      : reason === 'unsupported'
        ? 'This browser has no location support — pick a spot instead.'
        : 'Couldn’t get a location fix — try again or pick a spot.'

// Demo/fallback locations when GPS is denied or the user is outside coverage.
export const FALLBACK_SPOTS = [
  { name: 'SF · Mission', lat: 37.7599, lng: -122.4148 },
  { name: 'SF · Downtown', lat: 37.7879, lng: -122.4074 },
  { name: 'Oakland', lat: 37.8044, lng: -122.2712 },
  { name: 'Berkeley', lat: 37.8715, lng: -122.273 },
  { name: 'Palo Alto', lat: 37.4419, lng: -122.143 },
  { name: 'San Jose', lat: 37.3362, lng: -121.8906 },
]

// Nearest fallback spot, used to suggest demo mode when the user is far away.
export function nearestSpot(loc) {
  let best = FALLBACK_SPOTS[0]
  let bestD = Infinity
  for (const s of FALLBACK_SPOTS) {
    const d = milesBetween(loc, s)
    if (d < bestD) { bestD = d; best = s }
  }
  return { spot: best, miles: bestD }
}
