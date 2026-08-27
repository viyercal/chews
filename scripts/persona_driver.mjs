// Drives a simulated user ("persona") through the built Chews app in a
// persistent headless Chrome via CDP: adaptive swiping based on the visible
// card, sheet browsing, mode/radius changes, face-off, visit marking.
// Emits transcript.json (every card + decision + stats) and screenshots.
//
//   node scripts/persona_driver.mjs --persona persona.json --out outdir \
//        [--app dist/chews.html] [--swipes 30]
//
// persona.json:
// { "name": "Neha", "loc": "37.7599,-122.4148", "radiusMi": 10,
//   "mode": "forYou" | "new" | "alternate",
//   "likeCuisines": ["Indian","Thai"], "dislikeCuisines": ["Steakhouse"],
//   "likeKeywords": ["spicy","noodle"], "dislikeKeywords": ["oyster"],
//   "maxPrice": 3, "minRating": 4.0,
//   "tapMenuEvery": 6, "undoAt": 9, "markVisits": 2, "faceoff": true }

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => [s.trim().split(/\s+/)[0], s.trim().split(/\s+/).slice(1).join(' ') || true])
)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const persona = JSON.parse(readFileSync(String(args.persona), 'utf8'))
const outDir = String(args.out)
const appPath = join(root, String(args.app || 'dist/chews.html'))
const maxSwipes = Number(args.swipes || 30)
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  const cache = join(os.homedir(), 'Library/Caches/ms-playwright')
  const dirs = readdirSync(cache).sort().reverse()
  for (const d of dirs) {
    if (d.startsWith('chromium-')) {
      const p = join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
      try { readFileSync(p).length; } catch { continue }
      return p
    }
  }
  for (const d of dirs) {
    if (d.startsWith('chromium_headless_shell-')) {
      return join(cache, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    }
  }
  throw new Error('no chromium found in ms-playwright cache')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id)
        this.pending.delete(d.id)
        d.error ? reject(new Error(d.error.message)) : resolve(d.result)
      } else if (d.method) this.events.push(d)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('page eval failed: ' + (r.exceptionDetails.text || '') + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
}

async function connect(url) {
  const port = 9222 + Math.floor(Math.random() * 900)
  const flags = [
    '--headless=new', '--disable-gpu', '--use-mock-keychain', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--window-size=390,844',
    `--remote-debugging-port=${port}`,
  ]
  // --profile <dir> persists localStorage across runs → returning-user personas.
  if (args.profile) flags.push(`--user-data-dir=${args.profile}`)
  const chrome = spawn(findChrome(), [...flags, 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      target = await res.json()
      break
    } catch {}
  }
  if (!target) { chrome.kill(); throw new Error('chrome did not start') }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  return { cdp, chrome }
}

let shotN = 0
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${String(++shotN).padStart(2, '0')}-${name}.png`
  writeFileSync(join(outDir, file), Buffer.from(data, 'base64'))
  return file
}

const TOP_CARD = `(() => {
  const c = document.querySelector('#stack .depth-0')
  if (!c) return document.querySelector('.empty-panel') ? { empty: true } : null
  const chips = [...c.querySelectorAll('.chip')].map(x => x.textContent.trim())
  const rating = c.querySelector('.card-rating')?.textContent.trim() || ''
  const priceChip = c.querySelector('.chip-price')
  const dimmed = priceChip?.querySelector('.price-rest')?.textContent.length || 0
  return {
    id: c.dataset.id,
    dish: c.querySelector('.card-dish')?.textContent.trim() || '',
    desc: c.querySelector('.card-desc')?.textContent.trim() || '',
    resto: c.querySelector('.card-name')?.textContent.trim() || '',
    cuisine: chips[0] || '',
    price: priceChip ? priceChip.textContent.trim().length - dimmed : 2, // bright $ only
    dist: chips[2] || '',
    rating: parseFloat(rating.replace('★', '')) || 0,
  }
})()`

const key = (k) => `document.dispatchEvent(new KeyboardEvent('keydown', {key:'${k}'}))`
const click = (sel) => `(() => { const b = document.querySelector('${sel}'); if (!b) return false; b.click(); return true })()`

function decide(card, p, i) {
  const text = `${card.dish} ${card.desc}`.toLowerCase()
  if ((p.dislikeCuisines || []).includes(card.cuisine)) return -1
  if ((p.dislikeKeywords || []).some((k) => text.includes(k))) return -1
  if (p.maxPrice && card.price > p.maxPrice) return -1
  if ((p.likeCuisines || []).includes(card.cuisine)) return 1
  if ((p.likeKeywords || []).some((k) => text.includes(k))) return 1
  if (p.minRating && card.rating >= p.minRating + 0.4) return 1
  return i % 3 === 0 ? 1 : -1 // mild curiosity baseline
}

async function waitTop(cdp, prevId) {
  for (let i = 0; i < 40; i++) {
    const c = await cdp.eval(TOP_CARD)
    if (c && (c.empty || c.id !== prevId)) return c
    await sleep(120)
  }
  return null
}

const url = `file://${appPath}?loc=${persona.loc}`
const { cdp, chrome } = await connect(url)
const transcript = { persona, cards: [], actions: [], errors: [], screenshots: [] }

try {
  let top = await waitTop(cdp, '__none__')
  if (!top) throw new Error('app did not render a deck or empty panel')
  transcript.screenshots.push(await shot(cdp, 'initial'))

  if (persona.appSeedCuisines?.length) {
    const ok = await cdp.eval(`(() => { if (!window.__chewsSeed) return false; window.__chewsSeed(${JSON.stringify(persona.appSeedCuisines)}); return true })()`)
    transcript.actions.push({ act: 'seed-cuisines', cuisines: persona.appSeedCuisines, ok })
    top = await waitTop(cdp, '__none__')
  }
  const wantsTasteTab = (persona.radiusMi && persona.radiusMi !== 10) || persona.appMaxPrice || persona.appVegOnly || persona.appOpenNowOff
  if (wantsTasteTab) {
    await cdp.eval(click('#tab-taste'))
    if (persona.radiusMi && persona.radiusMi !== 10) {
      // The slider accepts any 1-25 value (chips only cover presets).
      const ok = await cdp.eval(`(() => {
        const s = document.querySelector('.radius-row input')
        if (!s) return false
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(s, ${Number(persona.radiusMi)})
        s.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      transcript.actions.push({ act: 'set-radius', radius: persona.radiusMi, ok })
    }
    if (persona.appMaxPrice) {
      const ok = await cdp.eval(click(`[data-price="${persona.appMaxPrice}"]`))
      transcript.actions.push({ act: 'set-max-price', maxPrice: persona.appMaxPrice, ok })
    }
    if (persona.appVegOnly) {
      const ok = await cdp.eval(click('[data-toggle="vegOnly"]'))
      transcript.actions.push({ act: 'toggle-veg', ok })
    }
    if (persona.appOpenNowOff) {
      const ok = await cdp.eval(click('[data-toggle="openNowOnly"]'))
      transcript.actions.push({ act: 'toggle-open-now-off', ok })
    }
    await cdp.eval(click('#tab-discover'))
    top = await waitTop(cdp, '__none__')
  }
  if (persona.mode === 'new') {
    await cdp.eval(click('[data-mode="new"]'))
    transcript.actions.push({ act: 'mode-new' })
    // '__none__': a mode switch may legitimately keep the same top card
    // (cold-start ranks both modes identically) — only require a card.
    top = await waitTop(cdp, '__none__')
  }

  for (let i = 0; i < maxSwipes; i++) {
    if (!top || top.empty) { transcript.actions.push({ act: 'deck-empty', at: i }); break }
    if (persona.mode === 'alternate' && i > 0 && i % 10 === 0) {
      const toNew = (i / 10) % 2 === 1
      await cdp.eval(click(`[data-mode="${toNew ? 'new' : 'forYou'}"]`))
      transcript.actions.push({ act: 'mode-switch', to: toNew ? 'new' : 'forYou', at: i })
      top = await waitTop(cdp, '__none__')
      if (!top || top.empty) continue
    }
    if (persona.tapMenuEvery && i > 0 && i % persona.tapMenuEvery === 0) {
      await cdp.eval(key('ArrowUp'))
      await sleep(450)
      transcript.screenshots.push(await shot(cdp, `sheet-${i}`))
      const menuLen = await cdp.eval(`document.querySelectorAll('.sheet-menu .menu-item').length`)
      transcript.actions.push({ act: 'open-sheet', at: i, menuItems: menuLen })
      await cdp.eval(key('Escape'))
      await sleep(350)
    }
    const dir = decide(top, persona, i)
    transcript.cards.push({ i, ...top, decision: dir })
    await cdp.eval(key(dir > 0 ? 'ArrowRight' : 'ArrowLeft'))
    if (persona.undoAt && i === persona.undoAt) {
      await sleep(250)
      await cdp.eval(key('z'))
      transcript.actions.push({ act: 'undo', at: i })
      top = await waitTop(cdp, '__none__')
      continue
    }
    top = await waitTop(cdp, top.id)
  }

  transcript.screenshots.push(await shot(cdp, 'deck-after-swipes'))

  await cdp.eval(click('#tab-matches'))
  await sleep(300)
  transcript.screenshots.push(await shot(cdp, 'matches'))
  const matchCount = await cdp.eval(`document.querySelectorAll('.match-row').length`)
  for (let v = 0; v < Math.min(persona.markVisits || 0, matchCount); v++) {
    await cdp.eval(`(() => { const b = document.querySelectorAll('[data-act="ate"]')[0]; b && b.click() })()`)
    await sleep(200)
    // Answer the outcome ask: cycle fire/fine/miss unless the persona overrides.
    const verdict = (persona.mealVerdicts || ['fire', 'fine', 'miss'])[v % (persona.mealVerdicts?.length || 3)]
    const ok = await cdp.eval(click(`[data-v="${verdict}"]`))
    transcript.actions.push({ act: 'meal-verdict', verdict, ok })
    await sleep(150)
  }
  if (persona.markVisits) {
    await cdp.eval(click('[data-seg="regulars"]'))
    await sleep(250)
    transcript.screenshots.push(await shot(cdp, 'regulars'))
    await cdp.eval(click('[data-seg="saved"]'))
  }

  if (persona.faceoff && matchCount >= 2) {
    await cdp.eval(click('.btn-faceoff'))
    await sleep(350)
    transcript.screenshots.push(await shot(cdp, 'faceoff'))
    for (let r = 0; r < 14; r++) {
      const done = await cdp.eval(`!!document.querySelector('.champion')`)
      if (done) break
      await cdp.eval(`(() => { const cs = document.querySelectorAll('.faceoff-card'); cs[0] && cs[0].click() })()`)
      await sleep(500) // app has a 350ms double-tap lockout — pace like a human
    }
    transcript.screenshots.push(await shot(cdp, 'faceoff-end'))
    transcript.actions.push({ act: 'faceoff', champion: await cdp.eval(`document.querySelector('.champion .mini-name')?.textContent || null`) })
    await cdp.eval(click('.champ-done'))
  }

  await cdp.eval(click('#tab-taste'))
  await sleep(300)
  transcript.screenshots.push(await shot(cdp, 'taste'))

  transcript.finalState = JSON.parse(await cdp.eval(`localStorage.getItem('chews.v1')`) || 'null')
  const logs = await cdp.eval('1')
  transcript.errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params?.entry?.text || e.params?.exceptionDetails?.text || 'exception')
    .filter((t) => !/favicon|navigator\.vibrate/i.test(t))

  // Personalization stats: how strongly did the deck drift toward liked cuisines?
  const half = Math.floor(transcript.cards.length / 2)
  const share = (cards) => {
    const liked = cards.filter((c) => (persona.likeCuisines || []).includes(c.cuisine)).length
    return cards.length ? +(liked / cards.length).toFixed(2) : 0
  }
  transcript.stats = {
    cardsSeen: transcript.cards.length,
    yums: transcript.cards.filter((c) => c.decision > 0).length,
    uniqueCuisines: [...new Set(transcript.cards.map((c) => c.cuisine))].length,
    likedCuisineShareFirstHalf: share(transcript.cards.slice(0, half)),
    likedCuisineShareSecondHalf: share(transcript.cards.slice(half)),
    repeatedRestaurants: transcript.cards.length - new Set(transcript.cards.map((c) => c.id)).size,
    maxSameCuisineRun: transcript.cards.reduce((a, c, i, arr) => {
      let r = 1
      while (i - r >= 0 && arr[i - r].cuisine === c.cuisine) r++
      return Math.max(a, r)
    }, 0),
  }
} catch (e) {
  transcript.fatal = String(e.message || e)
} finally {
  writeFileSync(join(outDir, 'transcript.json'), JSON.stringify(transcript, null, 1))
  chrome.kill()
}
console.log(JSON.stringify({ out: outDir, fatal: transcript.fatal || null, stats: transcript.stats || null, errors: transcript.errors?.slice(0, 5) }, null, 1))
