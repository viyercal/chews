// Live open/closed status from a compact weekly schedule, evaluated against
// the device clock. resto.hours: [[day 0-6, "HH:MM" open, "HH:MM" close], ...]
// Close earlier than open = overnight. Missing/empty hours = unknown.

const WEEK = 7 * 1440
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toMin = (s) => {
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

function fmtClock(min) {
  const h24 = Math.floor(min / 60) % 24
  const m = min % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h = h24 % 12 || 12
  return m ? `${h}:${String(m).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`
}

export function hoursStatus(resto, now = new Date()) {
  const hours = resto.hours
  if (!hours || !hours.length) return { status: 'unknown' }
  const sp = spans(hours)
  if (!sp.length) return { status: 'unknown' }
  const nowMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes()

  for (const [start, end] of sp) {
    for (const t of [nowMin, nowMin + WEEK]) {
      if (t >= start && t < end) {
        const left = end - t
        return { status: 'open', closesAt: fmtClock(end % 1440), closingSoon: left <= 60, minutesLeft: left }
      }
    }
  }

  let next = sp.find(([start]) => start > nowMin)
  let wrapped = false
  if (!next) { next = sp[0]; wrapped = true }
  const openDay = Math.floor((next[0] % WEEK) / 1440)
  const today = now.getDay()
  const dayGap = wrapped ? 7 - today + openDay : openDay - today
  const at = fmtClock(next[0] % 1440)
  const opensAt = dayGap === 0 ? at : dayGap === 1 ? `tomorrow ${at}` : `${DAYS[openDay]} ${at}`
  return { status: 'closed', opensAt }
}

export function todayHours(resto, now = new Date()) {
  const hours = resto.hours
  if (!hours || !hours.length) return null
  const today = hours.filter(([d]) => d === now.getDay())
  if (!today.length) return 'Closed today'
  return today
    .sort((a, b) => toMin(a[1]) - toMin(b[1]))
    .map(([, o, c]) => `${fmtClock(toMin(o))}–${fmtClock(toMin(c))}`)
    .join(', ')
}
