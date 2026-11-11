# gladys-edf-zen-flex

[Gladys Assistant](https://gladysassistant.com) external integration for the French **EDF Zen Flex** offer
("Zen Week-End – Option Flex"): the type of each day (Éco, Sobriété, Bonus), announced by EDF the day before,
fed to the `zen-flex` tariff calendar of Gladys; an **EDF Zen Flex** contract template priced by the Gladys rule
engine from that calendar; and a scene trigger "EDF Zen Flex day announced". **Unofficial, not affiliated with
EDF. Not tested on a real Gladys with a Zen Flex contract yet** (the EDF endpoint was read for real on
2026-11-11, the template priced on the Gladys 5.3 engine).

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (App)    schedule, /data, calendar, scene trigger, status
                 ├─ src/http.js      the only network access (module User-Agent, timeout, 4 KB cap, no redirect)
                 ├─ src/edf.js       the answer checked: known codes or refused as a whole (pure)
                 ├─ src/schedule.js  the next reading time (pure)
                 ├─ src/time.js      Paris dates and wall times (pure)
                 └─ src/store.js     /data state file (atomic writes, missing ≠ unreadable)
```

- **Source**: `https://particulier.edf.fr/services/rest/opm/getOPMStatut?dateRelevant=YYYY-MM-DD`, the public
  endpoint the Zen Flex page of the EDF website reads, **undocumented** (use accepted by the maintainer on
  2026-11-10). No account, no cookie kept, the module's own User-Agent
  (`gladys-edf-zen-flex/<version> (+https://github.com/LM1LC3N7/gladys-edf-zen-flex)`), never a browser's nor
  the app's, and no other parameter. The module asks only for the current Paris date, and gets
  `{"couleurJourJ": …, "couleurJourJ1": …}`: `RAS` (Éco), `ZENF_PM` (Sobriété), `ZENF_BONIF` or `ZENF_BONUS` (Bonus) or
  `NON_DETERMINE` (not announced). Any other form is refused as a whole: the status says "unexpected form",
  nothing is published, **no day is ever made up**. The format may change at any time.
- **Schedule** (Paris): 00:15 when today is unknown; 10:15, 13:15, 16:15, 17:15, 19:15, 22:15 when today or
  tomorrow is unknown (EDF announces by 16:00), and 16:15 once more when tomorrow was read before 16:00. A normal
  day: 3 requests. A slot missed while stopped is caught
  up at once. Two requests are at least 10 minutes apart (the attempt is written to `/data` first; with `/data`
  not writable, the first request of a process waits 10 minutes; within a process, a monotonic clock). No timer
  waits more than an hour, so a wall clock change is seen. Errors: 5 (raised to 10), 15, 30, 60 minutes, then
  every 2 hours; 429: its Retry-After within [1 min, 6 h] (30 min when absent), kept in `/data`; 403: 6 hours;
  3xx: an error, never followed. `dateRelevant` is `YYYY-MM-DD` with leading zeros, the form recorded
  for real on this path on a day 1-9 (jarthod/tempo-api cassettes, 2026-01-08).
- **Missed days**: the module only reads today and tomorrow, so a day missed entirely is not caught up
  (priced as Éco by the template); the status names the weekdays of the Sobriété season (public holidays
  excepted) never read since the first reading, a year back at most.
- **Calendar** `zen-flex` (daily, Europe/Paris, values `eco`, `sobriete`, `bonus`): every day read is sent once
  Gladys accepted it (kept in `/data`), from 5 years back to tomorrow; yesterday, today and tomorrow are read
  back at each connection (a restored database gets them again; older days are left alone, since the core
  purges the entries older than its oldest consumption). A 403 (another integration owns the key) is said in the
  status and asked again at the next connection. Failures retry after 1, 5, 15, then every 30 minutes.
- **Template** `edf-zen-flex` (`rules`, version `2026-09-15`): Sobriété peak, Sobriété off-peak, Éco peak, then
  Éco off-peak as fallback; peak hours an input (08:00-13:00, 18:00-20:00); four prices and the subscription as
  inputs, pre-filled from the EDF grid of 2026-09-15. A Bonus day and a day absent from the calendar price as Éco.
- **Scene trigger** `day_announced` (`day_type`, `date`): fired when tomorrow's type is first read, again if the
  16:15 reading finds it changed, retried until midnight, never once the day began; deduplicated in `/data`.
- **Status**: today, tomorrow, the Sobriété and Bonus days seen this year, the last reading, what failed;
  published in the background, each state once.

## Credits

The endpoint and its codes were learned from [edf-zen-flex](https://github.com/AuroreVgn/edf-zen-flex) (Home
Assistant integration, MIT, AuroreVgn); no code is copied (see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Prices and rules: EDF price grid and general terms of the
offer (2026-09-15). The tariff calendar follows the core `edf-tempo` service and the sibling
[gladys-edf-zen-weekend](https://github.com/guim31/gladys-edf-zen-weekend).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run mutants                                 # mutation check (scripts/mutants.json)
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network (the HTTP and real-clock tests use a local server): Gladys is the SDK's fake, the
timers run on a virtual clock. When the Gladys core is cloned in `~/code/Gladys`, `test/manifest.test.js` also
runs its manifest validator and prices the template with its tariff engine (each kind of day and hour, both
changes of time).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the version in `package.json` and the
manifest, rolls `CHANGELOG.md`, tags, builds the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`); the notice of the reference project is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (both shipped in the Docker image).
