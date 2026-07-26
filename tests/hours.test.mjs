import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hoursStatus, todayHours } from '../js/core/hours.js'

// new Date(2026, 6, 22) is a Wednesday (day 3).
const wed = (h, m = 0) => new Date(2026, 6, 22, h, m)
const r = (hours) => ({ hours })

test('unknown when hours missing or empty', () => {
  assert.equal(hoursStatus({}).status, 'unknown')
  assert.equal(hoursStatus(r([])).status, 'unknown')
})

test('open during a regular day span, closed outside it', () => {
  const resto = r([[3, '11:00', '22:00']])
  assert.equal(hoursStatus(resto, wed(12)).status, 'open')
  assert.equal(hoursStatus(resto, wed(12)).closesAt, '10 PM')
  assert.equal(hoursStatus(resto, wed(10, 59)).status, 'closed')
  assert.equal(hoursStatus(resto, wed(10, 59)).opensAt, '11 AM')
  assert.equal(hoursStatus(resto, wed(22, 0)).status, 'closed')
})

test('closing soon inside final hour', () => {
  const resto = r([[3, '11:00', '22:00']])
  assert.equal(hoursStatus(resto, wed(21, 30)).closingSoon, true)
  assert.equal(hoursStatus(resto, wed(20, 30)).closingSoon, false)
})

test('overnight span stays open past midnight', () => {
  const resto = r([[3, '17:00', '01:30']])
  assert.equal(hoursStatus(resto, wed(23, 30)).status, 'open')
  const thu1am = new Date(2026, 6, 23, 1, 0)
  assert.equal(hoursStatus(resto, thu1am).status, 'open')
  assert.equal(hoursStatus(resto, thu1am).closesAt, '1:30 AM')
  const thu2am = new Date(2026, 6, 23, 2, 0)
  assert.equal(hoursStatus(resto, thu2am).status, 'closed')
})

test('saturday overnight wraps into sunday', () => {
  const resto = r([[6, '20:00', '02:00']])
  const sun1am = new Date(2026, 6, 26, 1, 0)
  assert.equal(hoursStatus(resto, sun1am).status, 'open')
})

test('split shift: closed between lunch and dinner', () => {
  const resto = r([[3, '11:30', '14:00'], [3, '17:00', '21:00']])
  assert.equal(hoursStatus(resto, wed(12)).status, 'open')
  assert.equal(hoursStatus(resto, wed(15)).status, 'closed')
  assert.equal(hoursStatus(resto, wed(15)).opensAt, '5 PM')
  assert.equal(hoursStatus(resto, wed(18)).status, 'open')
})

test('closed today, opens another day', () => {
  const resto = r([[5, '11:00', '22:00']]) // Friday only
  const s = hoursStatus(resto, wed(12))
  assert.equal(s.status, 'closed')
  assert.equal(s.opensAt, 'Fri 11 AM')
})

test('closed rest of week wraps to next week', () => {
  const resto = r([[1, '11:00', '22:00']]) // Monday only
  const s = hoursStatus(resto, wed(12))
  assert.equal(s.status, 'closed')
  assert.equal(s.opensAt, 'Mon 11 AM')
})

test('todayHours renders spans or closed', () => {
  assert.equal(todayHours(r([[3, '11:30', '14:00'], [3, '17:00', '21:00']]), wed(9)), '11:30 AM–2 PM, 5 PM–9 PM')
  assert.equal(todayHours(r([[5, '11:00', '22:00']]), wed(9)), 'Closed today')
  assert.equal(todayHours({}, wed(9)), null)
})
