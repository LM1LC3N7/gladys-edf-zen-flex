// -----------------------------------------------------------------------------
// French legal time (Europe/Paris) of an instant, and back: EDF names its days
// by their Paris date and its hours as wall-clock times, CET in winter, CEST in
// summer. Pure.
//
// On the spring change (last Sunday of March, 02:00 -> 03:00) the wall times
// 02:00-02:59 do not exist; on the autumn change (last Sunday of October,
// 03:00 -> 02:00) the wall clock shows 02:00-02:59 twice. The reading times of
// the module (src/constants.js, SLOTS) avoid both.
// -----------------------------------------------------------------------------

import { TIMEZONE } from './constants.js';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const two = (n) => String(n).padStart(2, '0');
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

/** `{ date: 'YYYY-MM-DD', minutes, weekday (0 = Sunday), year }` of the instant `t` (epoch ms) in Paris. */
export function paris(t) {
  const p = {};
  for (const { type, value } of formatter.formatToParts(new Date(t))) {
    if (type !== 'literal') p[type] = value;
  }
  const year = Number(p.year);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    year,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
    weekday: WEEKDAYS[p.weekday],
  };
}

/** A valid calendar date `YYYY-MM-DD` (2000-2099). */
export function isDate(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** The date `n` days after `date` (calendar arithmetic, no time zone involved). */
export function addDays(date, n) {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (both `YYYY-MM-DD`). */
export const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** `'HH:MM'` -> minutes of the day. */
export const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The instant of the Paris wall time `hhmm` on `date`. A wall time skipped by
 * the spring change gives the instant one hour later; one shown twice in
 * autumn gives the first.
 */
export function parisInstant(date, hhmm) {
  const wanted = Date.parse(`${date}T${hhmm}:00Z`);
  // Paris is UTC+1 or UTC+2: try both offsets, keep the earliest that reads back right.
  for (const offset of [2, 1]) {
    const t = wanted - offset * 3_600_000;
    const p = paris(t);
    if (p.date === date && p.minutes === minutesOf(hhmm)) return t;
  }
  return wanted - 3_600_000;
}

/** `HH:MM` in Paris, for the texts shown. */
export function parisTime(t) {
  const { minutes } = paris(t);
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}

/** Easter Sunday of `year` (Gregorian, anonymous algorithm), `YYYY-MM-DD`. */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${two(month)}-${two(day)}`;
}

const FIXED_HOLIDAYS = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];

/** A French national public holiday (Easter Monday, Ascension and Whit Monday included). */
export function isHoliday(date) {
  if (FIXED_HOLIDAYS.includes(date.slice(5))) return true;
  const e = easter(Number(date.slice(0, 4)));
  return [1, 39, 50].some((n) => addDays(e, n) === date);
}

/** The day of the week of a date (0 = Sunday), no time zone involved. */
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
