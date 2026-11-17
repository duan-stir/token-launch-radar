# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/duan-stir/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/duan-stir/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the protocols that record no token yet, ranks them by what a launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and a six-step farm plan each.

The model follows only from the snapshot's own figures: implied value = TVL × category multiple × growth multiplier × maturity multiplier. The category multiple is the median market-cap-to-TVL ratio of the snapshot's live-token protocols in the same category (at least 3 comparables, else the all-category median), clamped to 0.02–1.50; the growth multiplier comes from the 7-day TVL change, clamped to −60%…+120%; the maturity multiplier grows with the protocol's age up to 3 years. No protocol name is ever special-cased. Protocols whose token already trades are kept apart in a separate live view, at the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. It runs on Node.js 22.18 or later, standard library only, with no network. Open `out/dashboard/index.html` in a browser to use the dashboard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=04crj4yk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
