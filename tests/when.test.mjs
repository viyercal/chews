import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveWhen, occurrence, whenLabel, roundedTime, fmtTime } from '../js/core/when.js'
import { hoursStatus, dayHours, weekHours } from '../js/core/hours.js'

// new Date(2026, 6, 22) is a Wednesday (day 3).
const wed = (h, m = 0) => new Date(2026, 6, 22, h, m)

test('default frame is open now; openNowOnly off is any time', () => {
  const now = wed(12)
  const n = resolveWhen({ openNowOnly: true }, now)
  assert.deepEqual([n.mode, n.isNow, n.filtering, n.label], ['now', true, true, 'Open now'])
  assert.equal(n.date, now)
  const a = resolveWhen({ openNowOnly: false }, now)
  assert.deepEqual([a.mode, a.isNow, a.filtering, a.label], ['any', true, false, 'Any time'])
})

test('a picked day + time overrides the saved preference either way', () => {
  for (const openNowOnly of [true, false]) {
    const w = resolveWhen({ openNowOnly, openAt: { day: 6, time: '09:00' } }, wed(12))
    assert.deepEqual([w.mode, w.isNow, w.filtering, w.label], ['at', false, true, 'Sat 9 AM'])
    assert.equal(w.date.getDay(), 6)
    assert.equal(w.date.getHours(), 9)
  }
})

test('malformed openAt falls back to the saved preference', () => {
  assert.equal(resolveWhen({ openNowOnly: true, openAt: { day: 'sat', time: '9' } }, wed(12)).mode, 'now')
  assert.equal(resolveWhen({ openNowOnly: false, openAt: null }, wed(12)).mode, 'any')
})

test('occurrence: upcoming weekday, same weekday means today even if past', () => {
  const sat = occurrence({ day: 6, time: '10:30' }, wed(12))
  assert.equal(sat.getDate(), 25) // Sat Jul 25 2026
  assert.equal(sat.getHours(), 10)
  assert.equal(sat.getMinutes(), 30)
  const mon = occurrence({ day: 1, time: '08:00' }, wed(12)) // wraps into next week
  assert.equal(mon.getDate(), 27)
  const today = occurrence({ day: 3, time: '08:00' }, wed(12)) // earlier today, still today
  assert.equal(today.getDate(), 22)
})

test('labels read Today / Tomorrow / weekday', () => {
  assert.equal(whenLabel({ day: 3, time: '19:00' }, wed(12)), 'Today 7 PM')
  assert.equal(whenLabel({ day: 4, time: '12:30' }, wed(12)), 'Tomorrow 12:30 PM')
  assert.equal(whenLabel({ day: 0, time: '09:00' }, wed(12)), 'Sun 9 AM')
  assert.equal(fmtTime('22:00'), '10 PM')
})

test('roundedTime steps up to the next quarter hour and caps at 11:45 PM', () => {
  assert.equal(roundedTime(wed(9, 1)), '09:15')
  assert.equal(roundedTime(wed(9, 15)), '09:15')
  assert.equal(roundedTime(wed(23, 50)), '23:45')
})

test('hoursStatus at a planned time names the day instead of "tomorrow"', () => {
  const resto = { hours: [[0, '11:00', '22:00']] } // Sunday only
  const satMorning = occurrence({ day: 6, time: '09:00' }, wed(12))
  assert.equal(hoursStatus(resto, satMorning).opensAt, 'tomorrow 11 AM')
  assert.equal(hoursStatus(resto, satMorning, { relative: false }).opensAt, 'Sun 11 AM')
})

test('dayHours / weekHours for the sheet planning view', () => {
  const resto = { hours: [[6, '07:00', '16:00'], [0, '08:00', '14:00']] }
  assert.equal(dayHours(resto, 6), '7 AM–4 PM')
  assert.equal(dayHours(resto, 3), 'Closed')
  assert.equal(dayHours({}, 3), null)
  const week = weekHours(resto)
  assert.equal(week.length, 7)
  assert.deepEqual(week[0], { day: 1, name: 'Monday', text: 'Closed' }) // Monday-first
  assert.deepEqual(week[6], { day: 0, name: 'Sunday', text: '8 AM–2 PM' })
  assert.equal(weekHours({}), null)
})

test('fmtMiles: always a distance — feet under ~0.2 mi, then miles', async () => {
  const { fmtMiles } = await import('../js/core/geo.js')
  assert.equal(fmtMiles(0), '50 ft')
  assert.equal(fmtMiles(0.01), '50 ft')
  assert.equal(fmtMiles(0.05), '250 ft')
  assert.equal(fmtMiles(0.14), '750 ft')
  assert.equal(fmtMiles(0.19), '0.2 mi')
  assert.equal(fmtMiles(1.04), '1.0 mi')
  assert.equal(fmtMiles(12.4), '12 mi')
})
