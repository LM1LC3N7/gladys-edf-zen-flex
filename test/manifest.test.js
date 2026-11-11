// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. When the Gladys
// core is cloned next to this repository (~/code/Gladys), its own manifest
// validator and its pricing engine are run on the template too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CALENDAR_KEY,
  CODES,
  DAY_TYPES,
  TEMPLATE_KEY,
  TIMEZONE,
  TRIGGERS,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

function* objects(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* objects(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* objects(value);
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'provider', 'no device: capabilities only');
  assert.equal(manifest.gladys_version, '>=5.2.0', 'energy contracts need Gladys 5.2');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /^Unofficial/);
  assert.match(manifest.description.fr, /^Non officiel/);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
});

test('one version everywhere, semver, never pinned by hand twice', () => {
  const semver = /^\d+\.\d+\.\d+$/;
  assert.match(pkg.version, semver);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-edf-zen-flex:${pkg.version}`);
  assert.match(manifest.gladys_version, /^>=\d+\.\d+\.\d+$/, 'a range, never one version');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
});

test('every text is bilingual, and the words the rules forbid are absent', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  const all = [
    'gladys-assistant-integration.json',
    'README.md',
    'docs/en.md',
    'docs/fr.md',
    'src/i18n.js',
    'CHANGELOG.md',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(all, /chiffr|encrypt/i);
});

test('the configuration: an introduction only, no key prefixed gladys_, no secret', () => {
  assert.deepEqual(
    manifest.config_schema.map((f) => [f.key, f.type]),
    [['intro', 'section']],
  );
  for (const field of manifest.config_schema) {
    assert.doesNotMatch(field.key, /^gladys_/i);
    assert.equal(field.default, undefined);
    for (const link of field.links ?? []) assert.match(link.url, /^https:\/\//);
  }
  const intro = manifest.config_schema[0];
  assert.match(intro.description.fr, /Non officiel/);
  assert.match(intro.description.fr, /aucun jour n’est inventé/);
  assert.ok(intro.links.some((l) => /grille-prix-zen-week-end\.pdf$/.test(l.url)));
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the calendar, the template and the scene trigger match the code', () => {
  const { templates, calendars } = manifest.energy_contracts;
  assert.deepEqual(calendars, [
    { key: CALENDAR_KEY, granularity: 'day', timezone: TIMEZONE, values: DAY_TYPES },
  ]);
  assert.deepEqual([...new Set(Object.values(CODES))].sort(), [...DAY_TYPES].sort());
  assert.equal(templates.length, 1);
  const [template] = templates;
  assert.equal(template.key, TEMPLATE_KEY);
  assert.equal(template.pricing_mode, 'rules');
  assert.equal(template.country, 'FR');
  assert.equal(template.currency, 'EUR');
  assert.equal(template.timezone, TIMEZONE);
  assert.equal(template.version, '2026-09-15', 'the date of the EDF grid');
  assert.deepEqual(template.calendars, [CALENDAR_KEY]);
  assert.deepEqual(template.tariff.calendars, [CALENDAR_KEY]);
  for (const input of template.inputs) assert.notEqual(input.type, 'secret');
  const [trigger] = manifest.scene_triggers;
  assert.equal(manifest.scene_triggers.length, 1);
  assert.equal(trigger.key, TRIGGERS.DAY_ANNOUNCED);
  assert.deepEqual(
    trigger.fields[0].options.map((o) => o.value),
    DAY_TYPES,
  );
  assert.deepEqual(
    trigger.variables.map((v) => v.key),
    ['day_type', 'date'],
  );
});

test('the prices are those of the EDF grid of 2026-09-15 (Zen Week-End, Flex option)', () => {
  const inputs = Object.fromEntries(
    manifest.energy_contracts.templates[0].inputs.map((i) => [i.key, i.default]),
  );
  assert.deepEqual(inputs, {
    peak_slots: [
      ['08:00', '13:00'],
      ['18:00', '20:00'],
    ],
    eco_off_peak: 0.1595,
    eco_peak: 0.2142,
    sobriete_off_peak: 0.2142,
    sobriete_peak: 0.7467,
    subscription: 15.86,
  });
  const subscription = manifest.energy_contracts.templates[0].inputs.at(-1);
  for (const amount of ['15,86', '19,88', '23,76', '27,40', '31,14', '39,14', '46,47', '53,88']) {
    assert.ok(subscription.description.fr.includes(amount), amount);
  }
});

test('every select option follows the core rules (label, value, unique)', () => {
  for (const node of objects(manifest)) {
    if (!['select', 'multi_select'].includes(node.type) || !Array.isArray(node.options)) continue;
    if (node.options.every((o) => typeof o === 'string')) continue;
    const values = node.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    for (const option of node.options) {
      assert.ok(typeof option.value === 'string' || Number.isInteger(option.value));
      assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
      for (const lang of ['en', 'fr']) {
        assert.equal(typeof option.label[lang], 'string');
        assert.equal(option.label[lang], option.label[lang].trim());
        assert.ok(option.label[lang]);
      }
    }
  }
  assert.equal(JSON.stringify(manifest).includes('supported_options'), false);
});

const core = join(homedir(), 'code/Gladys/server/lib');
const runCore = async (t, script) => {
  // In a child process and a temporary directory: requiring the core opens
  // its database files in the working directory.
  const dir = await mkdtemp(join(tmpdir(), 'edf-zen-flex-core-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return spawnSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
  });
};

test(
  'the Gladys core validator accepts the manifest',
  { skip: !existsSync(core) && 'Gladys core not cloned' },
  async (t) => {
    const result = await runCore(
      t,
      `
      const mod = require(${JSON.stringify(join(core, 'external-integration/externalIntegration.validateManifest.js'))});
      const validate = mod.validateManifest ?? mod;
      try { validate(${JSON.stringify(manifest)}); process.exit(0); }
      catch (err) { console.log('INVALID', err.message, JSON.stringify(err.properties ?? err.errors ?? '')); process.exit(3); }
    `,
    );
    assert.equal(
      result.status,
      0,
      result.stdout
        .split('\n')
        .filter((l) => /INVALID/.test(l))
        .join('\n'),
    );
  },
);

test(
  'the Gladys pricing engine prices each kind of day and hour with the template',
  { skip: !existsSync(core) && 'Gladys core not cloned' },
  async (t) => {
    const template = manifest.energy_contracts.templates[0];
    const calendar = manifest.energy_contracts.calendars[0];
    // [Paris wall time, expected price per kWh, calendar value of the day (none: absent)]
    const cases = [
      ['2026-11-11T07:30', 0.1595, 'eco'],
      ['2026-11-11T08:00', 0.2142, 'eco'],
      ['2026-11-11T12:30', 0.2142, 'eco'],
      ['2026-11-11T13:00', 0.1595, 'eco'],
      ['2026-11-11T17:30', 0.1595, 'eco'],
      ['2026-11-11T18:00', 0.2142, 'eco'],
      ['2026-11-11T19:30', 0.2142, 'eco'],
      ['2026-11-11T20:00', 0.1595, 'eco'],
      ['2026-11-12T00:00', 0.2142, 'sobriete'],
      ['2026-11-12T07:30', 0.2142, 'sobriete'],
      ['2026-11-12T08:00', 0.7467, 'sobriete'],
      ['2026-11-12T12:30', 0.7467, 'sobriete'],
      ['2026-11-12T15:00', 0.2142, 'sobriete'],
      ['2026-11-12T18:30', 0.7467, 'sobriete'],
      ['2026-11-12T23:30', 0.2142, 'sobriete'],
      ['2026-11-13T09:00', 0.2142, 'bonus'],
      ['2026-11-13T03:00', 0.1595, 'bonus'],
      ['2026-11-14T09:00', 0.2142, undefined],
      ['2026-11-14T22:00', 0.1595, undefined],
      // The autumn change (25 hours) and the spring one (23 hours), Sobriété days on a test basis.
      ['2026-10-25T02:30', 0.2142, 'sobriete'],
      ['2026-10-25T18:00', 0.7467, 'sobriete'],
      ['2026-10-25T20:00', 0.2142, 'sobriete'],
      ['2027-03-28T03:30', 0.2142, 'sobriete'],
      ['2027-03-28T08:00', 0.7467, 'sobriete'],
      ['2027-03-28T13:00', 0.2142, 'sobriete'],
    ];
    const entries = [
      ...new Map(
        cases.filter((c) => c[2]).map(([wall, , value]) => [wall.slice(0, 10), value]),
      ).entries(),
    ].map(([date, value]) => ({ calendar_key: CALENDAR_KEY, date, value }));
    const result = await runCore(
      t,
      `
      const lib = ${JSON.stringify(core)};
      const { validateContractTariff } = require(lib + '/energy-contract/contract.validate.js');
      const { compileTariff } = require(lib + '/energy-contract/tariff.compile.js');
      const { priceIntervals } = require(lib + '/energy-contract/tariff.priceIntervals.js');
      const { createCalendarLookup } = require(lib + '/energy-contract/calendar.lookup.js');
      const dayjs = require(lib + '/../node_modules/dayjs');
      dayjs.extend(require(lib + '/../node_modules/dayjs/plugin/utc'));
      dayjs.extend(require(lib + '/../node_modules/dayjs/plugin/timezone'));
      const template = ${JSON.stringify(template)};
      const inputs = Object.fromEntries(template.inputs.map((i) => [i.key, i.default]));
      validateContractTariff(template.tariff, inputs, 'rules');
      // The energy only: the subscription is a fixed component the core adds apart.
      const energy = { ...template.tariff, components: template.tariff.components.filter((c) => c.kind === 'consumption') };
      const compiled = compileTariff(energy, inputs);
      const lookup = createCalendarLookup({ [${JSON.stringify(CALENDAR_KEY)}]: ${JSON.stringify(calendar)} }, ${JSON.stringify(entries)}, 'Europe/Paris');
      const walls = ${JSON.stringify(cases.map((c) => c[0]))};
      const intervals = walls.map((w) => ({ starts_at: dayjs.tz(w, 'Europe/Paris').toISOString(), kwh: 1 }));
      const out = priceIntervals(compiled, { timezone: 'Europe/Paris' }, intervals, { calendars: lookup });
      // The engine sorts the intervals: matched back by instant.
      const byStart = new Map(out.costs.map((c) => [new Date(c.starts_at).toISOString(), c]));
      console.log('RESULT' + JSON.stringify(intervals.map((i) => {
        const c = byStart.get(i.starts_at);
        return [i.starts_at, Math.round(c.cost * 1e6) / 1e6, c.label];
      })));
    `,
    );
    const line = result.stdout.split('\n').find((l) => l.startsWith('RESULT'));
    assert.ok(line, result.stderr || result.stdout);
    const costs = JSON.parse(line.slice(6));
    assert.equal(costs.length, cases.length);
    for (const [i, [wall, price]] of cases.entries()) {
      assert.equal(costs[i][1], price, `${wall}: ${costs[i][2]}`);
    }
  },
);
