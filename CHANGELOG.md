# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The type of each EDF Zen Flex day (Éco, Sobriété, Bonus), read from the public
  page of the EDF website the day before (no account, the module's own
  User-Agent), fed to the `zen-flex` tariff calendar of Gladys. A day not
  announced stays unknown; an answer of an unexpected form is refused as a
  whole and shown in the status.
- The "EDF Zen Flex" contract template, priced by the Gladys rule engine:
  Éco and Sobriété days, peak hours 08:00-13:00 and 18:00-20:00, prices and
  subscription pre-filled from the EDF grid of 2026-09-15.
- The scene trigger "EDF Zen Flex day announced", with the type and the date
  of tomorrow, once per announced day.
- Readings at fixed Paris times only while something is missing (3 a normal
  day), never closer than 10 minutes, restarts included; pauses on 429 and 403.
- The status names the days of the Sobriété season never read (priced as Éco
  days, never caught up: EDF answers for today and tomorrow only).
