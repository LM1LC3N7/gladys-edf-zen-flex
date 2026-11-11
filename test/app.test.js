// -----------------------------------------------------------------------------
// The app on the SDK's fake Gladys, a scripted EDF endpoint and a virtual
// clock: the schedule, the calendar, the announcements, the failures, /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_KEY, MIN_GAP, STATUS_URL, USER_AGENT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  DAY,
  HOUR,
  MINUTE,
  NOW,
  SECOND,
  announcements,
  calendarOf,
  json,
  lastStatus,
  requestTimes,
  setup,
} from './helpers/app.js';

const stopAfter = (t, app) => t.after(() => app.stop());

test('first start: one reading at once, with the module User-Agent and the Paris date', async (t) => {
  const { app, gladys, edf } = await setup();
  stopAfter(t, app);
  assert.equal(edf.requests.length, 1);
  const [request] = edf.requests;
  assert.equal(request.url, `${STATUS_URL}?dateRelevant=2026-11-11`);
  assert.equal(request.init.headers['User-Agent'], USER_AGENT);
  assert.match(
    USER_AGENT,
    /^gladys-edf-zen-flex\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-edf-zen-flex\)$/,
  );
  assert.doesNotMatch(USER_AGENT, /Mozilla|Chrome|Safari|okhttp|Dalvik|CFNetwork|EDF/);
  assert.equal(request.init.headers.Accept, 'application/json');
  assert.equal(request.init.headers.Cookie, undefined);
  assert.equal(request.init.redirect, 'error');
  assert.ok(request.init.signal, 'a timeout');
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
  assert.deepEqual(announcements(gladys), []);
  assert.equal(lastStatus(gladys).connected, true);
  assert.match(lastStatus(gladys).message.fr, /Demain \(12\/11\) : pas encore annoncé/);
});

test('a normal day asks at 10:15, 13:15 and 16:15, then nothing until the next morning', async (t) => {
  const { app, edf, wait } = await setup({ edfDays: { '2026-11-12': 'sobriete' } });
  stopAfter(t, app);
  await wait(2 * DAY);
  assert.deepEqual(requestTimes(edf), [
    '2026-11-11 09:00',
    '2026-11-11 10:15',
    '2026-11-11 13:15',
    '2026-11-11 16:15',
    '2026-11-12 10:15',
    '2026-11-12 13:15',
    '2026-11-12 16:15',
  ]);
});

test('a late announcement: asked at 17:15, 19:15 and 22:15, then at 00:15 for today', async (t) => {
  const { app, edf, wait } = await setup();
  stopAfter(t, app);
  edf.announceAt = 23 * 60;
  await wait(16 * HOUR);
  assert.deepEqual(requestTimes(edf), [
    '2026-11-11 09:00',
    '2026-11-11 10:15',
    '2026-11-11 13:15',
    '2026-11-11 16:15',
    '2026-11-11 17:15',
    '2026-11-11 19:15',
    '2026-11-11 22:15',
    '2026-11-12 00:15',
  ]);
});

test('the announcement goes to the calendar and to the scenes once', async (t) => {
  const store = createMemoryStore();
  const { app, gladys, wait } = await setup({ store, edfDays: { '2026-11-12': 'sobriete' } });
  stopAfter(t, app);
  await wait(8 * HOUR); // 17:00
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco', '2026-11-12': 'sobriete' });
  assert.deepEqual(announcements(gladys), [{ day_type: 'sobriete', date: '2026-11-12' }]);
  assert.match(lastStatus(gladys).message.fr, /Demain \(12\/11\) : jour Sobriété/);
  assert.match(lastStatus(gladys).message.fr, /2026 : 1 jour\(s\) Sobriété sur 20/);
  // A reconnection and a restart fire nothing again.
  await app.stop();
  await app.start();
  await wait(MINUTE);
  const second = await setup({ store, now: NOW + 8 * HOUR + MINUTE, start: false });
  t.after(() => second.app.stop());
  await second.app.start();
  await second.wait(2 * HOUR);
  assert.deepEqual(announcements(gladys).length, 1);
  assert.deepEqual(announcements(second.gladys), []);
  assert.deepEqual(second.edf.requests, [], 'today and tomorrow known: nothing asked');
});

test('EDF changes tomorrow before midnight: the calendar follows, the scenes are told again', async (t) => {
  const { app, gladys, edf, wait } = await setup({ edfDays: { '2026-11-12': 'sobriete' } });
  stopAfter(t, app);
  await wait(8 * HOUR); // 17:00, Sobriété announced
  edf.answer = () => ({ couleurJourJ: 'RAS', couleurJourJ1: 'RAS' });
  // Nothing asked while both days are known: a new reading only on the next day.
  await wait(17 * HOUR + 30 * MINUTE); // 10:30 on the 12th
  assert.equal(calendarOf(gladys)['2026-11-12'], 'eco', 'today as EDF says it now');
  assert.deepEqual(announcements(gladys), [
    { day_type: 'sobriete', date: '2026-11-12' },
    { day_type: 'eco', date: '2026-11-13' },
  ]);
});

test('a Bonus day is published as bonus, never as eco', async (t) => {
  const { app, gladys, wait } = await setup({ edfDays: { '2026-11-12': 'bonus' } });
  stopAfter(t, app);
  await wait(8 * HOUR);
  assert.equal(calendarOf(gladys)['2026-11-12'], 'bonus');
  assert.deepEqual(announcements(gladys), [{ day_type: 'bonus', date: '2026-11-12' }]);
});

test('a day not announced is never made up', async (t) => {
  const { app, gladys, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  edf.answer = () => ({ couleurJourJ: 'NON_DETERMINE', couleurJourJ1: 'NON_DETERMINE' });
  await app.start();
  await wait(3 * HOUR);
  assert.deepEqual(calendarOf(gladys), {});
  assert.deepEqual(announcements(gladys), []);
  assert.match(lastStatus(gladys).message.fr, /Aujourd’hui \(11\/11\) : pas encore annoncé/);
  // Known, then "not determined" again: the known day stays as it was.
  edf.answer = undefined;
  await wait(3 * HOUR); // 13:15
  edf.answer = () => ({ couleurJourJ: 'NON_DETERMINE', couleurJourJ1: 'NON_DETERMINE' });
  await wait(3 * HOUR); // 16:15
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
});

const UNEXPECTED = [
  ['an unknown code', { couleurJourJ: 'RAS', couleurJourJ1: 'ZENF_PM_NEW' }],
  ['an unknown code today', { couleurJourJ: 'ROUGE', couleurJourJ1: 'RAS' }],
  ['a missing key', { couleurJourJ: 'RAS' }],
  ['other keys only', { statut: 'RAS', demain: 'ZENF_PM' }],
  ['a number', { couleurJourJ: 1, couleurJourJ1: 'RAS' }],
  ['null', { couleurJourJ: null, couleurJourJ1: 'RAS' }],
  ['an array', [{ couleurJourJ: 'RAS', couleurJourJ1: 'RAS' }]],
  ['a JSON string', 'RAS'],
  ['lower case', { couleurJourJ: 'ras', couleurJourJ1: 'RAS' }],
  ['an inherited key', JSON.parse('{"__proto__":{"couleurJourJ":"RAS"},"couleurJourJ1":"RAS"}')],
];
for (const [name, body] of UNEXPECTED) {
  test(`unexpected form (${name}): unreachable, nothing published, older days kept`, async (t) => {
    const { app, gladys, edf, wait } = await setup();
    stopAfter(t, app);
    const published = gladys.fake.publishedEnergyCalendars.length;
    edf.answer = () => (typeof body === 'string' ? json(JSON.stringify(body)) : body);
    await wait(75 * MINUTE + SECOND); // 10:15
    assert.equal(edf.requests.length, 2);
    const status = lastStatus(gladys);
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /réponse de forme inattendue/);
    assert.match(status.message.en, /unexpected form/);
    assert.equal(gladys.fake.publishedEnergyCalendars.length, published);
    assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
    assert.deepEqual(announcements(gladys), []);
    // Retried after 10 minutes (5, raised to MIN_GAP), then recovered.
    edf.answer = undefined;
    await wait(9 * MINUTE);
    assert.equal(edf.requests.length, 2);
    await wait(MINUTE);
    assert.equal(edf.requests.length, 3);
    assert.equal(lastStatus(gladys).connected, true);
  });
}

test('not JSON: an HTML page with 200, a wrong content type, a broken body', async (t) => {
  for (const response of [
    () =>
      new Response('<html>challenge</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('{"couleurJourJ":"RAS","couleurJourJ1":"RAS"}', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    () => json('{"couleurJourJ":"RAS",'),
    () => new Response('{"couleurJourJ":"RAS","couleurJourJ1":"RAS"}', { status: 200 }),
  ]) {
    const { app, gladys, edf, wait } = await setup({ start: false });
    t.after(() => app.stop());
    edf.answer = response;
    await app.start();
    await wait(0);
    assert.equal(lastStatus(gladys).connected, false);
    assert.match(lastStatus(gladys).message.en, /unexpected form/);
    assert.deepEqual(calendarOf(gladys), {});
    await app.stop();
  }
});

test('an answer too large is cut before being read whole', async (t) => {
  const { app, gladys, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  let pulled = 0;
  edf.answer = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled += 1;
          if (pulled > 1000) controller.close();
          else controller.enqueue(new TextEncoder().encode(' '.repeat(1024)));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  await app.start();
  await wait(0);
  assert.ok(pulled < 20, `read ${pulled} chunks`);
  assert.match(lastStatus(gladys).message.en, /answer too large/);
});

test('failures retry after 5, 15, 30, 60 minutes, then every 2 hours', async (t) => {
  const { app, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  edf.down = true;
  await app.start();
  await wait(7 * HOUR);
  assert.deepEqual(requestTimes(edf), [
    '2026-11-11 09:00',
    '2026-11-11 09:10', // 5 minutes, raised to MIN_GAP
    '2026-11-11 09:25',
    '2026-11-11 09:55',
    '2026-11-11 10:55',
    '2026-11-11 12:55',
    '2026-11-11 14:55',
  ]);
  assert.equal(MIN_GAP, 10 * MINUTE);
});

test('a 429 pauses as Retry-After says (bounded), kept across a restart', async (t) => {
  const store = createMemoryStore();
  const { app, edf, wait, gladys } = await setup({ store, start: false });
  stopAfter(t, app);
  edf.answer = () => new Response('', { status: 429, headers: { 'retry-after': '7200' } });
  await app.start();
  await wait(0);
  assert.match(lastStatus(gladys).message.fr, /ralentir \(429\)/);
  assert.match(lastStatus(gladys).message.fr, /Nouvel essai à 11:00/);
  await wait(HOUR);
  assert.equal(edf.requests.length, 1, 'nothing during the pause');
  await app.stop();
  const second = await setup({ store, now: NOW + HOUR, start: false });
  t.after(() => second.app.stop());
  await second.app.start();
  await second.wait(59 * MINUTE);
  assert.equal(second.edf.requests.length, 0, 'the pause survives a restart');
  await second.wait(2 * MINUTE);
  assert.equal(second.edf.requests.length, 1);
});

test('a 429 without Retry-After pauses 30 minutes; a huge one 6 hours at most', async (t) => {
  for (const [header, minutes] of [
    [undefined, 30],
    ['999999', 360],
    ['1', 10],
  ]) {
    const { app, edf, wait } = await setup({ start: false });
    t.after(() => app.stop());
    edf.answer = () =>
      new Response('', { status: 429, headers: header ? { 'retry-after': header } : {} });
    await app.start();
    await wait((minutes - 1) * MINUTE);
    assert.equal(edf.requests.length, 1, `${header}: nothing before ${minutes} min`);
    await wait(2 * MINUTE);
    assert.equal(edf.requests.length, 2, `${header}: again after ${minutes} min`);
    await app.stop();
  }
});

test('a 403 (the website refuses the module) waits 6 hours, never another identity', async (t) => {
  const { app, edf, wait, gladys } = await setup({ start: false });
  stopAfter(t, app);
  edf.answer = () => new Response('<html>Access Denied</html>', { status: 403 });
  await app.start();
  await wait(6 * HOUR - MINUTE);
  assert.equal(edf.requests.length, 1);
  assert.match(lastStatus(gladys).message.fr, /refuse la requête \(403\)/);
  await wait(2 * MINUTE);
  assert.equal(edf.requests.length, 2);
  assert.ok(edf.requests.every((r) => r.init.headers['User-Agent'] === USER_AGENT));
});

test('a timeout or a network error retries; a redirect is not followed', async (t) => {
  const { app, edf, wait, gladys } = await setup({ start: false });
  stopAfter(t, app);
  edf.answer = () => 'timeout';
  await app.start();
  await wait(0);
  assert.match(lastStatus(gladys).message.en, /no answer in time/);
  edf.answer = () => {
    throw new TypeError('fetch failed');
  };
  await wait(10 * MINUTE);
  assert.match(lastStatus(gladys).message.en, /network error/);
  edf.answer = () =>
    new Response('', { status: 302, headers: { location: 'https://example.com/' } });
  await wait(15 * MINUTE);
  assert.match(lastStatus(gladys).message.en, /unexpected HTTP answer/);
  assert.equal(edf.requests.length, 3);
});

test('a restart never asks sooner than the schedule nor than 10 minutes after the last attempt', async (t) => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.app.stop();
  // Restarted 2 minutes later, today unknown in /data (the reading failed).
  const failing = await setup({
    store: createMemoryStore(store.data),
    now: NOW + 2 * MINUTE,
    start: false,
  });
  t.after(() => failing.app.stop());
  failing.app.meta.failures = 0;
  await failing.app.start();
  await failing.wait(0);
  assert.equal(failing.edf.requests.length, 0, 'today known: wait for 10:15');
  await failing.wait(72 * MINUTE);
  assert.equal(failing.edf.requests.length, 0);
  await failing.wait(2 * MINUTE);
  assert.deepEqual(requestTimes(failing.edf), ['2026-11-11 10:15']);
  // A failure in /data: the retry step counts from the attempt kept in /data.
  const broken = createMemoryStore({ attemptAt: NOW, failures: 1, lastError: 'server' });
  const third = await setup({ store: broken, now: NOW + MINUTE, start: false });
  t.after(() => third.app.stop());
  await third.app.start();
  await third.wait(8 * MINUTE);
  assert.equal(third.edf.requests.length, 0);
  await third.wait(2 * MINUTE);
  assert.equal(third.edf.requests.length, 1);
});

test('a restart loop with /data not writable never asks EDF more than once in 10 minutes', async (t) => {
  const store = createMemoryStore();
  store.failSave = true;
  let requests = 0;
  for (let i = 0; i < 5; i += 1) {
    const run = await setup({ store, now: NOW + i * MINUTE, start: false });
    await run.app.start();
    await run.wait(MINUTE - SECOND);
    requests += run.edf.requests.length;
    await run.app.stop();
  }
  assert.equal(requests, 0, 'each process waits 10 minutes before its first request');
  const last = await setup({ store, now: NOW + 5 * MINUTE, start: false });
  t.after(() => last.app.stop());
  await last.app.start();
  await last.wait(10 * MINUTE);
  assert.equal(last.edf.requests.length, 1);
  assert.match(lastStatus(last.gladys).message.fr, /\/data n’est pas inscriptible/);
  assert.deepEqual(calendarOf(last.gladys), { '2026-11-11': 'eco' }, 'kept in memory, published');
});

test('/data unreadable: nothing asked, read again every 10 s, never overwritten', async (t) => {
  const store = createMemoryStore({
    attemptAt: NOW - HOUR,
    days: [{ date: '2026-11-11', type: 'eco' }],
  });
  store.unreadable = true;
  const { app, edf, wait, gladys } = await setup({ store, start: false });
  stopAfter(t, app);
  await app.start();
  await wait(35 * SECOND);
  assert.equal(edf.requests.length, 0);
  assert.equal(store.saves, 0);
  assert.match(lastStatus(gladys).message.fr, /illisibles/);
  store.unreadable = false;
  await wait(10 * SECOND);
  assert.equal(app.days.get('2026-11-11'), 'eco');
  assert.equal(edf.requests.length, 0, 'today known, before 10:15');
});

test('/data: future dates, a pause too long, unknown types and bad dates are dropped', async (t) => {
  const store = createMemoryStore({
    attemptAt: NOW + DAY,
    checkedAt: NOW + HOUR,
    pausedUntil: NOW + 30 * DAY,
    failures: -3,
    lastError: '<script>',
    days: [
      { date: '2026-11-11', type: 'sobriete' },
      { date: '2026-11-12', type: 'bonus' },
      { date: '2026-11-13', type: 'sobriete' },
      { date: '2026-11-31', type: 'eco' },
      { date: '2026-11-10', type: 'rouge' },
      { date: '2026-11-09', type: 'eco', __proto__: { x: 1 } },
    ],
    announced: { date: '2027-01-01', type: 'eco' },
    pendingAnnounce: { date: '2026-11-11', type: 'eco' },
  });
  const { app, gladys } = await setup({ store, start: false });
  stopAfter(t, app);
  app.running = true;
  app.restore((await store.load()).data);
  assert.equal(app.meta.attemptAt, undefined);
  assert.equal(app.meta.checkedAt, undefined);
  assert.equal(app.meta.pausedUntil, undefined);
  assert.equal(app.meta.failures, 0);
  assert.equal(app.lastError, undefined);
  assert.deepEqual([...app.days.entries()].sort(), [
    ['2026-11-09', 'eco'],
    ['2026-11-11', 'sobriete'],
    ['2026-11-12', 'bonus'],
  ]);
  assert.equal(app.announced, undefined);
  assert.equal(app.pendingAnnounce, undefined, 'an announcement of today is stale');
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('the calendar owned by another integration: said in the status, the scenes still told', async (t) => {
  const { app, gladys, wait } = await setup({
    energyCalendars: {},
    edfDays: { '2026-11-12': 'sobriete' },
  });
  stopAfter(t, app);
  assert.match(lastStatus(gladys).message.fr, /une autre intégration le fournit/);
  assert.equal(lastStatus(gladys).connected, true);
  const posts = gladys.fake.requests.filter((r) => r.path === '/energy/calendar').length;
  await wait(8 * HOUR);
  assert.equal(
    gladys.fake.requests.filter((r) => r.path === '/energy/calendar').length,
    posts,
    'not asked again within the connection',
  );
  assert.deepEqual(announcements(gladys), [{ day_type: 'sobriete', date: '2026-11-12' }]);
});

test('Gladys failing to take the days: tried again after 1, 5 minutes, then sent', async (t) => {
  const { app, gladys, wait } = await setup({ start: false });
  stopAfter(t, app);
  const real = gladys.publishEnergyCalendar.bind(gladys);
  let fail = 2;
  gladys.publishEnergyCalendar = (...args) => {
    if (fail > 0) {
      fail -= 1;
      return Promise.reject(Object.assign(new Error('Gladys 500'), { status: 500 }));
    }
    return real(...args);
  };
  await app.start();
  await wait(0);
  assert.deepEqual(calendarOf(gladys), {});
  assert.match(lastStatus(gladys).message.fr, /pas encore pu être envoyés au calendrier/);
  await wait(MINUTE);
  assert.deepEqual(calendarOf(gladys), {});
  await wait(5 * MINUTE);
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
  assert.doesNotMatch(lastStatus(gladys).message.fr, /calendrier/);
});

test('Gladys hanging on the calendar: the call is given up, the reading goes on', async (t) => {
  const { app, gladys, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  gladys.publishEnergyCalendar = () => new Promise(() => {});
  await app.start();
  await wait(20 * SECOND);
  assert.equal(app.syncing, undefined, 'the publication was given up');
  await wait(2 * HOUR);
  assert.equal(edf.requests.length, 2, 'the 10:15 reading happened');
});

test('an announcement Gladys did not take is retried until midnight, then dropped', async (t) => {
  const { app, gladys, wait, lines } = await setup({
    start: false,
    edfDays: { '2026-11-12': 'sobriete' },
  });
  stopAfter(t, app);
  gladys.publishSceneEvent = () => Promise.reject(new Error('Gladys 500'));
  await app.start();
  await wait(7 * HOUR + 16 * MINUTE); // 16:16: announced, not taken
  assert.match(lastStatus(gladys).message.fr, /L’annonce n’a pas encore pu être envoyée/);
  const tries = [];
  gladys.publishSceneEvent = (key, data) => {
    tries.push(data);
    return Promise.reject(new Error('Gladys 500'));
  };
  await wait(8 * HOUR); // 00:16 on the 12th
  assert.ok(tries.length >= 3, `${tries.length} tries before midnight`);
  const count = tries.length;
  await wait(2 * HOUR);
  assert.equal(tries.length, count, 'nothing after the day began');
  assert.ok(lines.some((l) => /not sent before the day: dropped/.test(l)));
  assert.equal(app.pendingAnnounce, undefined);
});

test('an announcement waiting at a reconnection goes once Gladys is back, never after its day', async (t) => {
  const { app, gladys, wait } = await setup({ start: false, edfDays: { '2026-11-12': 'eco' } });
  stopAfter(t, app);
  const real = gladys.publishSceneEvent.bind(gladys);
  gladys.publishSceneEvent = () => Promise.reject(new Error('offline'));
  await app.start();
  await wait(7 * HOUR + 16 * MINUTE);
  await app.stop();
  gladys.publishSceneEvent = real;
  await app.start();
  await wait(0);
  assert.deepEqual(announcements(gladys), [{ day_type: 'eco', date: '2026-11-12' }]);
});

test('a restored Gladys database gets the near days back at the next start', async (t) => {
  const store = createMemoryStore();
  const { app, gladys, wait } = await setup({ store, edfDays: { '2026-11-12': 'sobriete' } });
  stopAfter(t, app);
  await wait(8 * HOUR);
  assert.equal(Object.keys(calendarOf(gladys)).length, 2);
  await app.stop();
  gladys.fake.energyCalendars[CALENDAR_KEY].length = 0;
  await app.start();
  await wait(0);
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco', '2026-11-12': 'sobriete' });
  // Days already in Gladys are not sent again.
  const posts = gladys.fake.publishedEnergyCalendars.length;
  await app.stop();
  await app.start();
  await wait(0);
  assert.equal(gladys.fake.publishedEnergyCalendars.length, posts);
});

test('reading the calendar back failing changes nothing', async (t) => {
  const store = createMemoryStore();
  const { app, gladys, wait } = await setup({ store });
  stopAfter(t, app);
  await app.stop();
  gladys.getEnergyCalendar = () => Promise.reject(new Error('Gladys 500'));
  const posts = gladys.fake.publishedEnergyCalendars.length;
  await app.start();
  await wait(0);
  assert.equal(gladys.fake.publishedEnergyCalendars.length, posts);
  assert.equal(lastStatus(gladys).connected, true);
});

test('a reading crossing midnight keeps the date it asked for', async (t) => {
  const { app, gladys, edf, clock } = await setup({
    now: Date.parse('2026-11-11T22:59:59Z'),
    start: false,
  });
  stopAfter(t, app);
  let release;
  edf.answer = (date) => {
    assert.equal(date, '2026-11-11');
    return new Promise((resolve) => {
      release = () => resolve({ couleurJourJ: 'ZENF_PM', couleurJourJ1: 'RAS' });
    });
  };
  await app.start();
  clock.advance(0);
  for (let i = 0; i < 1000 && !release; i += 1) await new Promise((r) => setImmediate(r));
  assert.ok(release, 'the request left');
  await clock.advance(2 * SECOND); // the answer comes after midnight
  release();
  await app.idle();
  assert.equal(app.days.get('2026-11-11'), 'sobriete');
  assert.equal(app.days.get('2026-11-12'), 'eco');
  // Tomorrow's announcement was learned on its day: not sent to the scenes.
  assert.deepEqual(announcements(gladys), []);
});

test('the wall clock moved back an hour: no extra request', async (t) => {
  const { app, edf, wait, clock } = await setup();
  stopAfter(t, app);
  await wait(75 * MINUTE); // 10:15
  assert.equal(edf.requests.length, 2);
  const realNow = clock.now;
  app.now = () => realNow() - HOUR;
  await wait(90 * MINUTE);
  assert.equal(edf.requests.length, 2, 'the 10:15 attempt is after the wall time: not asked again');
});

test('the wall clock jumped forward a day: one catch-up, then the schedule', async (t) => {
  const { app, edf, wait, clock } = await setup();
  stopAfter(t, app);
  const realNow = clock.now;
  app.now = () => realNow() + DAY;
  await wait(HOUR + SECOND); // timers wake at most every hour: 10:00 (caught up)
  assert.deepEqual(requestTimes(edf).slice(1), ['2026-11-12 10:00']);
  await wait(2 * HOUR); // then the schedule of the new day
  assert.deepEqual(requestTimes(edf).slice(1), ['2026-11-12 10:00', '2026-11-12 10:15']);
});

test('stop: no request, timer nor publication afterwards', async (t) => {
  const { app, edf, wait, gladys, clock } = await setup();
  stopAfter(t, app);
  await app.stop();
  const requests = edf.requests.length;
  const posts = gladys.fake.requests.length;
  await wait(3 * DAY);
  assert.equal(edf.requests.length, requests);
  assert.equal(gladys.fake.requests.length, posts);
  assert.equal(clock.pending, 0);
});

test('a status publication that hangs does not block the readings', async (t) => {
  const { app, gladys, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  gladys.setConnectionStatus = () => new Promise(() => {});
  await app.start();
  await wait(4 * HOUR + 30 * MINUTE);
  assert.equal(edf.requests.length, 3);
  assert.equal(Object.keys(calendarOf(gladys)).length, 1);
});

test('the Sobriété and Bonus days of the year are counted in the status', async (t) => {
  const days = [];
  for (let i = 1; i <= 3; i += 1) days.push({ date: `2026-01-0${i + 4}`, type: 'sobriete' });
  days.push({ date: '2026-07-14', type: 'bonus' }, { date: '2025-12-15', type: 'sobriete' });
  const store = createMemoryStore({ attemptAt: NOW - HOUR, checkedAt: NOW - HOUR, days });
  const { app, gladys } = await setup({ store });
  stopAfter(t, app);
  assert.match(
    lastStatus(gladys).message.fr,
    /2026 : 3 jour\(s\) Sobriété sur 20 et 1 jour\(s\) Bonus/,
  );
  assert.match(
    lastStatus(gladys).message.en,
    /2026: 3 Sobriété day\(s\) of 20 and 1 Bonus day\(s\)/,
  );
});

test('history: kept 400 days, older ones dropped', async (t) => {
  const days = [
    { date: '2025-10-06', type: 'sobriete' },
    { date: '2025-10-07', type: 'sobriete' },
  ];
  const store = createMemoryStore({ attemptAt: NOW - HOUR, days });
  const { app } = await setup({ store });
  stopAfter(t, app);
  assert.equal(app.days.has('2025-10-06'), false);
  assert.equal(app.days.has('2025-10-07'), true);
  assert.ok(store.data.days.every((d) => d.date >= '2025-10-07'));
});

test('the calendar only gets days from 5 years back to tomorrow', async (t) => {
  const store = createMemoryStore({
    attemptAt: NOW - HOUR,
    days: [{ date: '2026-11-01', type: 'eco' }],
  });
  const { app, gladys } = await setup({ store });
  stopAfter(t, app);
  const sent = gladys.fake.publishedEnergyCalendars.flatMap((b) => b.entries.map((e) => e.date));
  assert.ok(sent.includes('2026-11-01'));
  assert.ok(sent.every((d) => d <= '2026-11-12'));
});

test('a 429 asking 0 seconds still pauses one minute at least', async (t) => {
  const { app, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  edf.answer = () => new Response('', { status: 429, headers: { 'retry-after': '0' } });
  const before = app.now();
  await app.start();
  await wait(0);
  assert.ok(app.meta.pausedUntil >= before + MINUTE, 'a floor of one minute');
  assert.ok(app.meta.pausedUntil <= before + 2 * MINUTE);
});

test('a reconnection right after a reading, the wall clock jumped forward: no second request', async (t) => {
  const { app, edf, wait, clock } = await setup();
  stopAfter(t, app);
  await wait(2 * MINUTE);
  await app.stop();
  const realNow = clock.now;
  app.now = () => realNow() + DAY;
  await app.start();
  await wait(5 * MINUTE);
  assert.equal(edf.requests.length, 1, 'the monotonic clock keeps 10 minutes');
  await wait(4 * MINUTE);
  assert.equal(edf.requests.length, 2);
});

test('a timer woken early by a wall clock set back: decided again, no early request', async (t) => {
  const { app, edf, wait, clock } = await setup();
  stopAfter(t, app);
  await wait(HOUR); // 10:00, the 10:15 timer set
  assert.equal(edf.requests.length, 1);
  const realNow = clock.now;
  app.now = () => realNow() - 30 * MINUTE;
  await wait(16 * MINUTE); // the timer fires: 09:46 on the wall
  assert.equal(edf.requests.length, 1, 'not before 10:15 on the wall');
  await wait(30 * MINUTE);
  assert.equal(edf.requests.length, 2);
});

test('a second reading of the same announcement fires nothing again', async (t) => {
  const { app, gladys, edf, wait } = await setup({ start: false });
  stopAfter(t, app);
  // Today not determined: read again at 17:15, 19:15, 22:15 with the same tomorrow.
  edf.answer = () =>
    edf.requests.length >= 4
      ? { couleurJourJ: 'NON_DETERMINE', couleurJourJ1: 'ZENF_PM' }
      : { couleurJourJ: 'NON_DETERMINE', couleurJourJ1: 'NON_DETERMINE' };
  await app.start();
  await wait(14 * HOUR); // 23:00
  assert.ok(edf.requests.length >= 6, `${edf.requests.length} readings`);
  assert.deepEqual(announcements(gladys), [{ day_type: 'sobriete', date: '2026-11-12' }]);
});

test('the calendar refused at publication (not at read back): no retry, said in the status', async (t) => {
  const { app, gladys, wait } = await setup({ start: false });
  stopAfter(t, app);
  let posts = 0;
  gladys.getEnergyCalendar = async () => [];
  gladys.publishEnergyCalendar = () => {
    posts += 1;
    return Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
  };
  await app.start();
  await wait(2 * HOUR);
  assert.equal(posts, 1);
  assert.match(lastStatus(gladys).message.fr, /une autre intégration le fournit/);
});

test('the calendar refused, then free at the next connection: sent', async (t) => {
  const { app, gladys, wait } = await setup({ energyCalendars: {} });
  stopAfter(t, app);
  assert.deepEqual(gladys.fake.publishedEnergyCalendars, []);
  await app.stop();
  gladys.fake.energyCalendars[CALENDAR_KEY] = [];
  await app.start();
  await wait(0);
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
  assert.doesNotMatch(lastStatus(gladys).message.fr, /une autre intégration/);
});

test('an answer arriving after stop is not used', async (t) => {
  const { app, edf, clock } = await setup({ start: false });
  stopAfter(t, app);
  let release;
  edf.answer = () =>
    new Promise((resolve) => {
      release = () => resolve({ couleurJourJ: 'ZENF_PM', couleurJourJ1: 'RAS' });
    });
  await app.start();
  clock.advance(0);
  for (let i = 0; i < 1000 && !release; i += 1) await new Promise((r) => setImmediate(r));
  assert.ok(release, 'the request left');
  const stopped = app.stop();
  release();
  await stopped;
  assert.equal(app.days.size, 0);
  assert.equal(app.meta.checkedAt, undefined);
});

test('the status names the new day right after midnight, without a reading', async (t) => {
  const { app, gladys, edf, wait } = await setup({ edfDays: { '2026-11-12': 'sobriete' } });
  stopAfter(t, app);
  await wait(15 * HOUR + 2 * SECOND); // 00:00:02 on the 12th
  assert.match(lastStatus(gladys).message.fr, /Aujourd’hui \(12\/11\) : jour Sobriété/);
  assert.match(lastStatus(gladys).message.fr, /Demain \(13\/11\) : pas encore annoncé/);
  assert.equal(requestTimes(edf).at(-1), '2026-11-11 16:15');
});

test('a reconnection while a publication runs: the new connection still publishes', async (t) => {
  const { app, gladys, wait, clock } = await setup({ start: false });
  stopAfter(t, app);
  const real = gladys.publishEnergyCalendar.bind(gladys);
  let release;
  gladys.publishEnergyCalendar = (...args) =>
    new Promise((resolve, reject) => {
      release = () => reject(new Error('connection lost'));
      void args;
    });
  const started = app.start();
  for (let i = 0; i < 1000 && !release; i += 1) {
    await clock.advance(0);
  }
  assert.ok(release, 'the publication is running');
  await started.catch(() => {});
  gladys.publishEnergyCalendar = real;
  const stopped = app.stop();
  const restarted = app.start();
  // The new connection asks for a publication while the old one still runs.
  for (let i = 0; i < 1000 && !app.syncAgain; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(app.syncAgain, true);
  release();
  await Promise.all([stopped, restarted]);
  await wait(0);
  assert.deepEqual(calendarOf(gladys), { '2026-11-11': 'eco' });
});
