# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). Its code is its own: no third-party
code is copied or ported.

## edf-zen-flex (reference, knowledge only)

<https://github.com/AuroreVgn/edf-zen-flex> (commit `ed8788e`, 2026-11-03), a Home Assistant integration,
MIT licence, Copyright (c) 2026 Aurore.

What was learned from it: the address of the public EDF endpoint
(`https://particulier.edf.fr/services/rest/opm/getOPMStatut`, `dateRelevant` parameter), the names of its two
keys (`couleurJourJ`, `couleurJourJ1`) and the meaning of its codes (`RAS`, `ZENF_PM`, `ZENF_BONIF`). The
answer format and the `NON_DETERMINE` code were then checked on the endpoint itself (2026-11-11). Nothing of its
Python code, card or texts is used. Its licence text, for the record:

```
MIT License

Copyright (c) 2026 Aurore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other public clients of the endpoint (facts only)

The date form `YYYY-MM-DD` and the second Bonus code `ZENF_BONUS` were checked
against the public records of other clients of the same endpoint (review r2,
2026-11-11): [jarthod/tempo-api](https://github.com/jarthod/tempo-api) (VCR
cassettes recorded on 2026-03-10: `dateRelevant=2026-01-08`, and a
`ZENF_BONUS` day of 2025-10-16), MyElectricalData and JC144's exporters. Facts
only: none of their code is used.

## EDF (prices and rules)

The default prices, peak hours and day rules of the contract template come from public documents of EDF SA:
the price grid of the "Zen Week-End" offer applicable from 15 September 2026 to new contracts
(<https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/grille-prix-zen-week-end.pdf>) and the
general terms of the offer (Flex option, sections IV and V). They are facts restated, not copied documents.
"EDF", "Zen Week-End" and "Zen Flex" are names of EDF SA; this integration is not affiliated with EDF.
