// -----------------------------------------------------------------------------
// The answer of the EDF endpoint, checked. Pure.
//
// Expected: `{"couleurJourJ":"RAS","couleurJourJ1":"NON_DETERMINE"}`, both keys
// present, each one of the known codes (src/constants.js, CODES) or
// NON_DETERMINE (not announced yet). Anything else (another shape, a missing
// key, a number, an unknown code) is refused as a whole: the module then shows
// itself unreachable and never makes a day up. Other keys are ignored.
// -----------------------------------------------------------------------------

import { CODES, UNKNOWN_CODE } from './constants.js';

export class FormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormatError';
  }
}

const KEYS = { today: 'couleurJourJ', tomorrow: 'couleurJourJ1' };

/** A code shown in a log: letters, digits and `_` only, 32 at most. */
const shown = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9_]/g, '?')
    .slice(0, 32);

function dayType(json, key) {
  if (!Object.hasOwn(json, key)) throw new FormatError(`no ${key}`);
  const code = json[key];
  if (typeof code !== 'string') throw new FormatError(`${key} is not a text`);
  if (code === UNKNOWN_CODE) return null;
  if (!Object.hasOwn(CODES, code)) throw new FormatError(`unknown ${key} code ${shown(code)}`);
  return CODES[code];
}

/** `{ today, tomorrow }`: `'eco'`, `'sobriete'`, `'bonus'` or null (not announced). */
export function parseStatus(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new FormatError('not a JSON object');
  }
  return { today: dayType(json, KEYS.today), tomorrow: dayType(json, KEYS.tomorrow) };
}
