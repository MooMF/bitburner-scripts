# Operational help scripts

Each `help-<subject>.js` is a self-contained in-game help page. Commands and
purpose text are based on the repository's actual script files. All help pages
are read-only; they check which referenced scripts are present and show
`[OK]`, `[MISSING]` or `[DOC]` markers.

| Subject | Run | Covers |
|---|---|---|
| Market | `run help-market.js` | TIX / 4S reporting, strategy, order modes, market console |
| Contracts | `run help-contracts.js` | inventory, triage, 30 solvers, fixtures, dummy tests, safe live flag |
| Network | `run help-network.js` | startup, rooting, deployment, assignments, workers, optional infection |
| Servers | `run help-servers.js` | purchased servers, allocation, cleanup, startup recommendations |
| Share | `run help-share.js` | spare-RAM sharing, XP farm, faction share |
| Diagnostics | `run help-diagnostics.js` | unified console modes, child reports, logview, AI handoff |
| Progression | `run help-progression.js` | backdoors, factions, player stats, Dark Web, infiltration |
| Darknet | `run help-darknet.js` | planned (not installed) swarm architecture |
| Contracts alias | `run contract-help.js` | forwards to `help-contracts.js` |

Optional flags on canonical help scripts: `--short` (compact output),
`--missing` (only missing installed scripts), and `--json` (print structured
data for AI handoff).

Example:
```text
run help-market.js
run help-contracts.js --short
run help-network.js --missing
run help-diagnostics.js --json
```

**There is no hidden execution:** help pages never automatically start live
trading, submit contracts, or run cleanup/deployment.
