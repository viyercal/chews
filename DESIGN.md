# Chews — swipe. match. eat.

Tinder for restaurants. One dish per card. Swipe right if it sounds good, left if not.
Goal: a hungry, indecisive person picks a spot in under a minute.

## Product decisions (made autonomously)

**Name & brand.** *Chews* (choose/chews). Dark, appetizing UI — deep charcoal, per-cuisine
gradient cards, big editorial serif dish names, YUM / PASS stamps. Mobile-first, feels like a
native app when opened on a phone.

**The card leads with the dish, not the restaurant.** Hero = signature dish name + one-line
description; below it the restaurant, cuisine chip, distance, price, and Google rating.
Tap the card → full menu sheet (3–4 more real dishes with prices, address, "why go",
Open in Google Maps).

**Data.** Pre-researched cache (per the brief): ~180 real Bay Area restaurants (SF, East Bay,
Peninsula, South Bay) researched via parallel web-search agents — real signature dishes,
addresses, coordinates, Google ratings. Stored as one JSON dataset with a `generatedAt` stamp
and a 2-month refresh policy (`npm run refresh` re-runs research). No live API dependency —
zero keys, zero cost, instant loads.

**Location.** Browser geolocation → distance computed by haversine. Radius defaults to
10 mi, adjustable 1–25 mi (slider + quick chips). If location is denied/unavailable or the
user is outside the Bay Area, the app falls back to exploring a chosen Bay Area spot
(demo mode) and says so honestly.

**Taste engine (the "AI adapts" part).**
- Every swipe updates Beta-style like/dislike counters per *cuisine*, per *dish tag*
  (spicy, noodles, seafood, …) and per *price tier*.
- **Cold start rule (per the brief):** preference weight is multiplied by
  `confidence = min(1, swipes / 25)`. For the first ~25 swipes ranking is driven almost
  entirely by quality (rating × review volume) + proximity — the user is *not* beholden to
  their first few cuisines. Preferences fade in gradually.
- Ranking uses Thompson-style sampling: affinity = Beta posterior mean + uncertainty jitter
  that shrinks with evidence — natural exploration early, exploitation later.
- **Tag transfer:** liking "spicy/noodles" in one cuisine boosts unseen cuisines that share
  those tags — so "Try Something New" is personalized without repeating cuisines.
- Diversity guard: never more than 2 consecutive cards of the same cuisine.
- Left-swiped places quietly resurface after 14 days.

**Modes & tabs.**
- **Discover** — the deck, with two modes: *For You* (learned taste) and *Something New*
  (novelty bonus for unexplored cuisines, visited spots excluded, tag taste still transfers).
- **Matches** — right-swipes (the shortlist) + *Regulars* segment: places you've marked
  "ate here", ranked by visit count ("commonly visited" from the brief).
- **Taste** — your profile: confidence meter, cuisine affinity bars, top tags, radius +
  location settings, reset.
- **Face-off ⚡** — the killer decide-now feature: once you have ≥2 matches, head-to-head
  bracket (tap the winner) until one restaurant remains → champion card + directions.
  Group-dinner indecision, solved in ~30 seconds.

**Persistence.** Everything local: `localStorage`, versioned, no accounts, no server.

## Architecture

```
index.html              shell (dev: ES modules via local server)
css/styles.css          all styling, CSS vars, cuisine gradients
js/config.js            tunables (radius, weights, cold-start threshold)
js/core/geo.js          haversine, geolocation, fallback spots
js/core/engine.js       TasteEngine — pure, DOM-free, unit-tested
js/core/deck.js         candidate filter + rank + diversify, undo history
js/core/store.js        localStorage persistence (dumb; engine owns the math)
js/ui/*.js              cards, swipe physics, sheet, matches, faceoff, profile, nav, toast, onboarding
js/data/restaurants.gen.js  generated from data/restaurants.json
scripts/build.mjs       bundles everything into dist/chews.html (single file, no deps)
tests/engine.test.mjs   node --test: cold start, learning, diversity, radius, serialization
```

Pure logic (engine/deck/geo) is DOM-free and tested; UI modules are thin. Single-file build
doubles as the shareable artifact and a double-clickable local app.
