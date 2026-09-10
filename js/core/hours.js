// Live open/closed status from a compact weekly schedule, evaluated against
// any instant (the device clock, or a planned day + time — see when.js).
// resto.hours: [[day 0-6, "HH:MM" open, "HH:MM" close], ...]
// Close earlier than open = overnight. Missing/empty hours = unknown.

const WEEK = 7 * 1440
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const toMin = (s) => {
  const [h, m] = String(s).split(':').map(Number)
  return h * 60 + m
}

function spans(hours) {
  const out = []
  for (const [d, o, c] of hours) {
    const start = d * 1440 + toMin(o)
    const om = toMin(o)
    const cm = toMin(c)
    const dur = cm <= om ? cm + 1440 - om : cm - om
    if (dur > 0) out.push([start, start + dur])
  }
  return out.sort((a, b) => a[0] - b[0])
}

export function fmtClock(min) {
  const h24 = Math.floor(min / 60) % 24
  const m = min % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h = h24 % 12 || 12
  return m ? `${h}:${String(m).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`
}

// `relative: false` names the opening day outright ("Sun 11 AM") instead of
// "tomorrow" — right when `at` is a planned time rather than the present.
export function hoursStatus(resto, at = new Date(), { relative = true } = {}) {
  const hours = resto.hours
  if (!hours || !hours.length) return { status: 'unknown' }
  const sp = spans(hours)
  if (!sp.length) return { status: 'unknown' }
  const atMin = at.getDay() * 1440 + at.getHours() * 60 + at.getMinutes()

  for (const [start, end] of sp) {
    for (const t of [atMin, atMin + WEEK]) {
      if (t >= start && t < end) {
        const left = end - t
        return { status: 'open', closesAt: fmtClock(end % 1440), closingSoon: left <= 60, minutesLeft: left }
      }
    }
  }

  let next = sp.find(([start]) => start > atMin)
  let wrapped = false
  if (!next) { next = sp[0]; wrapped = true }
  const openDay = Math.floor((next[0] % WEEK) / 1440)
  const today = at.getDay()
  const dayGap = wrapped ? 7 - today + openDay : openDay - today
  const clock = fmtClock(next[0] % 1440)
  const opensAt = dayGap === 0 ? clock : dayGap === 1 && relative ? `tomorrow ${clock}` : `${DAYS[openDay]} ${clock}`
  return { status: 'closed', opensAt }
}

// One day's spans as text ("11:30 AM–2 PM, 5 PM–9 PM"), 'Closed' for a day
// off, null when hours are unknown.
export function dayHours(resto, day) {
  const hours = resto.hours
  if (!hours || !hours.length) return null
  const spansOfDay = hours.filter(([d]) => d === day)
  if (!spansOfDay.length) return 'Closed'
  return spansOfDay
    .sort((a, b) => toMin(a[1]) - toMin(b[1]))
    .map(([, o, c]) => `${fmtClock(toMin(o))}–${fmtClock(toMin(c))}`)
    .join(', ')
}

export function todayHours(resto, now = new Date()) {
  const text = dayHours(resto, now.getDay())
  return text === 'Closed' ? 'Closed today' : text
}

// The full week, Monday-first, for the menu sheet's planning view.
export function weekHours(resto) {
  if (!resto.hours || !resto.hours.length) return null
  return [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, name: DAYS_LONG[day], text: dayHours(resto, day) }))
}
