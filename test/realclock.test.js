// -----------------------------------------------------------------------------
// The real clock (performance.now, setTimeout) sped up 20,000 times and a real
// local HTTP server: the readings come at the Paris reading times, never
// sooner, and nothing happens after stop. Wide margins: a timer is late under
// load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../src/app.js';
import { CALENDAR_KEY, STATUS_URL, USER_AGENT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { paris } from '../src/time.js';
import { realClock, spyOn } from './helpers/clock.js';

const MINUTE = 60_000;
const SPEED = 20_000;

test('real clock: 10:15, 13:15, 16:15, then nothing; nothing after stop', async (t) => {
  // Wednesday 11 November 2026, 09:00 in Paris.
  const clock = realClock({ speed: SPEED, start: Date.parse('2026-11-11T08:00:00Z') });
  const requests = [];
  const server = createServer((req, res) => {
    const p = paris(clock.now());
    requests.push({ url: req.url, ua: req.headers['user-agent'], wall: clock.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        couleurJourJ: 'RAS',
        couleurJourJ1: p.minutes >= 16 * 60 ? 'ZENF_PM' : 'NON_DETERMINE',
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gladys = createFakeGladys({
    selector: 'edf-zen-flex',
    energyCalendars: { [CALENDAR_KEY]: [] },
  });
  await gladys.connect();
  const app = new App({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    fetchImpl: (url, init) =>
      fetch(String(url).replace(STATUS_URL, `${base}/s`), {
        ...init,
        signal: AbortSignal.timeout(5000),
      }),
  });
  t.after(async () => {
    await app.stop();
    clock.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const spy = spyOn(app, 'runCheck', clock);
  await app.start();
  // Up to 12 hours simulated, bounded in real time.
  const deadline = performance.now() + 20_000;
  while (spy.calls.length < 4 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await clock.sleep(6 * 60 * MINUTE);
  await app.idle();
  assert.equal(spy.calls.length, 4, `${spy.calls.length} readings`);
  // Each reading at its Paris time: never before it, at most a few minutes late.
  const minutes = requests.map((r) => paris(r.wall).minutes);
  for (const [i, slot] of [10 * 60 + 15, 13 * 60 + 15, 16 * 60 + 15].entries()) {
    const at = minutes[i + 1];
    assert.ok(at >= slot && at <= slot + 10, `reading ${i + 2} at ${at} min, expected ${slot}`);
  }
  assert.ok(requests.every((r) => r.ua === USER_AGENT));
  assert.ok(requests.every((r) => r.url === '/s?dateRelevant=2026-11-11'));
  assert.equal(gladys.fake.sceneEvents.length, 1);
  await app.stop();
  const count = requests.length;
  const timers = clock.timersSet;
  await clock.sleep(12 * 60 * MINUTE);
  assert.equal(requests.length, count, 'no request after stop');
  assert.equal(clock.timersSet, timers, 'no timer after stop');
});
