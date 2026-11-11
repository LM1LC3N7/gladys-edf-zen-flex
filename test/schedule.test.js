// -----------------------------------------------------------------------------
// The reading times: Paris wall times, through both changes of time, a day
// with nothing to learn skipped, a missed time caught up, MIN_GAP kept.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GAP } from '../src/constants.js';
import { nextReadingAt, retryDelay } from '../src/schedule.js';
import { addDays, isDate, paris, parisInstant } from '../src/time.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (iso) => Date.parse(iso);
const hhmm = (t) => {
  const p = paris(t);
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
};

/** The readings over `days`, each done at its due time, `known` growing as `announce` says. */
function simulate(start, days, announceAt = 16 * 60) {
  const known = new Set();
  const out = [];
  let attemptAt;
  let now = start;
  const end = start + days * 24 * HOUR;
  while (now < end) {
    const due = nextReadingAt({ now, attemptAt, known: (d) => known.has(d) });
    now = Math.max(now, due);
    if (now >= end) break;
    attemptAt = now;
    out.push(hhmm(now));
    const p = paris(now);
    known.add(p.date);
    if (p.minutes >= announceAt) known.add(addDays(p.date, 1));
  }
  return out;
}

test('Paris dates and wall times, winter and summer', () => {
  assert.equal(paris(at('2026-11-11T22:59:59Z')).date, '2026-11-11');
  assert.equal(paris(at('2026-11-11T23:00:00Z')).date, '2026-11-12');
  assert.equal(paris(at('2026-07-01T21:59:59Z')).date, '2026-07-01');
  assert.equal(paris(at('2026-07-01T22:00:00Z')).date, '2026-07-02');
  assert.equal(paris(at('2026-11-15T12:00:00Z')).weekday, 0);
  assert.equal(parisInstant('2026-11-11', '16:15'), at('2026-11-11T15:15:00Z'));
  assert.equal(parisInstant('2026-07-01', '16:15'), at('2026-07-01T14:15:00Z'));
  // Spring: 02:30 does not exist, 03:30 is the hour after; autumn: 02:30 twice, the first.
  assert.equal(parisInstant('2027-03-28', '02:30'), at('2027-03-28T01:30:00Z'));
  assert.equal(parisInstant('2026-10-25', '02:30'), at('2026-10-25T00:30:00Z'));
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2027-02-29'));
  assert.ok(!isDate('2026-1-1'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('a normal week: 10:15, 13:15, 16:15 each day, nothing at night', () => {
  const readings = simulate(at('2026-11-11T08:00:00Z'), 3);
  assert.deepEqual(readings, [
    '2026-11-11 09:00',
    '2026-11-11 10:15',
    '2026-11-11 13:15',
    '2026-11-11 16:15',
    '2026-11-12 10:15',
    '2026-11-12 13:15',
    '2026-11-12 16:15',
    '2026-11-13 10:15',
    '2026-11-13 13:15',
    '2026-11-13 16:15',
  ]);
});

for (const [name, start] of [
  ['spring change (2027-03-28)', '2027-03-26T12:00:00Z'],
  ['autumn change (2026-10-25)', '2026-10-23T12:00:00Z'],
]) {
  test(`the same Paris wall times through the ${name}`, () => {
    const readings = simulate(at(start), 4);
    const times = new Set(readings.slice(1).map((r) => r.slice(11)));
    assert.deepEqual([...times].sort(), ['10:15', '13:15', '16:15']);
    assert.equal(readings.filter((r) => r.endsWith('10:15')).length, 4);
  });
}

test('an announcement after 22:15: every evening slot, then 00:15 for today', () => {
  const readings = simulate(at('2026-11-11T08:00:00Z'), 1, 23 * 60);
  assert.deepEqual(readings.slice(-4), [
    '2026-11-11 17:15',
    '2026-11-11 19:15',
    '2026-11-11 22:15',
    '2026-11-12 00:15',
  ]);
  // Announced at 22:00: nothing at 00:15, today is known.
  assert.ok(!simulate(at('2026-11-11T08:00:00Z'), 1, 22 * 60).includes('2026-11-12 00:15'));
});

test('a slot missed while stopped is caught up at once, never sooner than MIN_GAP', () => {
  const attemptAt = at('2026-11-11T09:15:00Z'); // 10:15, tomorrow unknown
  const known = (d) => d === '2026-11-11';
  // Started again at 15:00: 13:15 was missed.
  assert.equal(
    nextReadingAt({ now: at('2026-11-11T14:00:00Z'), attemptAt, known }),
    at('2026-11-11T12:15:00Z'),
  );
  // Started again 2 minutes after the attempt: MIN_GAP.
  const just = at('2026-11-11T12:15:00Z');
  assert.equal(
    nextReadingAt({ now: just + 2 * MINUTE, attemptAt: just - MINUTE, known }),
    just - MINUTE + MIN_GAP,
  );
  // A last attempt days ago: at once.
  assert.ok(
    nextReadingAt({ now: at('2026-11-20T08:00:00Z'), attemptAt, known }) <=
      at('2026-11-20T08:00:00Z'),
  );
});

test('failures and pauses', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map(retryDelay),
    [5, 15, 30, 60, 120, 120].map((m) => m * MINUTE),
  );
  const attemptAt = at('2026-11-11T08:00:00Z');
  const known = () => false;
  assert.equal(
    nextReadingAt({ now: attemptAt, attemptAt, known, failures: 1 }),
    attemptAt + MIN_GAP,
  );
  assert.equal(
    nextReadingAt({ now: attemptAt, attemptAt, known, failures: 3 }),
    attemptAt + 30 * MINUTE,
  );
  assert.equal(
    nextReadingAt({
      now: attemptAt,
      attemptAt,
      known,
      failures: 1,
      pausedUntil: attemptAt + 3 * HOUR,
    }),
    attemptAt + 3 * HOUR,
  );
  assert.equal(nextReadingAt({ now: attemptAt, attemptAt: undefined, known }), attemptAt);
});
