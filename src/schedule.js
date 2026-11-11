// -----------------------------------------------------------------------------
// When to ask EDF next, decided on one reading of the wall clock. Pure.
//
// A reading is due at the first reading time (SLOTS, Paris) after the last
// attempt that has something to learn: today unknown, or, from ANNOUNCE_FROM
// on, tomorrow unknown. A reading time missed while the module was stopped is
// caught up at once, but never sooner than MIN_GAP after the last attempt
// (kept in /data before each request, so a restart loop never asks faster).
// A failure retries on its own steps, a 429 or a 403 pauses.
// -----------------------------------------------------------------------------

import { ANNOUNCE_FROM, FINAL_SLOT, MAX_RETRY, MIN_GAP, RETRY_STEPS, SLOTS } from './constants.js';
import { addDays, minutesOf, paris, parisInstant } from './time.js';

/** The delay after `failures` failed readings in a row. */
export function retryDelay(failures) {
  if (failures <= 0) return 0;
  return failures > RETRY_STEPS.length ? MAX_RETRY : RETRY_STEPS[failures - 1];
}

/**
 * Whether the reading time `slot` of `date` has something to learn: today
 * unknown, tomorrow unknown (from ANNOUNCE_FROM), or tomorrow read before the
 * announcement time (`early`: read once more at FINAL_SLOT).
 */
export function needed(date, slot, known, early = () => false) {
  if (!known(date)) return true;
  if (minutesOf(slot) < minutesOf(ANNOUNCE_FROM)) return false;
  const tomorrow = addDays(date, 1);
  return !known(tomorrow) || (slot === FINAL_SLOT && early(tomorrow));
}

/**
 * The instant (epoch ms) of the next reading.
 * `now`: the wall clock, read once by the caller; `attemptAt`: the last
 * attempt (undefined: never); `known(date)`: whether the type of that day is
 * known; `early(date)`: whether it was read before the announcement time; `failures`, `pausedUntil`: from the last attempts.
 */
export function nextReadingAt({ now, attemptAt, known, early, failures = 0, pausedUntil }) {
  let due;
  if (attemptAt === undefined) {
    due = now;
  } else if (failures > 0) {
    due = attemptAt + Math.max(retryDelay(failures), MIN_GAP);
  } else {
    // From the day of the last attempt, or yesterday when it is older (caught up at once).
    const base = Math.max(attemptAt, now - 86_400_000);
    const first = paris(base).date;
    for (let d = 0; d < 4 && due === undefined; d += 1) {
      const date = addDays(first, d);
      for (const slot of SLOTS) {
        const t = parisInstant(date, slot);
        if (t > attemptAt && needed(date, slot, known, early)) {
          due = t;
          break;
        }
      }
    }
    // Every slot of four days known (impossible: the day after is never announced).
    due = Math.max(due ?? now + MAX_RETRY, attemptAt + MIN_GAP);
  }
  if (pausedUntil !== undefined && pausedUntil > due) due = pausedUntil;
  return due;
}
