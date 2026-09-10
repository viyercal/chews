// Client-side search over the index: weighted token scoring with prefix
// matching across names, dishes, menus, tags, and descriptions. No network —
// the editorial text is rich enough for dish queries to read as semantic.

const fold = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const APOS = /['’‘`]/g
const split = (s) => s.split(/[^a-z0-9]+/).filter(Boolean)

// Apostrophes are collapsed so "Sana’a" is one token ("sanaa") and a query
// typed as sanaa / sana'a / sana all land on it. The index also keeps the
// split form ("sana", "a") so "farrell" still finds O'Farrell.
const tokenizeQuery = (s) => split(fold(s).replace(APOS, ''))
const tokenizeIndex = (s) => { const f = fold(s); return [...new Set([...split(f.replace(APOS, '')), ...split(f)])] }

// One-edit tolerance (substitution, insertion, or deletion) — the typo
// fallback for tokens with no exact or prefix hit.
function within1(a, b) {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (la > lb) i++
    else if (lb > la) j++
    else { i++; j++ }
  }
  return edits + (la - i) + (lb - j) <= 1
}
const FUZZY_MIN = 4 // shorter tokens have too many one-edit neighbours
// A name-aimed query lands on a handful of places (a chain's locations at
// most); "coffee" landing on sixty names is a category word, not a name.
const NAME_HIT_MAX = 8

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
    nameText: fold(resto.name).replace(APOS, ''),
    nameTokens: tokenizeIndex(resto.name).map(sing),
    fields: FIELDS.map((f) => ({
      weight: f.weight,
      label: f.label,
      tokens: tokenizeIndex(f.get(resto) || '').map(sing),
    })),
  }))
}

// How well one query token fits a token list: exact 1, prefix 0.7, one
// typo away 0.5 (only as a fallback when nothing exact/prefix hits).
function fit(tokens, qt) {
  let best = 0
  for (const t of tokens) {
    if (t === qt) return 1
    if (t.startsWith(qt)) best = Math.max(best, 0.7)
  }
  if (!best && qt.length >= FUZZY_MIN) {
    for (const t of tokens) if (t.length >= FUZZY_MIN && within1(t, qt)) return 0.5
  }
  return best
}

// Best score one query token earns in one entry across the weighted fields.
function tokenScore(entry, qt) {
  let best = 0
  for (const f of entry.fields) {
    if (f.weight <= best) continue
    best = Math.max(best, f.weight * fit(f.tokens, qt))
  }
  return best
}

// `nameHit`: the query is aimed at this place by name (every token lands in
// the name, or the whole phrase does) — the UI keeps such hits visible even
// when the time frame would hide them as closed.
export function search(index, query, { limit = 20 } = {}) {
  const qts = [...new Set(tokenizeQuery(query).map(sing))]
  if (!qts.length) return []
  const qFull = fold(query).replace(APOS, '').trim()

  const scored = []
  for (const entry of index) {
    const per = qts.map((qt) => tokenScore(entry, qt))
    const matched = per.filter((s) => s > 0).length
    if (!matched) continue
    // Every token matching is worth far more than one strong hit ("spicy
    // noodles" should beat a plain "noodles" place) — but partial matches
    // still surface when nothing matches fully.
    let score = per.reduce((a, b) => a + b, 0) * (matched === qts.length ? 1 : 0.25 * (matched / qts.length))
    const phrase = qFull.length >= 3 && entry.nameText.includes(qFull)
    if (phrase) score += 6 // whole-phrase name hit
    score += Math.min(1, (entry.resto.rating - 4) || 0) // faint quality tiebreak
    const nameHit = phrase || qts.every((qt) => fit(entry.nameTokens, qt) > 0)
    scored.push({ resto: entry.resto, score, full: matched === qts.length, nameHit })
  }
  if (scored.filter((s) => s.nameHit).length > NAME_HIT_MAX) for (const s of scored) s.nameHit = false
  scored.sort((a, b) => b.score - a.score)
  // If anything matches every token, partial matches are noise — drop them.
  const cut = scored.some((s) => s.full) ? scored.filter((s) => s.full) : scored
  return cut.slice(0, limit)
}
