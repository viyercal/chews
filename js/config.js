const INJECTED_KEY = '__CHEWS_PLACES_KEY__' // build.mjs substitutes; '' in dev

export const CONFIG = {
  appName: 'Chews',
  tagline: 'swipe. match. eat.',
  storageKey: 'chews.v1',
  // House Places key (referrer-restricted, browser-safe) — powers address +
  // live search for everyone. Empty in dev/source; users may still override
  // with their own key in settings.
  placesKey: INJECTED_KEY.startsWith('__') ? '' : INJECTED_KEY,

  radius: { default: 10, min: 1, max: 25 },     // miles

  // Preference weight ramps 0 -> 1 over this many swipes; before that,
  // ranking is quality + proximity so early cuisines don't imprint.
  coldStart: { fullConfidenceSwipes: 25 },

  resurfaceDays: 14,                            // left-swipes come back after this long

  deck: { batchSize: 40, maxSameCuisineRun: 2 },

  weights: {
    quality: 0.4,
    proximity: 0.25,
    affinity: 0.45,
    tagTransfer: 0.25,
    price: 0.2,
    explore: 0.35,
  },

  // A cuisine with this many dislikes and zero likes stops being dealt.
  avoid: { dislikes: 3 },

  // Meals are ~10x a swipe: a swipe is intent, a meal is an outcome.
  meals: { fire: 10, fine: 2, miss: 10 },

  // Evidence half-life — your 2024 palate shouldn't govern your 2026 deck.
  decay: { halfLifeDays: 180 },

  refreshMonths: 2,                             // dataset refresh cadence
}
