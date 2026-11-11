// -----------------------------------------------------------------------------
// The integration: reads the type of today and tomorrow from the EDF website
// a few times a day (src/schedule.js), keeps the days in memory and in /data,
// feeds them to the `zen-flex` tariff calendar of Gladys (which the Zen Flex
// contract template reads), and fires the `day_announced` scene trigger once
// per announced day.
//
// Never a made-up day: a day EDF has not announced stays unknown (absent from
// the calendar), and an answer of an unexpected form is refused as a whole
// (status "cannot be read", nothing published).
//
// Clocks: the injected timers schedule within the process (Node timers are
// monotonic) and no timer waits more than MAX_TIMER, so a change of the wall
// clock is seen within the hour. `now` (wall) names the Paris days, dates what
// goes to /data and decides the next reading time from the last attempt kept
// in /data, so neither a restart nor a reconnection asks EDF sooner than the
// schedule; `monotonic` keeps two requests of the same process MIN_GAP apart
// whatever the wall clock does.
//
// The status is published in the background, each state once.
// -----------------------------------------------------------------------------

import {
  BLOCKED_PAUSE,
  CALENDAR_KEY,
  DAY_TYPES,
  GLADYS_TIMEOUT,
  HISTORY_DAYS,
  MAX_TIMER,
  MIN_GAP,
  NEAR_DAYS,
  PAUSE_DEFAULT,
  PAUSE_MAX,
  PAUSE_MIN,
  SAVE_TIMEOUT,
  STATUS_TIMEOUT,
  STORE_RETRY,
  SYNC_RETRY_STEPS,
  TRIGGERS,
} from './constants.js';
import { FormatError, parseStatus } from './edf.js';
import { SourceError, getStatus } from './http.js';
import { T } from './i18n.js';
import { nextReadingAt, retryDelay } from './schedule.js';
import { addDays, daysBetween, isDate, paris, parisInstant } from './time.js';

const realTimers = { setTimeout, clearTimeout };
const ERROR_CODES = [
  'rate_limited',
  'blocked',
  'server',
  'http',
  'network',
  'timeout',
  'too_large',
  'invalid',
];

/** A wall date read from /data: a finite number not in the future, else undefined. */
const pastDate = (value, now) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now
    ? value
    : undefined;

/** A `{ date, type }` read from /data, else undefined. */
const dayOf = (value) =>
  value && isDate(value.date) && DAY_TYPES.includes(value.type)
    ? { date: value.date, type: value.type }
    : undefined;

export class App {
  constructor({
    gladys,
    logger = console,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = realTimers,
    store,
    fetchImpl = (...args) => globalThis.fetch(...args),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.fetchImpl = fetchImpl;
    /** Paris date -> 'eco' | 'sobriete' | 'bonus', as EDF said it. */
    this.days = new Map();
    /** Paris date -> type, as Gladys accepted it in its calendar. */
    this.published = new Map();
    /** The last announcement fired to the scenes, and the one waiting to be. */
    this.announced = undefined;
    this.pendingAnnounce = undefined;
    this.meta = { attemptAt: undefined, checkedAt: undefined, failures: 0, pausedUntil: undefined };
    this.lastError = undefined;
    this.retryAt = undefined;
    /** undefined, 'ok', 'refused' (another integration owns the key) or 'failed'. */
    this.calendar = undefined;
    this.sceneError = false;
    this.syncFailures = 0;
    this.loaded = false;
    this.loading = undefined;
    this.timer = undefined;
    this.storeTimer = undefined;
    this.syncTimer = undefined;
    this.checking = undefined;
    this.syncing = undefined;
    this.running = false;
    this.generation = 0;
    /** Monotonic time of the last request of this process, and of the start. */
    this.lastRequestMono = undefined;
    this.startedMono = monotonic();
    this.lastStatus = undefined;
    this.statusJob = Promise.resolve();
    this.saving = undefined;
    /** Why the last write of /data failed ('write', 'timeout'), undefined when it worked. */
    this.dataError = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** Connected to Gladys (first time or again): load /data once, schedule, republish. */
  async start() {
    this.running = true;
    this.generation += 1;
    const gen = this.generation;
    this.lastStatus = undefined;
    // A refused calendar is asked again once per connection (the owner may be gone).
    if (this.calendar === 'refused') this.calendar = undefined;
    await this.loading?.catch(() => {});
    if (gen !== this.generation) return;
    if (!this.loaded) {
      this.publishStatus(false, T.starting);
      await this.load(gen);
      return;
    }
    this.publishStatus();
    // A reading of the previous connection may still run: the schedule resumes after it.
    const resume = () => {
      if (gen === this.generation && this.running && !this.timer && !this.checking) {
        this.schedule(gen);
      }
    };
    if (this.checking) this.checking.then(resume, resume);
    else resume();
    await this.readBack(gen);
    await this.sync(gen);
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.clearTimers();
    await this.checking?.catch(() => {});
    await this.syncing?.catch(() => {});
  }

  clearTimers() {
    for (const name of ['timer', 'storeTimer', 'syncTimer']) {
      if (this[name]) this.timers.clearTimeout(this[name]);
      this[name] = undefined;
    }
  }

  /** Every pending piece of work (tests). */
  async idle() {
    for (let i = 0; i < 10; i += 1) {
      await this.loading;
      await this.checking;
      await this.syncing;
      await this.statusJob;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // --- /data ----------------------------------------------------------------------

  /** Reads /data once; unreadable: read again every 10 s, nothing asked meanwhile. */
  async load(gen) {
    if (this.storeTimer) this.timers.clearTimeout(this.storeTimer);
    this.storeTimer = undefined;
    this.loading = (async () => {
      const result = await this.store.load();
      if (gen !== this.generation || !this.running) return;
      if (result.status === 'unreadable') {
        this.logger.warn('/data unreadable: read again in 10 s');
        this.publishStatus(false, T.storeUnreadable);
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = undefined;
          if (gen === this.generation && this.running && !this.loading) {
            this.load(gen).catch((err) => this.logger.error('Load failed', err));
          }
        }, STORE_RETRY);
        return;
      }
      if (result.status === 'ok') this.restore(result.data);
      this.loaded = true;
      this.schedule(gen);
      this.publishStatus();
      await this.readBack(gen);
      await this.sync(gen);
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  /** The state of /data, each part checked; a part that does not read is dropped. */
  restore(data) {
    const now = this.now();
    const tomorrow = addDays(paris(now).date, 1);
    this.meta.attemptAt = pastDate(data.attemptAt, now);
    this.meta.checkedAt = pastDate(data.checkedAt, now);
    this.meta.failures =
      Number.isInteger(data.failures) && data.failures >= 0 && data.failures < 1000
        ? data.failures
        : 0;
    // A pause longer than its maximum is not ours: ignored.
    this.meta.pausedUntil =
      typeof data.pausedUntil === 'number' &&
      data.pausedUntil > now &&
      data.pausedUntil <= now + Math.max(PAUSE_MAX, BLOCKED_PAUSE)
        ? data.pausedUntil
        : undefined;
    this.lastError = ERROR_CODES.includes(data.lastError) ? data.lastError : undefined;
    // A day after tomorrow cannot have been read from EDF: the file is not ours there.
    const restoreDays = (list, into) => {
      for (const entry of Array.isArray(list) ? list.slice(-HISTORY_DAYS) : []) {
        const day = dayOf(entry);
        if (day && day.date <= tomorrow) into.set(day.date, day.type);
      }
    };
    restoreDays(data.days, this.days);
    restoreDays(data.published, this.published);
    const announced = dayOf(data.announced);
    if (announced && announced.date <= tomorrow) this.announced = announced;
    const pending = dayOf(data.pendingAnnounce);
    if (pending && pending.date === tomorrow) this.pendingAnnounce = pending;
    this.prune(now);
  }

  /** Keeps the last HISTORY_DAYS days. */
  prune(now) {
    const oldest = addDays(paris(now).date, -HISTORY_DAYS);
    for (const map of [this.days, this.published]) {
      for (const date of map.keys()) if (date < oldest) map.delete(date);
    }
  }

  stateToSave() {
    const list = (map) =>
      [...map.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, type]) => ({ date, type }));
    return {
      ...this.meta,
      lastError: this.lastError,
      days: list(this.days),
      published: list(this.published),
      announced: this.announced,
      pendingAnnounce: this.pendingAnnounce,
    };
  }

  /**
   * One write at a time, bounded in time: a write that hangs counts as a
   * failed one (the data stays in memory) and the next saves are skipped
   * until it ends. Never throws; resolves whether the write worked.
   */
  async save() {
    if (this.saving) {
      this.dataError = 'timeout';
      return false;
    }
    let timer;
    const job = Promise.resolve().then(() => this.store.save(this.stateToSave()));
    this.saving = job.then(
      () => {},
      () => {},
    );
    this.saving.then(() => {
      this.saving = undefined;
    });
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), SAVE_TIMEOUT);
    });
    try {
      const result = await Promise.race([job.then(() => 'ok'), late]);
      this.dataError = result === 'ok' ? undefined : 'timeout';
    } catch (err) {
      this.logger.warn(`Could not write /data: ${err?.code ?? 'error'}`);
      this.dataError = 'write';
    } finally {
      this.timers.clearTimeout(timer);
    }
    if (this.dataError === 'timeout') this.logger.warn('Writing /data takes too long: skipped');
    return this.dataError === undefined;
  }

  // --- Schedule -------------------------------------------------------------------

  known = (date) => this.days.has(date);

  /** The delay before the next reading, decided on one reading of each clock. */
  nextDelay() {
    const now = this.now();
    const due = nextReadingAt({
      now,
      attemptAt: this.meta.attemptAt,
      known: this.known,
      failures: this.meta.failures,
      pausedUntil: this.meta.pausedUntil,
    });
    let wait = Math.max(0, due - now);
    if (this.lastRequestMono !== undefined) {
      const since = this.monotonic() - this.lastRequestMono;
      wait = Math.max(wait, MIN_GAP - since);
    }
    return { wait, at: now + wait, now };
  }

  schedule(gen) {
    if (gen !== this.generation || !this.running) return;
    if (this.timer) this.timers.clearTimeout(this.timer);
    const { wait, at, now } = this.nextDelay();
    this.retryAt = at;
    // A long wait is cut in hours, and at the next Paris midnight (the status
    // names today and tomorrow, an announcement of the new day is dropped):
    // the schedule is decided again on waking up.
    const midnight = parisInstant(addDays(paris(now).date, 1), '00:00') + 1000;
    const cut = Math.min(wait, MAX_TIMER, Math.max(1000, midnight - now));
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (wait > cut) {
        this.publishStatus();
        if (this.pendingAnnounce)
          this.sync(gen).catch((err) => this.logger.error('Sync failed', err));
        this.schedule(gen);
        return;
      }
      this.check(gen).catch((err) => this.logger.error('Reading failed', err));
    }, cut);
  }

  // --- Reading EDF ----------------------------------------------------------------

  async check(gen) {
    if (this.checking || gen !== this.generation || !this.running) return this.checking;
    // Woken up early (the wall clock moved back): decided again.
    if (this.nextDelay().wait > 0) {
      this.schedule(gen);
      return undefined;
    }
    this.checking = this.runCheck(gen).finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  async runCheck(gen) {
    const t = this.now();
    const today = paris(t).date;
    const tomorrow = addDays(today, 1);
    // The attempt is dated in /data before the request: a restart in the
    // middle never asks again sooner. If /data cannot be written, the first
    // request of the process waits MIN_GAP after its start (a restart loop
    // with a broken volume never turns into a storm).
    const previous = this.meta.attemptAt;
    this.meta.attemptAt = t;
    const saved = await this.save();
    if (gen !== this.generation) return;
    if (!saved && this.lastRequestMono === undefined) {
      const up = this.monotonic() - this.startedMono;
      if (up < MIN_GAP) {
        this.meta.attemptAt = previous;
        if (this.timer) this.timers.clearTimeout(this.timer);
        this.retryAt = this.now() + (MIN_GAP - up);
        this.timer = this.timers.setTimeout(() => {
          this.timer = undefined;
          this.check(gen).catch((err) => this.logger.error('Reading failed', err));
        }, MIN_GAP - up);
        this.publishStatus();
        return;
      }
    }
    this.lastRequestMono = this.monotonic();
    let parsed;
    let failure;
    try {
      const json = await getStatus(today, { fetchImpl: this.fetchImpl, now: this.now });
      parsed = parseStatus(json);
    } catch (err) {
      if (!(err instanceof SourceError) && !(err instanceof FormatError)) throw err;
      failure = err;
    }
    if (gen !== this.generation) return;
    if (!failure) {
      this.learn(today, parsed.today);
      this.learn(tomorrow, parsed.tomorrow);
      if (
        parsed.tomorrow &&
        (this.announced?.date !== tomorrow || this.announced?.type !== parsed.tomorrow)
      ) {
        this.pendingAnnounce = { date: tomorrow, type: parsed.tomorrow };
      }
      this.prune(t);
      this.meta.failures = 0;
      this.meta.pausedUntil = undefined;
      this.meta.checkedAt = this.now();
      this.lastError = undefined;
    } else {
      this.meta.failures += 1;
      this.lastError = failure instanceof FormatError ? 'invalid' : failure.code;
      this.logger.warn(`EDF reading failed: ${failure.message}`);
      if (failure.code === 'rate_limited') {
        const pause = Math.min(Math.max(failure.retryAfter ?? PAUSE_DEFAULT, PAUSE_MIN), PAUSE_MAX);
        this.meta.pausedUntil = this.now() + pause;
      } else if (failure.code === 'blocked') {
        this.meta.pausedUntil = this.now() + BLOCKED_PAUSE;
      } else {
        this.logger.info(
          `Next EDF reading in ${Math.round(retryDelay(this.meta.failures) / 60_000)} min`,
        );
      }
    }
    await this.save();
    if (gen !== this.generation) return;
    this.schedule(gen);
    this.publishStatus();
    await this.sync(gen);
  }

  /** A day as EDF gave it; null (not announced) changes nothing already known. */
  learn(date, type) {
    if (!type) return;
    const before = this.days.get(date);
    if (before === type) return;
    if (before) this.logger.warn(`EDF changed ${date}: ${before} -> ${type}`);
    else this.logger.info(`EDF: ${date} is a ${type} day`);
    this.days.set(date, type);
  }

  // --- Gladys: calendar and scenes ------------------------------------------------

  /** A call to Gladys bounded in time: a hang counts as a failure. */
  async bounded(call) {
    let timer;
    const late = new Promise((_, reject) => {
      timer = this.timers.setTimeout(
        () => reject(new Error('Gladys did not answer in time')),
        GLADYS_TIMEOUT,
      );
    });
    const job = Promise.resolve().then(call);
    job.catch(() => {});
    try {
      return await Promise.race([job, late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /**
   * The near days as Gladys holds them (a restored database, a calendar
   * emptied): a day that differs from ours is published again. Secondary: a
   * failure changes nothing, a 403 says another integration owns the key.
   */
  async readBack(gen) {
    if (this.calendar === 'refused') return;
    const today = paris(this.now()).date;
    let entries;
    try {
      entries = await this.bounded(() =>
        this.gladys.getEnergyCalendar(CALENDAR_KEY, {
          from: new Date(Date.parse(`${addDays(today, -NEAR_DAYS - 1)}T00:00:00Z`)).toISOString(),
          to: new Date(Date.parse(`${addDays(today, 2)}T23:59:59Z`)).toISOString(),
        }),
      );
    } catch (err) {
      if (gen !== this.generation) return;
      if (err?.status === 403) {
        this.calendar = 'refused';
        this.logger.warn('Gladys refused the zen-flex calendar: another integration owns it');
        this.publishStatus();
      } else {
        this.logger.warn(`Calendar not read back: ${err?.message ?? err}`);
      }
      return;
    }
    if (gen !== this.generation) return;
    const held = new Map();
    for (const entry of Array.isArray(entries) ? entries.slice(0, 1000) : []) {
      const t = Date.parse(entry?.starts_at);
      if (Number.isFinite(t) && typeof entry.value === 'string')
        held.set(paris(t).date, entry.value);
    }
    // From yesterday only: the core purges the entries older than the oldest
    // consumption it stores, and an older day sent again would be "changed"
    // and recalculated at every connection (as gladys-edf-zen-weekend does).
    const from = addDays(today, -1);
    for (const [date, type] of this.published) {
      if (date >= from && held.get(date) !== type) this.published.delete(date);
    }
  }

  /**
   * Sends what Gladys does not have yet: the days to the calendar, the
   * pending announcement to the scenes (only while its day has not begun).
   * One at a time; a failure is tried again on its own timer.
   */
  async sync(gen) {
    if (gen !== this.generation || !this.running) return undefined;
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = this.runSync(gen).finally(() => {
      this.syncing = undefined;
      // Asked again meanwhile (possibly by a new connection): run for the current one.
      if (this.syncAgain && this.running) {
        this.syncAgain = false;
        this.sync(this.generation).catch((err) => this.logger.error('Sync failed', err));
      }
    });
    return this.syncing;
  }

  async runSync(gen) {
    this.syncAgain = false;
    if (this.syncTimer) this.timers.clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    const now = this.now();
    const today = paris(now).date;
    let failed = false;
    let changed = false;

    // The calendar accepts 5 years back to 7 days ahead.
    const entries = [...this.days.entries()]
      .filter(
        ([date, type]) =>
          this.published.get(date) !== type &&
          daysBetween(date, today) < 5 * 365 &&
          daysBetween(today, date) <= 1,
      )
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-2000)
      .map(([date, value]) => ({ date, value }));
    if (entries.length > 0 && this.calendar !== 'refused') {
      try {
        const result = await this.bounded(() =>
          this.gladys.publishEnergyCalendar(CALENDAR_KEY, entries),
        );
        if (gen !== this.generation) return;
        for (const { date, value } of entries) this.published.set(date, value);
        changed = true;
        this.calendar = 'ok';
        this.logger.info(
          `${entries.length} day(s) sent to the ${CALENDAR_KEY} calendar` +
            (result?.changed_from ? `, costs recalculated from ${result.changed_from}` : ''),
        );
      } catch (err) {
        if (gen !== this.generation) return;
        if (err?.status === 403) {
          this.calendar = 'refused';
          this.logger.warn('Gladys refused the zen-flex calendar: another integration owns it');
        } else {
          this.calendar = 'failed';
          failed = true;
          this.logger.warn(`Days not sent to the calendar: ${err?.message ?? err}`);
        }
      }
    } else if (entries.length === 0 && this.calendar === 'failed') {
      this.calendar = 'ok';
    }

    // An announcement is for the day before only: once its day began, it is dropped.
    const pending = this.pendingAnnounce;
    if (pending && pending.date <= today) {
      this.logger.warn(`Announcement of ${pending.date} not sent before the day: dropped`);
      this.pendingAnnounce = undefined;
      this.sceneError = false;
      changed = true;
    } else if (pending) {
      try {
        await this.bounded(() =>
          this.gladys.publishSceneEvent(TRIGGERS.DAY_ANNOUNCED, {
            day_type: pending.type,
            date: pending.date,
          }),
        );
        if (gen !== this.generation) return;
        this.announced = pending;
        if (this.pendingAnnounce === pending) this.pendingAnnounce = undefined;
        this.sceneError = false;
        changed = true;
        this.logger.info(`Scenes told: ${pending.date} is a ${pending.type} day`);
      } catch (err) {
        if (gen !== this.generation) return;
        this.sceneError = true;
        failed = true;
        this.logger.warn(`Announcement not sent to the scenes: ${err?.message ?? err}`);
      }
    }

    if (changed) await this.save();
    if (gen !== this.generation) return;
    this.publishStatus();
    if (failed) {
      this.syncFailures += 1;
      const delay = SYNC_RETRY_STEPS[Math.min(this.syncFailures, SYNC_RETRY_STEPS.length) - 1];
      this.syncTimer = this.timers.setTimeout(() => {
        this.syncTimer = undefined;
        this.sync(gen).catch((err) => this.logger.error('Sync failed', err));
      }, delay);
    } else {
      this.syncFailures = 0;
    }
  }

  // --- Status ---------------------------------------------------------------------

  /**
   * Publishes the status in the background (one at a time, in order, each
   * bounded in time); a state already published is not sent again. Returns
   * the promise of the publication, which never rejects.
   */
  publishStatus(connected, message) {
    let state = { connected, message };
    if (message === undefined) {
      const now = this.now();
      const { date: today, year } = paris(now);
      const tomorrow = addDays(today, 1);
      let sobriete = 0;
      let bonus = 0;
      for (const [date, type] of this.days) {
        if (!date.startsWith(`${year}-`)) continue;
        if (type === 'sobriete') sobriete += 1;
        if (type === 'bonus') bonus += 1;
      }
      if (this.meta.checkedAt === undefined && this.lastError === undefined) {
        state = { connected: false, message: T.starting };
      } else {
        state = {
          connected: this.lastError === undefined,
          message: T.status({
            today,
            tomorrow,
            todayType: this.days.get(today),
            tomorrowType: this.days.get(tomorrow),
            year,
            sobriete,
            bonus,
            checkedAt: this.meta.checkedAt,
            error: this.lastError,
            retryAt: this.retryAt,
            calendar: this.calendar,
            dataError: this.dataError,
            sceneError: this.sceneError,
          }),
        };
      }
    }
    const key = JSON.stringify(state);
    if (key === this.lastStatus) return this.statusJob;
    this.lastStatus = key;
    this.statusJob = this.statusJob.then(() => this.sendStatus(state));
    return this.statusJob;
  }

  async sendStatus(state) {
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), STATUS_TIMEOUT);
    });
    try {
      const sent = Promise.resolve().then(() =>
        this.gladys.setConnectionStatus(state.connected, state.message),
      );
      if ((await Promise.race([sent.then(() => 'ok'), late])) === 'timeout') {
        sent.catch(() => {});
        this.logger.warn('Status not published in time');
      }
    } catch (err) {
      this.logger.warn(`Status not published: ${err?.message ?? err}`);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }
}
