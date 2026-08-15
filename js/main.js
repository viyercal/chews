import { RESTAURANTS, DATA_META } from './data/restaurants.gen.js'
import { Store } from './core/store.js'
import { TasteEngine } from './core/engine.js'
import { Deck } from './core/deck.js'
import { Sheet } from './ui/sheet.js'
import { initToast } from './ui/toast.js'
import { DiscoverView } from './ui/discover.js'
import { MatchesView } from './ui/matches.js'
import { Faceoff } from './ui/faceoff.js'
import { ProfileView } from './ui/profile.js'
import { showOnboarding } from './ui/onboarding.js'
import { DuoView } from './ui/duo.js'
import { duoTokenFromHash, decodeDuo } from './core/duo.js'
import { SearchView } from './ui/search.js'
import { CuisineFilter } from './ui/cuisines.js'

const $ = (sel) => document.querySelector(sel)

const store = new Store()
store.load()

// URL override for QA/demos: ?loc=lat,lng — session-only, never persisted, so
// opening a shared link can't clobber a real user's saved location.
const locParam = new URLSearchParams(location.search).get('loc')
if (locParam) {
  const [lat, lng] = locParam.split(',').map(Number)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    store.session.location = { lat, lng, source: 'manual', label: 'Custom spot' }
    store.session.onboarded = true
  }
}

const engine = TasteEngine.fromJSON(store.state.taste)
// Cached live-search finds ride alongside the indexed dataset so matches made
// while traveling stay resolvable (radius filtering keeps them out otherwise).
const liveExtras = Object.values(store.state.liveCache || {})
const byId = Object.fromEntries([...RESTAURANTS, ...liveExtras].map((r) => [r.id, r]))
store.pruneTo(new Set(RESTAURANTS.map((r) => r.id))) // drop ids gone after a data refresh
const deck = new Deck({ restaurants: [...RESTAURANTS, ...liveExtras], store, engine })

initToast($('#toast-root'))
const sheet = new Sheet($('#sheet-root'))
const faceoff = new Faceoff($('#faceoff-root'), { store })

const updateBadge = () => {
  const badge = $('#tab-matches .tab-badge')
  const n = store.matches.length
  badge.textContent = n
  badge.classList.toggle('show', n > 0)
}

const discover = new DiscoverView({
  stackEl: $('#stack'),
  actionsEl: $('#deck-actions'),
  deck,
  store,
  sheet,
  onSwiped: () => updateBadge(),
})

const searchView = new SearchView({
  root: $('#overlay-root'),
  deck,
  store,
  sheet,
  onSwiped: () => {
    updateBadge()
    discover.refresh()
  },
})

const paintCuisinePill = () => {
  const n = (store.settings.cuisines || []).length
  const b = $('#btn-cuisine')
  b.classList.toggle('on', n > 0)
  b.textContent = n ? `🍜 ${n}` : '🍜'
}

const cuisineFilter = new CuisineFilter({
  root: $('#overlay-root'),
  store,
  deck,
  onChanged: () => {
    paintCuisinePill()
    discover.refresh()
  },
})

$('#btn-search').addEventListener('click', () => searchView.open())
$('#btn-cuisine').addEventListener('click', () => cuisineFilter.open())

const matches = new MatchesView({
  root: $('#view-matches'),
  store,
  byId,
  sheet,
  faceoff,
  deck,
  onChanged: () => {
    updateBadge()
    discover.refresh() // meal verdicts, removals, and hides re-rank the deck
  },
})

const profile = new ProfileView({
  root: $('#view-taste'),
  store,
  engine,
  deck,
  dataMeta: DATA_META,
  onSettingsChanged: () => {
    discover.refresh()
    updateLocPill()
  },
  onReset: () => {
    store.reset()
    engine.cuisines = Object.create(null)
    engine.tags = Object.create(null)
    engine.prices = Object.create(null)
    engine.total = 0
    location.reload()
  },
})

// --- Tabs ---
const views = {
  discover: { el: $('#view-discover'), tab: $('#tab-discover'), onShow: () => {} },
  matches: { el: $('#view-matches'), tab: $('#tab-matches'), onShow: () => matches.render() },
  taste: { el: $('#view-taste'), tab: $('#tab-taste'), onShow: () => profile.render() },
}
let current = 'discover'

function go(name) {
  current = name
  for (const [key, v] of Object.entries(views)) {
    v.el.classList.toggle('hidden', key !== name)
    v.tab.setAttribute('aria-selected', String(key === name))
  }
  $('#deck-controls').classList.toggle('hidden', name !== 'discover')
  views[name].onShow()
}
for (const [key, v] of Object.entries(views)) v.tab.addEventListener('click', () => go(key))

// --- Mode segment ---
const modeSeg = $('#mode-seg')
function paintMode() {
  modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === store.settings.mode)))
}
modeSeg.querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => {
    if (store.settings.mode === b.dataset.mode) return
    store.setSetting('mode', b.dataset.mode)
    paintMode()
    discover.refresh()
  })
)
discover.onModeChanged = paintMode
discover.onOpenFilters = () => go('taste')
discover.onCuisineCleared = paintCuisinePill

// --- Location pill ---
function updateLocPill() {
  const s = store.settings
  $('#loc-pill').textContent = `${s.location?.label || 'Set location'} · ${s.radiusMi} mi`
}
$('#loc-pill').addEventListener('click', () => go('taste'))

// --- Keyboard (desktop niceness) ---
let activeDuo = null // Couple Mode session, when an invite is open

document.addEventListener('keydown', (e) => {
  if (e.repeat) return // a held arrow key must not machine-gun swipes
  if (activeDuo?.controller) {
    if (e.key === 'ArrowLeft') activeDuo.controller.fling(-1)
    else if (e.key === 'ArrowRight') activeDuo.controller.fling(1)
    return
  }
  if (searchView.isOpen || cuisineFilter.isOpen) return // dialogs own the keys
  if (current !== 'discover' || sheet.isOpen) {
    if (e.key === 'Escape') sheet.close()
    return
  }
  if (e.key === 'ArrowLeft') discover.controller?.fling(-1)
  else if (e.key === 'ArrowRight') discover.controller?.fling(1)
  else if (e.key === 'ArrowUp') discover.openSheet()
  else if (e.key === 'z') discover.undo()
})

// --- Boot ---
paintMode()
updateBadge()
updateLocPill()
go('discover')

// Top cuisines by dataset coverage — the onboarding taste-seed choices.
const seedChoices = Object.entries(
  RESTAURANTS.reduce((m, r) => ((m[r.cuisine] = (m[r.cuisine] || 0) + 1), m), {})
)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([c]) => c)

const applySeed = (cuisines) => {
  engine.seedCuisines(cuisines)
  store.saveTaste(engine.toJSON())
  discover.refresh()
}
// QA hook — lets the persona driver seed explicit preferences like a user would.
window.__chewsSeed = applySeed

const startNormally = () => {
  if (!store.settings.onboarded || !store.settings.location) {
    showOnboarding($('#onboarding-root'), {
      store,
      seedChoices,
      onSeed: applySeed,
      onDone: () => {
        updateLocPill()
        discover.refresh()
      },
    })
  } else {
    discover.refresh()
  }
}

// Couple Mode invite (#duo=…): the receiver swipes the sender's shortlist
// FIRST — no onboarding gate; their first touch of the app is deciding dinner.
const duoToken = duoTokenFromHash(location.hash)
const duoPayload = duoToken && decodeDuo(duoToken)
if (duoPayload) {
  history.replaceState(null, '', location.pathname + location.search) // don't re-trigger on reload
  const duo = new DuoView({
    root: $('#faceoff-root'),
    byId,
    engine,
    store,
    faceoff,
    onExit: () => {
      activeDuo = null
      store.saveTaste(engine.toJSON())
      startNormally()
    },
  })
  activeDuo = duo
  duo.start(duoPayload)
} else {
  startNormally()
}
