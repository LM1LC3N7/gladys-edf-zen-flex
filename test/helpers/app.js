// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted EDF endpoint and a virtual
// clock (each read moves it 1 µs).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { CALENDAR_KEY, STATUS_URL, TRIGGERS, dateParam } from '../../src/constants.js';
import { createMemoryStore } from '../../src/store.js';
import { paris } from '../../src/time.js';
import { testClock } from './clock.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Wednesday 11 November 2026, 09:00 in Paris (CET). */
export const NOW = Date.parse('2026-11-11T08:00:00Z');

export const json = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * The EDF endpoint. `answer(date, request)` -> a body object, a Response, or
 * 'timeout'; by default today is Éco and tomorrow becomes Sobriété from 16:00
 * Paris (`announceAt`, minutes of the day), as `days` says.
 */
export function createEdf({ now }) {
  const edf = {
    requests: [],
    days: {},
    announceAt: 16 * 60,
    answer: undefined,
    code: (type) =>
      ({ eco: 'RAS', sobriete: 'ZENF_PM', bonus: 'ZENF_BONIF' })[type] ?? 'NON_DETERMINE',
  };
  edf.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const request = { url: String(url), date: u.searchParams.get('dateRelevant'), init, at: now() };
    edf.requests.push(request);
    if (`${u.origin}${u.pathname}` !== STATUS_URL) return new Response('nope', { status: 404 });
    if (edf.down) return new Response('<html>down</html>', { status: 503 });
    let out = edf.answer?.(request.date, request);
    if (out instanceof Promise) out = await out;
    if (out === 'timeout') {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }
    if (out instanceof Response) return out;
    if (out !== undefined) return json(out);
    const p = paris(now());
    // The fake answers only for today (the module never asks another date).
    if (request.date !== dateParam(p.date)) {
      return new Response('<html>error</html>', { status: 503 });
    }
    const tomorrow = new Date(Date.parse(`${p.date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    return json({
      couleurJourJ: edf.code(edf.days[p.date] ?? 'eco'),
      couleurJourJ1:
        p.minutes >= edf.announceAt ? edf.code(edf.days[tomorrow] ?? 'eco') : 'NON_DETERMINE',
    });
  };
  return edf;
}

export async function setup({
  store = createMemoryStore(),
  now = NOW,
  start = true,
  energyCalendars = { [CALENDAR_KEY]: [] },
  edfDays = {},
} = {}) {
  const gladys = createFakeGladys({ selector: 'edf-zen-flex', energyCalendars });
  await gladys.connect();
  const clock = testClock({ start: now });
  let app;
  // The EDF endpoint reads the app's wall clock (a test may move it).
  const edf = createEdf({ now: () => (app ? app.now() : clock.now()) });
  edf.days = edfDays;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  app = new App({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: edf.fetch,
  });
  const wait = async (ms) => {
    await clock.advance(ms);
    await app.idle();
  };
  if (start) {
    await app.start();
    await wait(0);
  }
  return { app, gladys, clock, store, edf, wait, lines };
}

/** The calendar entries Gladys holds: `{ 'YYYY-MM-DD': value }`. */
export const calendarOf = (gladys) =>
  Object.fromEntries(
    (gladys.fake.energyCalendars[CALENDAR_KEY] ?? []).map((e) => [
      e.starts_at.slice(0, 10),
      e.value,
    ]),
  );

/** The scene events fired. */
export const announcements = (gladys) =>
  gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.DAY_ANNOUNCED).map((e) => e.data);

/** The Paris times (`YYYY-MM-DD HH:MM`) of the EDF requests. */
export const requestTimes = (edf) =>
  edf.requests.map((r) => {
    const p = paris(r.at);
    const two = (n) => String(n).padStart(2, '0');
    return `${p.date} ${two(Math.floor(p.minutes / 60))}:${two(p.minutes % 60)}`;
  });

/** The last status published. */
export const lastStatus = (gladys) => gladys.fake.connectionStatus;
