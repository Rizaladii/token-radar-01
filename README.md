# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Rizaladii/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Rizaladii/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — the best token launch radar: every pre-token protocol in the sealed DefiLlama snapshot, ranked by an implied token value derived only from the snapshot's own figures, with a concrete six-step farm plan for each row.

## The value model (radar-2)

```
implied = TVL × sectorMultiple × growthMult × maturityMult × breadthMult
```

- **sectorMultiple** — the protocol's category band: prediction, launchpad, RWA and payments 0.42; Dex, derivatives, lending, CDP, basis and insurance 0.33; yield, farms, risk curators and allocators 0.26; restaking, liquid staking and bridges 0.22; everything else 0.28.
- **growthMult** — 1 + clamp(7-day TVL change, −80%, +200%) ÷ 100 × 0.6.
- **maturityMult** — 0.55 + min(age in days, 1460) ÷ 1460 × 0.45; unknown age counts as 365 days.
- **breadthMult** — 1 + min(chains − 1, 5) × 0.025.

No protocol name is ever special-cased. Protocols whose token already trades are never ranked: they appear apart in the dashboard's "Already trading" view at their market's own value.

## The board

226 rows: all 40 watchlist protocols (TVL at or above the $50M floor, no token recorded) plus 186 early finds — pre-token protocols below the floor, by TVL. Every row carries six farm steps with a cost and a time, derived from the protocol's category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` to the output, and writes `dossier.json` with the vendored `vendor/makefun-board.ts`. Two runs write byte-identical output.

## Dashboard

`dashboard/` is a static page with no network: a sortable, filterable board, a detail view for every protocol (model breakdown plus farm plan), the already-trading view, and the method section. Open `dashboard/index.html` with the generated `data.js` beside it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=f4mz6c1w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
