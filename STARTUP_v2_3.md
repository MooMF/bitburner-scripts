# Bitburner Script Suite v2.3 - Quick Start

This is the short operating guide. For the full explanation, see:

```text
Bitburner_Script_Suite_v2_3_Manual.txt
```

## Normal startup

After an augmentation, reload, or manual reset, run:

```text
run startup.js true false
```

This performs the normal v2.3 launch sequence:

1. cleans managed money scripts;
2. cleans the share/rent layer;
3. deploys the current scripts from `home`;
4. assigns remote managers for low-RAM money targets;
5. starts the controlled spare-RAM share manager;
6. opens the management console through `check-infection.js`.

## Main dashboard

```text
run check-infection.js
```

`check-infection.js` is now a compatibility wrapper around:

```text
run manager-console.js
```

Useful dashboard modes:

```text
run manager-console.js overview
run manager-console.js runtime
run manager-console.js money
run manager-console.js security
run manager-console.js payouts
run manager-console.js share
run manager-console.js actions
run manager-console.js server 4sigma
```

## Buy or upgrade purchased/cloud servers

Spend 40% of current home cash:

```text
run buy-servers.js 0.4
```

Then redeploy so the new capacity is used:

```text
run startup.js true false
```

Or do both in one command:

```text
run startup.js true true 0.4
```

## Share/rent spare RAM

The normal startup command starts this automatically.

Manual default:

```text
run rent-capacity.js
```

Explicit conservative example:

```text
run rent-capacity.js 40 2048 false 10000
```

Explicit aggressive example:

```text
run rent-capacity.js 80 512 false 10000
```

Argument order:

```text
run rent-capacity.js <maxSharePct> <reserveGb> <includeHome> <loopMs>
```

Default values:

```text
maxSharePct = 60
reserveGb   = 1024
includeHome = false
loopMs      = 10000
```

## Manual redeploy sequence

Use this only if you want to step through the startup process manually:

```text
run clean.js managed
run clean.js share
run upload.js
run assign-targets.js 1 2
run rent-capacity.js 60 1024 false 10000
run check-infection.js
```

## Inspect one problem server

```text
run manager-console.js server <serverName>
run logview.js <hostName>
```

Example:

```text
run manager-console.js server 4sigma
run logview.js pserv-0
```

## What good looks like

A healthy system should trend toward:

```text
rooted servers       = total servers
managed targets      = money targets
payload missing      = 0
restart required     = false
money percentage     = rising
security excess      = falling
hack-ready targets   = eventually greater than zero
share manager        = running when spare RAM exists
```

Early after startup, it is normal to see mostly weaken/grow work and no hacking yet. Hacking begins only after money and security preparation succeeds.

## Common fixes

If the dashboard says deployment is incomplete:

```text
run startup.js true false
```

If server capacity changed:

```text
run startup.js true false
```

If many targets are unmanaged:

```text
run assign-targets.js 1 2
```

If share/rent appears stale:

```text
run clean.js share
run startup.js true false
```

If a server appears stuck:

```text
run manager-console.js server <serverName>
run logview.js <managerHost>
```

## Git/source-control note

The repo should normally hold scripts and documentation, not generated runtime state.

Recommended generated files to ignore include:

```text
data/**/*.json
catalog/**/*.json
found/**/*.json
servers.json
*_cat.json
*infect-version*.txt
restart-required.txt
process-state.json
session-gains-*.json
```

See the full manual for architecture, pseudocode, and next-step development areas.
