// -----------------------------------------------------------------------------
// Keys shared with the manifest, the EDF source and the bounds. The manifest
// keys (template, calendar, its values, the scene trigger) are forever:
// contracts, calendars and scenes store them.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
/** The module's own User-Agent: never a browser's nor the EDF app's. */
export const USER_AGENT = `gladys-edf-zen-flex/${VERSION} (+https://github.com/LM1LC3N7/gladys-edf-zen-flex)`;

/**
 * The public, undocumented endpoint of the EDF website (no account, no
 * login). It answers only for the current day of Paris: the type of today and
 * of tomorrow; another date gets a 503.
 */
export const STATUS_URL = 'https://particulier.edf.fr/services/rest/opm/getOPMStatut';

/**
 * `dateRelevant` without leading zeros (`2027-1-5`), as the reference sends it
 * (AuroreVgn/edf-zen-flex, api.py: `f"{day.year}-{day.month}-{day.day}"`, the
 * form its users run every day). The script of the EDF Zen Flex page, read on
 * 2026-11-11, does not call this endpoint, so the website gives no other
 * form; a day and a month of two digits read the same both ways (checked for
 * real on 2026-11-11). To confirm on a day 1-9 (TODO.md).
 */
export const dateParam = (date) =>
  date
    .split('-')
    .map((part) => String(Number(part)))
    .join('-');
export const statusUrl = (date) => `${STATUS_URL}?dateRelevant=${dateParam(date)}`;

/** The day types of the tariff calendar, by EDF code. Any other code is refused. */
export const CODES = Object.freeze({ RAS: 'eco', ZENF_PM: 'sobriete', ZENF_BONIF: 'bonus' });
/** The code of a day EDF has not announced yet. */
export const UNKNOWN_CODE = 'NON_DETERMINE';
export const DAY_TYPES = Object.freeze(['eco', 'sobriete', 'bonus']);

/** French legal time: EDF days and hours are wall-clock times there. */
export const TIMEZONE = 'Europe/Paris';

export const CALENDAR_KEY = 'zen-flex';
export const TEMPLATE_KEY = 'edf-zen-flex';
export const TRIGGERS = Object.freeze({ DAY_ANNOUNCED: 'day_announced' });

// --- Bounds ------------------------------------------------------------------

export const HTTP_TIMEOUT = 20_000;
/** The answer is about 60 bytes; more is not the status. */
export const MAX_BODY_BYTES = 4 * 1024;
/** Days kept in /data and memory (the status counts the Sobriété days of the year). */
export const HISTORY_DAYS = 400;
/** The /data state file read back at most this size (larger: not ours). */
export const MAX_STATE_BYTES = 1024 * 1024;
/** The days read back from Gladys at a start (a restored database gets yesterday on again). */
export const NEAR_DAYS = 2;

// --- Schedule ----------------------------------------------------------------

/**
 * The reading times of a Paris day. A reading is skipped when it has nothing
 * to learn: today known and, from ANNOUNCE_FROM on, tomorrow known too. EDF
 * announces tomorrow at 16:00 at the latest, so a normal day asks two or three
 * times (10:15, 13:15, 16:15), then nothing until the next day.
 */
export const SLOTS = Object.freeze(['00:15', '10:15', '13:15', '16:15', '17:15', '19:15', '22:15']);
/** From this time of a Paris day, tomorrow is looked for. */
export const ANNOUNCE_FROM = '10:00';
/**
 * EDF announces tomorrow by 16:00 at the latest: a type of tomorrow read
 * before is read once more at FINAL_SLOT (EDF may still change it).
 */
export const ANNOUNCE_BY = '16:00';
export const FINAL_SLOT = '16:15';
/** The Sobriété season (EDF terms): month-day ranges, weekdays, public holidays excepted. */
export const SOBRIETE_SEASON = Object.freeze([
  ['01-01', '04-15'],
  ['10-15', '12-31'],
]);
/** Missed days named in the status at most (the most recent). */
export const MAX_MISSED_SHOWN = 5;
/** Two requests are never closer than this, restarts included. */
export const MIN_GAP = 10 * 60_000;
/** After a failed reading: 5, 15, 30, 60 minutes, then every 2 hours. */
export const RETRY_STEPS = Object.freeze([5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]);
export const MAX_RETRY = 2 * 60 * 60_000;
/** A 429: its Retry-After within these bounds (30 minutes when absent). */
export const PAUSE_MIN = 60_000;
export const PAUSE_MAX = 6 * 60 * 60_000;
export const PAUSE_DEFAULT = 30 * 60_000;
/** A 403 (the website refuses the module): no new try before this. */
export const BLOCKED_PAUSE = 6 * 60 * 60_000;
/** A timer never waits longer: a wall clock change is seen within this delay. */
export const MAX_TIMER = 60 * 60_000;
/** A publication to Gladys that failed: tried again after 1, 5, 15 minutes, then every 30 minutes. */
export const SYNC_RETRY_STEPS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]);
/** /data unreadable (not missing): read again on this period. */
export const STORE_RETRY = 10_000;
/** A write of /data longer than this counts as failed (the data stays in memory). */
export const SAVE_TIMEOUT = 10_000;
/** A status publication longer than this is given up (the next one goes on). */
export const STATUS_TIMEOUT = 10_000;
/** A call to Gladys (calendar, scene event) longer than this counts as failed. */
export const GLADYS_TIMEOUT = 15_000;
