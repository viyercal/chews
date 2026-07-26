import { fmtMiles } from '../core/geo.js'
import { hoursStatus } from '../core/hours.js'

const VEG_TAGS = ['vegetarian-friendly', 'vegan-friendly']

export function openChip(resto, now = new Date()) {
  const s = hoursStatus(resto, now)
  if (s.status === 'open') {
    return `<span class="chip chip-status ${s.closingSoon ? 'soon' : 'open'}">● ${s.closingSoon ? `closes ${esc(s.closesAt)}` : `open til ${esc(s.closesAt)}`}</span>`
  }
  if (s.status === 'closed') return `<span class="chip chip-status closed">● closed · opens ${esc(s.opensAt)}</span>`
  // Unknown must be explicit — silence would read as "open" next to cards
  // that carry real status chips.
  return '<span class="chip chip-status unknown">hours unknown</span>'
}

// Restaurant-level attribute — worded and placed so it can never read as a
// claim about the specific dish on the card (a chicken stew at a veg-friendly
// restaurant must not look vegan).
export const vegChip = (resto) =>
  (resto.tags || []).some((t) => VEG_TAGS.includes(t)) ? '<span class="chip chip-veg">🌿 veg options</span>' : ''

// Dark duotone grounds per cuisine — cream text stays readable on all of them.
const GRADIENTS = {
  Mexican: ['#542312', '#8a3a1b'],
  Salvadoran: ['#2d3313', '#4f5921'],
  Peruvian: ['#3d1a2a', '#692e49'],
  Chinese: ['#4a1220', '#7d1f35'],
  'Dim Sum': ['#4a1220', '#7d1f35'],
  Sichuan: ['#4a1210', '#7d211c'],
  Japanese: ['#1f2247', '#3b3f78'],
  Sushi: ['#1c3a45', '#2e5d6b'],
  Ramen: ['#2f1f3d', '#52366b'],
  Korean: ['#4a1626', '#7c2745'],
  Italian: ['#1e3b2a', '#386549'],
  Pizza: ['#45210f', '#713a17'],
  Thai: ['#3f2c0e', '#6d4e14'],
  Vietnamese: ['#173f33', '#2c6b52'],
  Malaysian: ['#2e3a12', '#52661f'],
  Singaporean: ['#2e3a12', '#52661f'],
  Burmese: ['#3f2f10', '#6b521c'],
  Indian: ['#451a0a', '#78300f'],
  Filipino: ['#3a2410', '#653f1c'],
  'New American': ['#2b2334', '#4d3f5e'],
  Californian: ['#243a1e', '#426b36'],
  Seafood: ['#10344a', '#1f5a7a'],
  Steakhouse: ['#331414', '#5c2424'],
  Burgers: ['#3a1e10', '#66371c'],
  Sandwiches: ['#333013', '#595421'],
  Mediterranean: ['#16324a', '#2a577c'],
  'Middle Eastern': ['#3d2c14', '#6a4e22'],
  Ethiopian: ['#3f1d10', '#6f351a'],
  French: ['#2c2140', '#4e3b6e'],
  Spanish: ['#45150f', '#75281a'],
  Greek: ['#143355', '#265a8f'],
  Cafe: ['#33251a', '#59422e'],
  Bakery: ['#3e2c1c', '#6b4e32'],
  Dessert: ['#3a1530', '#652a55'],
  Breakfast: ['#3e2a10', '#6b4a1c'],
  Vegan: ['#1d3a22', '#35653d'],
  Vegetarian: ['#1d3a22', '#35653d'],
  'Soul Food': ['#3a2a10', '#654a1c'],
  Caribbean: ['#123a2e', '#226551'],
  Hawaiian: ['#10333a', '#1e5a66'],
}

const FALLBACKS = [
  ['#2b2334', '#4d3f5e'],
  ['#3d2c14', '#6a4e22'],
  ['#16324a', '#2a577c'],
  ['#3a1530', '#652a55'],
  ['#243a1e', '#426b36'],
]

export function cuisineGradient(cuisine) {
  if (GRADIENTS[cuisine]) return GRADIENTS[cuisine]
  let h = 0
  for (const ch of String(cuisine)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACKS[h % FALLBACKS.length]
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

// Verbatim Google Maps review count — matches what users see if they click
// through to Maps.
export function fmtCount(n) {
  if (!n) return ''
  return Number(n).toLocaleString('en-US')
}

export const priceStr = (p) => '$'.repeat(Math.max(1, Math.min(4, p || 2)))

// Plain "$$" exactly as Google Maps shows it — dimmed-remainder styling read
// as ambiguous in persona testing.
export function priceHtml(p) {
  return priceStr(p)
}

export function mapsUrl(resto) {
  // Prefer the canonical listing link so the user lands on the exact place
  // whose rating/price/hours we show.
  if (resto.mapsUrl && /^https:\/\/(www\.)?google\.com\/maps/.test(resto.mapsUrl)) return resto.mapsUrl
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${resto.name} ${resto.address} ${resto.city || ''}`.trim())}`
}

export function renderCard(resto, distanceMi) {
  const [g1, g2] = cuisineGradient(resto.cuisine)
  return el(`
    <article class="card" style="--g1:${g1};--g2:${g2}" data-id="${esc(resto.id)}">
      <div class="card-emoji" aria-hidden="true">${esc(resto.emoji || '🍽️')}</div>
      <div class="stamp stamp-yum" aria-hidden="true">YUM</div>
      <div class="stamp stamp-pass" aria-hidden="true">PASS</div>
      <div class="card-content">
        <div class="chip-row">
          <span class="chip chip-cuisine">${esc(resto.cuisine)}</span>
          <span class="chip chip-price">${priceHtml(resto.price)}</span>
          ${distanceMi != null ? `<span class="chip">${esc(fmtMiles(distanceMi))}</span>` : ''}
          ${openChip(resto)}${resto.live ? '<span class="chip chip-live">🔎 live</span>' : ''}
        </div>
        <h2 class="card-dish">${esc(resto.signatureDish?.name || resto.name)}</h2>
        <p class="card-desc">${esc(resto.signatureDish?.description || '')}</p>
        <div class="card-resto">
          <span class="card-name">${esc(resto.name)}${vegChip(resto)}</span>
          <span class="card-rating">★ ${Number(resto.rating).toFixed(1)}<em> · ${fmtCount(resto.ratingCount)}</em></span>
        </div>
        <div class="card-hint">tap for the menu</div>
      </div>
    </article>
  `)
}

export function renderMiniCard(resto, distanceMi) {
  const [g1, g2] = cuisineGradient(resto.cuisine)
  return el(`
    <button class="mini-card" style="--g1:${g1};--g2:${g2}" data-id="${esc(resto.id)}">
      <span class="mini-emoji" aria-hidden="true">${esc(resto.emoji || '🍽️')}</span>
      <span class="mini-body">
        <span class="mini-dish">${esc(resto.signatureDish?.name || '')}</span>
        <span class="mini-name">${esc(resto.name)}</span>
        <span class="mini-meta">${esc(resto.cuisine)} · ★ ${Number(resto.rating).toFixed(1)}${distanceMi != null ? ` · ${esc(fmtMiles(distanceMi))}` : ''}</span>
      </span>
    </button>
  `)
}
