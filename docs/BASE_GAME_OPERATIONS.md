# Bitburner base-game automation — current extension

This extends v2.4; the current hacking framework remains separately orchestrated.

## Coding contracts (29 contract types)

A deterministic solver catalogue lives in `bitburnerFiles/contract-solvers.js`.
Inventory and triage share its supported-type registry. The original `.cct`
files remain on their source servers; **do not copy** them.

```text
run test-contract-fixtures.js
run test-contract-dummies.js 3
run info-contracts.js
run info-contract-triage.js
run solve-contracts.js --dry
run solve-contracts.js --live
```

`solve-contracts.js` is now **dry by default**. `--live` is the only switch
allowing real contract attempts. Optional `--type`, `--server`, `--file`
select a subset. A dry calculation is *not* a game-validated solution.

Dummy-contract tests create/attempt only dummy contracts, exercise all game
types returned from `getContractTypes()`, and write
`/data/manager/contracts-dummy-tests.json`. Failed dummies are retained for
inspection. Run multiple samples before activating `--live`.
The fixture and dummy test harnesses must both be run in-game before treating
the library as fully verified; GitHub publishing alone is not validation.

## Stock-market reporting

```text
run info-stock.js
run manager-console.js marketing
run check-infection.js marketing
run stock-trader.js
run stock-trader.js --live
```

`marketing` is accepted as an alias of `market`. The detailed management
view reports cash, open long/short positions, average price, market value,
unrealized P/L, 4S forecast and volatility where available, and latest trader
signals. `stock-trader.js` is **not** started automatically.

The existing `startup.js` takes an optional **12th positional argument**
(index 11) for startup console view: `marketing` or `market`. For example:

```text
run startup.js true false 0.75 0.5 2 true true 60 0.5 false 10000 marketing
```

This selects the stock dashboard *without trading or changing the operating
strategy*. To switch views later: `run manager-console.js marketing`.

Trading needs TIX and 4S TIX API. Use dry-run before live trading.
`--live --loop` enables continuous **long-only** trading. Position/capital
limits do not coordinate with concurrent server purchases. Existing shorts are
reported but not automatically managed.

## Darknet

See `docs/DARKNET_SWARM_DESIGN.md`. This is an architectural proposal, not a
claim that a worm system is implemented. Normal network discovery cannot find
darknet topology; special `ns.dnet` semantics apply.

## Cleanup

The old monolithic `solve-contracts.js` solver functions and prime-file
dependency were replaced by a shared library. Compatibility
`check-infection.js`, `rent-share.js` and older infection support files
are retained to avoid breaking existing script references. No destructive
deletions were made to previously deployed operational scripts.
