# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+: install, the status, a Zen Flex contract on a
      meter, the costs of an Éco and a Sobriété day, the "day announced" trigger
      in a scene, the dashboard price widget.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store fields left out of the manifest: `keywords` (EDF, Zen Flex, Zen
      Week-End, Sobriété, Bonus, pointe mobile, contrat) and `countries` (`FR`).

## To confirm

- [ ] The bounds of a Sobriété day: midnight to midnight is assumed (the
      reference does the same, the EDF documents only give the hours). If EDF
      or Enedis switch days at another time (Tempo: 06:00), set `day_starts_at`
      on the calendar before the first release (it follows the owner's manifest).
- [ ] Whether the endpoint keeps its form after the winter 2026-2027 (first
      Sobriété and Bonus days read for real), and how a Bonus day is coded when
      EDF tells "reduce" or "shift" (only `ZENF_BONIF` is known).
- [ ] Whether a 503 for another date than today stays the rule (the module
      only asks today's date).

## Ideas

- A dashboard widget with today, tomorrow and the Sobriété days left.
- A "Sobriété peak hours start" scene trigger at 08:00 and 18:00 (the current
  price condition of the contract already covers it).

## Decisions

- **Version 0.1.0** set once by hand when leaving the template (package, lock
  file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-edf-zen-flex:0.1.0`);
  the Release workflow owns it from now on.
- **Undocumented endpoint of the EDF website**, accepted by Louis on
  2026-11-10: no account, the module's own User-Agent, never a browser's nor
  the app's; said in the manifest, the docs and the README ("the format may
  change"). A 403 pauses 6 hours: nothing tries to get around it.
- **`type: "provider"`, `gladys_version: ">=5.2.0"`**: no device, the energy
  contract and scene trigger capabilities (energy contracts need Gladys 5.2).
- **Rules template, not delegated**: the core engine expresses everything
  (`calendar` + `time` conditions, a fallback, a monthly fixed component), as
  for the core `edf-tempo` template. Checked by running the core validator and
  pricing engine on the template in `test/manifest.test.js` (each day and hour,
  both changes of time).
- **Calendar key `zen-flex`**, values `eco`, `sobriete`, `bonus` (no provider
  prefix, as the spec asks). Days published: Éco ones too (EDF says so); a day
  not announced is absent, never `eco` by default. The template prices an
  absent day as Éco (the fallback), as `edf-tempo` prices an absent day as blue.
- **Bonus days**: their own value in the calendar (scenes and history tell them
  apart), priced as Éco days in the template; the EDF reward is not computed.
- **Strict answer**: both keys required, each a known code or `NON_DETERMINE`;
  anything else refuses the whole answer (status "unreachable", nothing
  published). A known day answered `NON_DETERMINE` later stays known; a type
  changed by EDF replaces the old one (logged) and Gladys recalculates.
  Days answered on a weekend or outside the Sobriété season are published as
  EDF gives them (the meter follows EDF's signal), not second-guessed.
- **Schedule by slots** (Paris): 00:15, 10:15, 13:15, 16:15, 17:15, 19:15,
  22:15, each skipped when nothing is missing; MIN_GAP 10 minutes from `/data`
  and from a monotonic clock; timers cut to one hour. No faster polling than
  the source changes (once a day, by 16:00).
- **No configuration**: prices belong to the contract, filters to the scenes;
  the module never calls `getConfig()` (the fiche rule about `getConfig()` in
  `connected` does not apply).
- **Announcements**: the day before only (dropped once the day began),
  deduplicated by date and type in `/data`; a module started after midnight
  fires nothing for the current day.
- **Prices**: EDF grid "Zen Week-End" of 2026-09-15 (TTC), Flex option, the
  same kWh prices for every power; the subscription as a number input with
  the grid by power in its description (a select cannot set a fixed amount).
