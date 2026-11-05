# Script dependencies (GitHub Mermaid)

The diagram distinguishes the standard runtime graph, optional execution,
pure library imports, and compatibility aliases. Reporting files are not
launched by the ordinary hacking worker pipeline.

```mermaid
flowchart LR
  classDef core fill:#e3f2fd,stroke:#2363a1,color:#123;
  classDef worker fill:#e9f7ef,stroke:#207348,color:#123;
  classDef optional fill:#fff2db,stroke:#a66a12,color:#123;
  classDef alias fill:#f0e7ff,stroke:#6f42a6,color:#123;

  subgraph Orchestration["Startup and server operations"]
    startup["startup.js"]
    clean["clean.js"]
    buy["buy-servers.js"]
    upload["upload.js"]
    assign["assign-targets.js"]
    process["process.js"]
    iteration["iteration.js"]
    hack["hack.js"]
    grow["grow.js"]
    weaken["weaken.js"]
  end
  startup --> clean
  startup -. "optional buy" .-> buy
  startup --> upload
  startup --> assign
  upload --> process
  upload --> iteration
  assign --> process
  process --> hack
  process --> grow
  process --> weaken

  subgraph Share["Share and XP"]
    rent["rent-capacity.js"]
    share["rent-share.js"]
    xp["xp-farm.js"]
  end
  startup -. "optional" .-> rent
  rent --> share
  xp -. "XP worker" .-> weaken

  subgraph Optional["Optional legacy propagation"]
    infect["infect.js"]
    ir["infect-root.js"]
    id["infect-deploy.js"]
    is["infect-start.js"]
    oldstart["start-processes.js"]
  end
  upload -. "staged payload" .-> infect
  infect --> ir
  infect --> id
  infect --> is
  is -. "recursive" .-> infect
  is --> process
  is --> iteration
  oldstart -. "standalone diagnostic" .-> process

  subgraph Reporting["Unified console and reporting"]
    console["check-infection.js"]
    legacy["manager-console.js (alias)"]
    money["info-money.js"]
    security["info-security.js"]
    payouts["info-payouts.js"]
    runtime["info-runtime.js"]
    shareinfo["info-share.js"]
    stockinfo["info-stock.js"]
    stocktrader["stock-trader.js"]
  end
  startup --> console
  legacy --> console
  console --> money
  console --> security
  console --> payouts
  console --> runtime
  console --> shareinfo
  console -. "market / marketing view" .-> stockinfo
  stocktrader -. "independent live opt-in" .-> stockinfo

  subgraph Contracts["Contracts"]
    inv["info-contracts.js"]
    triage["info-contract-triage.js"]
    solver["solve-contracts.js"]
    library["contract-solvers.js"]
    testF["test-contract-fixtures.js"]
    testD["test-contract-dummies.js"]
  end
  inv --> library
  triage --> library
  solver --> library
  testF --> library
  testD --> library
  inv -. "JSON inventory" .-> triage
  triage -. "JSON triage" .-> solver

  class startup,upload,assign,process,console core;
  class hack,grow,weaken,iteration,share,library worker;
  class infect,ir,id,is,oldstart,rent,xp,stocktrader optional;
  class legacy alias;
```

### Other standalone scripts

- `info-diagnostic.js`, `info-startup-config.js`, `info-player.js`,
  `session-gains.js`, `backdoor-check.js`, `faction-control.js`,
  `info-infiltration.js`, `info-progression-gaps.js`, `logview.js`.
- `help-market.js`, `help-contracts.js`, `help-network.js`,
  `help-servers.js`, `help-share.js`, `help-diagnostics.js`,
  `help-progression.js`, `help-darknet.js`. Alias:
  `contract-help.js` → `help-contracts.js`.

In the graph, solid arrows normally represent execution, imports or deployed
dependencies; dotted arrows show optional paths, modes or document/report-only
relationships. `clean.js` and `info-diagnostic.js` refer to other scripts
by name for cleanup/observation without launching them.

For all audited references, classifications and safe cleanup candidates, see
[LEGACY_SCRIPT_AUDIT.md](LEGACY_SCRIPT_AUDIT.md).
