# Chews 🍜 — swipe. match. eat.

Tinder for restaurants. Each card is one great dish from a real restaurant —
swipe right if it makes you hungry, left if not. Tap a card for the full menu.
Can't decide among your matches? **Face-off** runs a head-to-head bracket until one
restaurant remains.

## Run it

**Single file (easiest):** open `dist/chews.html` in any browser — everything
(app, data, font) is inlined. On a phone, grant location; otherwise pick a Bay
Area spot.

**Dev server:**

```bash
npm run dev        # python http.server on :4173
open http://localhost:4173
```

**Tests / build:**

```bash
npm test           # node --test — engine, deck, store logic
npm run build      # bundles dist/chews.html + dist/artifact.html
```

QA override: `?loc=37.7599,-122.4148` sets a fake location and skips onboarding.

## How it decides what you see

- Ranking = quality (Google rating × review volume) + proximity + **learned taste**.
- Taste = Beta-posterior affinities per cuisine, dish tag, and price tier, updated
  every swipe, sampled Thompson-style so early rankings explore.
- **Cold start:** preference weight scales with `min(1, swipes/25)` — your first
  few swipes can't lock you into a cuisine bubble.
- **Something New** mode adds a novelty bonus for unexplored cuisines while tag
  taste (spicy, noodles, …) transfers across cuisines.
- Left-swipes resurface after 14 days. Never more than 2 same-cuisine cards in a row.

## Data

**Indexed areas: SF Bay Area** (SF, San Jose, Oakland/Berkeley, Peninsula,
Fremont, Tri-Valley: Pleasanton/Dublin/Livermore/San Ramon/Danville) **+
Brooklyn, NYC**.
`data/restaurants.json` holds the index; every entry's rating, review count,
price level, weekly hours, category, and Maps link are **verbatim from the
Google Places API** (`verifiedBy: places-api`). Editorial content (signature
dish, menu highlights) is grounded in each place's own Google review texts —
`scripts/merge_discovered.mjs` mechanically drops any dish claim that can't
cite a verbatim review substring.

**Reindex cadence: every 2 weeks** (hours/ratings drift slowly; weekly hours
evaluate against the device clock between reindexes with zero API calls):

```bash
GOOGLE_MAPS_API_KEY=... node scripts/fetch_places.mjs --all   # refresh known entries (~$6)
GOOGLE_MAPS_API_KEY=... node scripts/discover_places.mjs      # find new spots (~$20 with reviews)
# then editorial workflow for new spots → node scripts/merge_discovered.mjs
node scripts/integrate_data.mjs && npm test && npm run build
```

**No database, by design.** The index is read-only between reindexes and all
user state (swipes, matches, taste) is per-device localStorage. A backend
becomes necessary only for: subscription-gated live search (key must hide
behind a proxy + auth), cross-device accounts, or indexes too large for
static files. BYOK live search needs no server — the key is the user's own.

**Live search (BYOK):** in Taste → "Live search", users add their own Places
API key (device-only) and can then search any address; thin-coverage areas
pull live Google results as swipeable cards (marked 🔎 live, no researched
dish layer). Blocked in the hosted artifact preview by CSP — works in the
standalone/deployed app.

## Layout

See `DESIGN.md` for product/design decisions and architecture. Entry points:
`index.html` → `js/main.js`; pure logic in `js/core/` (tested), UI in `js/ui/`.

## Deploy

Live at **https://viyercal.github.io/chews/** (GitHub Pages, serving `docs/`).
GPS and BYOK live search work there (real https origin — the claude.ai
artifact preview blocks both by sandbox policy).

Ship an update:

```bash
node scripts/build.mjs && cp dist/chews.html docs/index.html
git add -A && git commit -m "release" && git push
```

Secrets policy: no API keys exist anywhere in this repo (verified by pattern
scan pre-push); data-pipeline scripts read `GOOGLE_MAPS_API_KEY` from the
environment only, and `data/` intermediates containing third-party review
excerpts are gitignored. If you use your own key in the deployed app's BYOK
field, restrict it in Google Cloud console to HTTP referrers
`https://viyercal.github.io/*` and `http://localhost:*`.

## Couple Mode

Matches → **💞 Together** shares a link encoding your shortlist (top 12, in
the URL hash — zero backend). Your partner opens it, swipes your picks
through their own taste, and the overlap goes straight to Face-off. One
mutual yes = decided; no overlap = a pick-one-anyway bracket. Their swipes
teach their own taste profile; nothing else persists.
