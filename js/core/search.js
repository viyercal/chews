// Client-side search over the index: weighted token scoring with prefix
// matching across names, dishes, menus, tags, and descriptions. No network —
// the editorial text is rich enough for dish queries to read as semantic.

const fold = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const tokenize = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean)

// Naive singular so "burgers" finds "burger" (and vice versa via query side).
const sing = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)

const FIELDS = [
  { weight: 10, get: (r) => r.name, label: 'name' },
  { weight: 8, get: (r) => r.signatureDish?.name, label: 'dish' },
  { weight: 6, get: (r) => (r.menu || []).map((m) => m.name).join(' '), label: 'dish' },
  { weight: 5, get: (r) => r.cuisine, label: 'cuisine' },
  { weight: 4, get: (r) => (r.tags || []).join(' '), label: 'tag' },
  { weight: 3, get: (r) => `${r.neighborhood || ''} ${r.city || ''}`, label: 'place' },
  {
    weight: 1.5,
    get: (r) => [r.signatureDish?.description, ...(r.menu || []).map((m) => m.description), r.why].join(' '),
    label: 'text',
  },
]

export function buildSearchIndex(restaurants) {
  return restaurants.map((resto) => ({
    resto,
    nameText: fold(resto.name),
    fields: FIELDS.map((f) => ({
      weight: f.weight,
      label: f.label,
      tokens: tokenize(f.get(resto) || '').map(sing),
    })),
  }))
}

// Best score one query token earns in one entry: exact token match at full
// field weight, prefix match at 70%.
function tokenScore(entry, qt) {
  let best = 0
  for (const f of entry.fields) {
    if (f.weight <= best) continue
    for (const t of f.tokens) {
      if (t === qt) { best = Math.max(best, f.weight); break }
      if (t.startsWith(qt)) best = Math.max(best, f.weight * 0.7)
    }
  }
  return best
}

export function search(index, query, { limit = 20 } = {}) {
  const qts = [...new Set(tokenize(query).map(sing))]
  if (!qts.length) return []
  const qFull = fold(query).trim()

  const scored = []
  for (const entry of index) {
    const per = qts.map((qt) => tokenScore(entry, qt))
    const matched = per.filter((s) => s > 0).length
    if (!matched) continue
    // Every token matching is worth far more than one strong hit ("spicy
    // noodles" should beat a plain "noodles" place) — but partial matches
    // still surface when nothing matches fully.
    let score = per.reduce((a, b) => a + b, 0) * (matched === qts.length ? 1 : 0.25 * (matched / qts.length))
    if (qFull.length >= 3 && entry.nameText.includes(qFull)) score += 6 // whole-phrase name hit
    score += Math.min(1, (entry.resto.rating - 4) || 0) // faint quality tiebreak
    scored.push({ resto: entry.resto, score, full: matched === qts.length })
  }
  scored.sort((a, b) => b.score - a.score)
  // If anything matches every token, partial matches are noise — drop them.
  const cut = scored.some((s) => s.full) ? scored.filter((s) => s.full) : scored
  return cut.slice(0, limit)
}
