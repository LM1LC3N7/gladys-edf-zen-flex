// -----------------------------------------------------------------------------
// The /data state file on a real temporary directory: missing is not
// unreadable, and an unreadable file is never taken for an empty one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_STATE_BYTES } from '../src/constants.js';
import { createFileStore } from '../src/store.js';

async function dir(t) {
  const path = await mkdtemp(join(tmpdir(), 'edf-zen-flex-store-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('missing, written, read back', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(await store.load(), { status: 'missing' });
  await store.save({ a: 1 });
  assert.deepEqual(await store.load(), { status: 'ok', data: { a: 1 } });
});

test('broken JSON, an array, a number, a file too large: unreadable, never empty', async (t) => {
  const base = await dir(t);
  for (const [name, content] of [
    ['broken', '{"a":'],
    ['array', '[1,2]'],
    ['number', '42'],
    ['null', 'null'],
    ['large', JSON.stringify({ x: 'a'.repeat(MAX_STATE_BYTES) })],
  ]) {
    const file = join(base, `${name}.json`);
    await writeFile(file, content);
    assert.deepEqual(await createFileStore(file).load(), { status: 'unreadable' }, name);
  }
});

test(
  'a file that cannot be read (permissions): unreadable',
  { skip: process.getuid?.() === 0 && 'root reads everything' },
  async (t) => {
    const file = join(await dir(t), 'state.json');
    await writeFile(file, '{"a":1}');
    await chmod(file, 0o000);
    t.after(() => chmod(file, 0o600).catch(() => {}));
    assert.deepEqual(await createFileStore(file).load(), { status: 'unreadable' });
  },
);

test('saves asked together are written one after the other, the last one wins', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  const big = (n) => ({ n, pad: 'x'.repeat(200_000) });
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.save(big(n))));
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(data.n, 5);
});
