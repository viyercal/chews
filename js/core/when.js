import { DAYS, fmtClock, toMin } from './hours.js'

// "When are you going?" — resolves the user's time frame into the instant
// hours get evaluated against. Three states:
//   open now   (settings.openNowOnly, persisted — the default)
//   any time   (openNowOnly off — nothing is hidden for being closed)
//   at a time  (settings.openAt = { day 0-6, time 'HH:MM' }, SESSION-ONLY —
//               a plan for Saturday brunch must not haunt Tuesday's deck)

export const MEAL_TIMES = [
  { label: 'Breakfast', time: '09:00' },
  { label: 'Lunch', time: '12:30' },
  { label: 'Dinner', time: '19:00' },
  { label: 'Late', time: '22:00' },
]

export const fmtTime = (time) => fmtClock(toMin(time))

// The upcoming occurrence of that weekday at that clock time. Same weekday =
// today, even if the time has passed — it's a weekly schedule lookup, and
// "Tue 8 AM" asked on Tuesday afternoon still means Tuesdays.
export function occurrence({ day, time }, now = new Date()) {
  const d = new Date(now)
  d.setDate(now.getDate() + ((day - now.getDay() + 7) % 7))
  const [h, m] = String(time).split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

export function whenLabel({ day, time }, now = new Date()) {
  const gap = (day - now.getDay() + 7) % 7
  const dayName = gap === 0 ? 'Today' : gap === 1 ? 'Tomorrow' : DAYS[day]
  return `${dayName} ${fmtTime(time)}`
}

// { date, isNow, filtering, mode, label } — `filtering` false means closed
// places are shown too; `isNow` false means status chips must name the day.
export function resolveWhen(settings, now = new Date()) {
  const at = settings.openAt
  if (at && Number.isInteger(at.day) && /^\d{1,2}:\d{2}$/.test(String(at.time))) {
    return { mode: 'at', date: occurrence(at, now), isNow: false, filtering: true, label: whenLabel(at, now), day: at.day, time: at.time }
  }
  if (settings.openNowOnly) return { mode: 'now', date: now, isNow: true, filtering: true, label: 'Open now' }
  return { mode: 'any', date: now, isNow: true, filtering: false, label: 'Any time' }
}

// Clock time rounded up to the next quarter hour — the picker's default so
// "pick a time" starts from roughly now, not midnight.
export function roundedTime(now = new Date(), stepMin = 15) {
  const min = Math.min(23 * 60 + 45, Math.ceil((now.getHours() * 60 + now.getMinutes()) / stepMin) * stepMin)
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
