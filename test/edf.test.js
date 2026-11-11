// -----------------------------------------------------------------------------
// The answer of the EDF endpoint: the known codes, NON_DETERMINE, and every
// other form refused as a whole.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatError, parseStatus } from '../src/edf.js';

test('both Bonus codes are a Bonus day', () => {
  assert.deepEqual(parseStatus({ couleurJourJ: 'ZENF_BONUS', couleurJourJ1: 'ZENF_BONIF' }), {
    today: 'bonus',
    tomorrow: 'bonus',
  });
  assert.deepEqual(parseStatus({ couleurJourJ: 'RAS', couleurJourJ1: 'ZENF_BONUS' }), {
    today: 'eco',
    tomorrow: 'bonus',
  });
});

test('the known codes', () => {
  assert.deepEqual(parseStatus({ couleurJourJ: 'RAS', couleurJourJ1: 'ZENF_PM' }), {
    today: 'eco',
    tomorrow: 'sobriete',
  });
  assert.deepEqual(parseStatus({ couleurJourJ: 'ZENF_BONIF', couleurJourJ1: 'NON_DETERMINE' }), {
    today: 'bonus',
    tomorrow: null,
  });
  assert.deepEqual(
    parseStatus({ couleurJourJ: 'RAS', couleurJourJ1: 'RAS', autre: 3 }),
    { today: 'eco', tomorrow: 'eco' },
    'other keys are ignored',
  );
});

test('every other form is refused', () => {
  for (const body of [
    null,
    undefined,
    'RAS',
    42,
    [],
    {},
    { couleurJourJ: 'RAS' },
    { couleurJourJ1: 'RAS' },
    { couleurJourJ: 'RAS', couleurJourJ1: null },
    { couleurJourJ: 'RAS', couleurJourJ1: 1 },
    { couleurJourJ: 'RAS', couleurJourJ1: '' },
    { couleurJourJ: 'RAS', couleurJourJ1: ' RAS' },
    { couleurJourJ: 'RAS', couleurJourJ1: 'BLEU' },
    { couleurJourJ: 'toString', couleurJourJ1: 'RAS' },
    { couleurJourJ: '__proto__', couleurJourJ1: 'RAS' },
    { couleurJourJ: ['RAS'], couleurJourJ1: 'RAS' },
    Object.create({ couleurJourJ: 'RAS', couleurJourJ1: 'RAS' }),
  ]) {
    assert.throws(() => parseStatus(body), FormatError, JSON.stringify(body));
  }
});

test('an unknown code is never repeated raw in the error', () => {
  assert.throws(
    () => parseStatus({ couleurJourJ: 'RAS', couleurJourJ1: `X\r\n${'A'.repeat(500)}` }),
    (err) => err.message.length < 80 && !/[\r\n]/.test(err.message),
  );
});
