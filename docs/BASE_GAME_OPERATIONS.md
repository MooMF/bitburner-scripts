# Base-game operations: incremental expansion

This branch adds independent, opt-in financial and intelligence tools. It does **not**
alter the v2.4 hacking orchestration, or run stock trades automatically on startup.

## Commands (run from home)

| Command | Purpose | Side effects |
|---|---|---|
| `run info-stock.js` | Snapshot stock prices, ownership, forecast (with 4S API) | Writes JSON only |
| `run stock-trader.js` | One 4S forecast-based dry run | Writes JSON only |
| `run stock-trader.js --live` | Execute a **single** pass of long-only orders | Buys/sells stock |
| `run stock-trader.js --live --loop` | Continuous live 4S trading | Buys/sells stock |
| `run info-infiltration.js` | Enumerate infiltration locations and rewards | Writes JSON only |
| `run info-progression-gaps.js` | Audit program inventory and remaining automation gaps | Writes JSON only |

Outputs are written to `/data/manager/`. Ensure that directory is supported in
your game version. All scripts are standalone and should be copied to game `home`.

### Trading policy

Trader requires TIX and 4S TIX API. It does not buy those unlocks automatically,
cannot run in early game without them, and does **not** implement estimation before 4S.
Default reserve is $1bn, per-symbol long exposure is capped at 15% of total liquid
capital, and aggregate long exposure at 70%. Entry threshold is 0.60 and exit
threshold 0.52. Only whole shares are traded. Orders are market orders. Fee is
included in sizing; no shorts are opened, and existing shorts are never managed.
Flags: `--reserve`, `--max-position`, `--max-exposure`, `--entry`, `--exit`.
Read reports and test one live cycle before running a loop. Trading does not
coordinate capital locks with `buy-servers.js` yet: avoid simultaneous spending.

## Existing contracts system

`info-contracts.js` discovers contract handles, `info-contract-triage.js`
classifies them, and `solve-contracts.js` submits implemented types. Solver
coverage is **not complete**. Run `solve-contracts.js --dry` first and
review the result report. Do not treat a dry-run-computed answer as game-validated.

## Not automated

- Crime and legacy Dark Web purchases need Singularity access.
- Company infiltration supports read-only enumeration; there is no normal
  Netscript API to execute the minigames.
- The newer Darknet (`ns.dnet`) is a distinct network subsystem: implementation
  is deliberately deferred until discovery, session and failure semantics are tested.
- Completing remaining coding-contract solvers and exhaustive dummy-contract
  testing is a separate follow-up, not silently claimed as complete.

## Cleanup review

Existing `check-infection.js` is a compatibility entrypoint for
`manager-console.js`, **not redundant**. `rent-share.js` is a worker and
must be retained. `infect-*.js` and `start-processes.js` are legacy/diagnostic,
but currently preserved to avoid disrupting saved deployments and references.
No destructive cleanup has been undertaken without verifying dependencies.

## Recommended sequence

1. Pull scripts onto game home and run read-only reports.
2. Validate 4S availability and review a dry-run trade.
3. Execute a single live trading pass only after reviewing capital allocation.
4. Revisit missing contract solver types and add dummy-contract tests.
5. Add independent Darknet exploration without coupling it to standard `upload.js`.
