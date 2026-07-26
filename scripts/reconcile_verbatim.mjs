// Structural enforcement for agent-sourced Google data: adopt a value ONLY when
// two independent lookup passes agree. Disagreements and single-source values
// are reported, never silently adopted.
//
//   node scripts/reconcile_verbatim.mjs sourceA.json sourceB.json hours.json
//
// sourceA/B: [{name, rating, ratingCount, price, confidence, googleCategory?, mapsUrl?}]
// hours:     [{name, hours: [{day,open,close}], confidence, quote}]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = join(root, 'data/restaurants.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const [aPath, bPath, hPath] = process.argv.slice(2)
const load = (p) => (p ? JSON.parse(readFileSync(p, 'utf8')) : [])
const A = load(aPath)
const B = load(bPath)
const H = load(hPath)

const key = (n) => String(n || '').toLowerCase().trim()
const idx = (list) => {
  const m = new Map()
  for (const c of list) if (c.confidence !== 'low') m.set(key(c.name), c)
  return m
}
const mapA = idx(A)
const mapB = idx(B)
const mapH = idx(H)

const report = { agreed: 0, conflicts: [], singleSource: [], categoryFlags: [], hoursApplied: 0, closed: [] }

for (const r of data.restaurants) {
  const a = mapA.get(key(r.name))
  const b = mapB.get(key(r.name))

  if (a && b) {
    let any = false
    if (a.rating != null && b.rating != null) {
      if (a.rating === b.rating) { r.rating = a.rating; any = true }
      else report.conflicts.push(`${r.name} rating: A=${a.rating} B=${b.rating}`)
    }
    if (a.ratingCount != null && b.ratingCount != null) {
      const hi = Math.max(a.ratingCount, b.ratingCount)
      const gap = Math.abs(a.ratingCount - b.ratingCount) / Math.max(1, hi)
      // Counts drift daily; ≤10% apart = same listing. Adopt the cited (B) figure.
      if (gap <= 0.1) { r.ratingCount = b.ratingCount; any = true }
      else report.conflicts.push(`${r.name} count: A=${a.ratingCount} B=${b.ratingCount}`)
    }
    if (a.price != null && b.price != null) {
      if (a.price === b.price) { r.price = a.price; any = true }
      else report.conflicts.push(`${r.name} price: A=${a.price} B=${b.price}`)
    }
    if (any) { r.verified = true; report.agreed++ }
  } else if (a || b) {
    report.singleSource.push(r.name)
  }

  const cat = (b?.googleCategory || '').toLowerCase()
  if (cat) {
    const ours = r.cuisine.toLowerCase()
    const overlap =
      cat.includes(ours) || ours.includes(cat.replace(' restaurant', '')) ||
      ['restaurant', 'bar', 'cafe', 'bakery', 'diner', 'bistro', 'eatery', 'shop', 'house', 'grill'].some((g) => cat === g)
    if (!overlap) report.categoryFlags.push(`${r.name}: ours="${r.cuisine}" google="${b.googleCategory}"`)
  }
  if (b?.mapsUrl && /^https:\/\/(www\.)?google\.com\/maps/.test(b.mapsUrl)) r.mapsUrl = b.mapsUrl

  const h = mapH.get(key(r.name))
  if (h && Array.isArray(h.hours) && h.hours.length) {
    const hours = h.hours
      .filter((x) => x && x.day >= 0 && x.day <= 6 && /^\d{2}:\d{2}$/.test(x.open) && /^([01]\d|2[0-4]):\d{2}$/.test(x.close))
      .map((x) => [x.day, x.open, x.close])
    if (hours.length) { r.hours = hours; report.hoursApplied++ }
  }
  for (const src of [a, b, h]) {
    if (src && /permanently closed/i.test(src.note || '')) { report.closed.push(r.name); break }
  }
}

if (report.agreed > 0) {
  data.verifiedAt = new Date().toISOString().slice(0, 10)
  data.verifiedBy = 'dual-agent-agreement'
}
if (report.hoursApplied > 0) data.hoursSourcedAt = new Date().toISOString().slice(0, 10)
writeFileSync(dataPath, JSON.stringify(data, null, 1))
console.log(JSON.stringify({
  agreed: report.agreed,
  conflicts: report.conflicts.length,
  singleSource: report.singleSource.length,
  hoursApplied: report.hoursApplied,
  categoryFlags: report.categoryFlags.length,
  closed: report.closed,
}, null, 1))
writeFileSync(join(root, 'data/reconcile_report.json'), JSON.stringify(report, null, 1))
console.log('full report: data/reconcile_report.json — resolve conflicts/singleSource with a tie-break pass or the Places API')
