// Couple Mode — zero-backend "decide together": sender's shortlist rides in
// the URL hash; the receiver swipes it and the overlap goes to Face-off.

const MAX_IDS = 12

const b64urlEncode = (s) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlDecode = (t) => {
  const b64 = t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeDuo({ ids, loc }) {
  const payload = {
    v: 1,
    ids: ids.filter((id) => !String(id).startsWith('live-')).slice(0, MAX_IDS),
    ...(loc && Number.isFinite(loc.lat) ? { loc: { lat: +loc.lat.toFixed(4), lng: +loc.lng.toFixed(4) } } : {}),
  }
  if (payload.ids.length < 2) return null // a duo needs a real shortlist
  return b64urlEncode(JSON.stringify(payload))
}

export function decodeDuo(token) {
  try {
    const p = JSON.parse(b64urlDecode(token))
    if (p?.v !== 1 || !Array.isArray(p.ids)) return null
    p.ids = p.ids.filter((x) => typeof x === 'string').slice(0, MAX_IDS)
    if (p.ids.length < 1) return null
    if (p.loc && !(Number.isFinite(p.loc.lat) && Number.isFinite(p.loc.lng))) delete p.loc
    return p
  } catch {
    return null
  }
}

export function duoTokenFromHash(hash) {
  const m = String(hash || '').match(/#duo=([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

export function duoLink(payload) {
  const token = encodeDuo(payload)
  if (!token) return null
  return `${location.origin}${location.pathname}${location.search}#duo=${token}`
}
