# Bitburner Script Suite v2.4 - Quick Start

This is the short operating guide. For the full explanation, see:

```text
Bitburner_Script_Suite_v2_4_Manual.txt
```

## Normal startup

After an augmentation, reload, or manual reset:

```text
run startup.js true false
```

Current tested `startup.js` defaults:

```text
clean                 = true
buyServers            = false
buySpendRatio         = 0.75
assignMinRam          = 0.5
assignPerHost         = 2
assignAllowMoneyHosts = true
startRent             = true
rentMaxSharePct       = 60
rentReserveGb         = 0.5
rentIncludeHome       = false
rentLoopMs            = 10000
```

Startup performs the normal sequence:

1. clean managed money scripts;
2. clean the share/rent layer;
3. optionally buy/upgrade servers;
4. deploy current scripts from `home`;
5. assign remote managers;
6. start controlled spare-RAM sharing;
7. open the management console through `check-infection.js`.

## Main dashboard

Compatibility entry point:

```text
run check-infection.js
```

Direct entry point:

```text
run manager-console.js
```

Useful views:

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

## Purchased/cloud servers

Spend 40% of current home cash:

```text
run buy-servers.js 0.4
```

Dry-run an explicit plan:

```text
run buy-servers.js 0.5 pserv- true
```

After capacity changes:

```text
run startup.js true false
```

Or buy as part of startup:

```text
run startup.js true true 0.4
```

`buy-servers.js` records bought/cloud ownership in:

```text
/data/purchased-servers.json
```

Detection is API-first with registry fallback; the suite does not rely on a naming prefix to identify owned servers.

## Remote target assignment

Normal startup passes its own first three assignment settings. For direct use, the current tested `assign-targets.js` defaults are:

```text
minWorkerRam             = 1
maxAssignmentsPerHost    = 4
allowMoneyHosts          = false
forceRemoteSmallTargets  = true
localRamThreshold        = 128
reserveGb                = 8
```

Explicit recommended direct command:

```text
run assign-targets.js 1 4 false true 128 8
```

## Share/rent spare RAM

Normal startup starts this automatically.

Manual form:

```text
run rent-capacity.js <maxSharePct> <reserveGb> <includeHome> <loopMs>
```

Startup currently invokes it with:

```text
60 0.5 false 10000
```

## Manual redeploy sequence

```text
run clean.js managed
run clean.js share
run upload.js
run assign-targets.js 1 4 false true 128 8
run rent-capacity.js 60 0.5 false 10000
run check-infection.js
```

## Coding contracts

The v2.4 contract pipeline is:

```text
info-contracts.js
    -> /data/manager/contracts.json

info-contract-triage.js
    -> /data/manager/contracts-triage.json

solve-contracts.js
    -> /data/manager/contracts-solve-results.json
```

Safe sequence:

```text
run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

If the dry run looks correct:

```text
run solve-contracts.js
```

Useful filters:

```text
run solve-contracts.js --type prime --dry
run solve-contracts.js --type encryption --dry
run solve-contracts.js --type stock --dry
```

Current implemented solvers:

```text
Find Largest Prime Factor
Encryption I: Caesar Cipher
Encryption II: Vigenère Cipher
Algorithmic Stock Trader I
Algorithmic Stock Trader II
Algorithmic Stock Trader III
Algorithmic Stock Trader IV
```

### After an augmentation

Generated contract reports can survive while their `.cct` handles no longer exist. Clear them before building the new queue:

```text
rm /data/manager/contracts.json
rm /data/manager/contracts-triage.json
rm /data/manager/contracts-solve-results.json

run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

`solve-contracts.js` prefers `contracts-triage.json` over `contracts.json`, so a stale triage file can cause:

```text
Contract file no longer exists on source server.
```

## Backdoor checker

Current tested v2.4 commands:

```text
run backdoor-check.js
run backdoor-check.js status
run backdoor-check.js routes
run backdoor-check.js auto
run backdoor-check.js auto --world
```

Current behaviour:

- scans the live network on each run;
- reports all eligible rooted, hack-ready, unbackdoored non-owned servers;
- skips `home`, `darkweb`, purchased servers and known purchased naming patterns;
- prioritises notable faction/progression servers in the report;
- detects `AutoLink.exe`;
- prints pasteable terminal routes;
- excludes `w0r1d_d43m0n` unless `--world` is supplied;
- contains Singularity auto-install support when that API is available.

On the current BN1 run Singularity is unavailable, so use the printed manual route and finish with:

```text
backdoor
```

A future critical-only filter is a proposed change, not part of the tested v2.4 release.

## Player/progression diagnostics

```text
run info-player.js
run info-player.js full
```

Writes:

```text
/data/manager/player.json
```

## XP farming

`xp-farm.js` is available as a specialist hacking-XP tool. It is not part of normal startup.

## Inspect one problem server

```text
run manager-console.js server <serverName>
run logview.js <hostName>
```

## What good looks like

A healthy system should trend toward:

```text
rooted servers       = total reachable servers
managed targets      = rooted money targets
payload missing      = 0
restart required     = false
money percentage     = rising
security excess      = falling
hack-ready targets   = eventually > 0
share manager        = using genuinely spare RAM
```

Immediately after startup it is normal to see mostly weaken/grow work and little or no hacking.

## Common fixes

Deployment/capacity changed:

```text
run startup.js true false
```

Rooted targets unmanaged:

```text
run assign-targets.js 1 4 false true 128 8
```

Share layer stale:

```text
run clean.js share
run startup.js true false
```

Contract handles stale:

```text
rm /data/manager/contracts.json
rm /data/manager/contracts-triage.json
rm /data/manager/contracts-solve-results.json
run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

## Git/source-control policy

The repository contains maintained source and documentation, not generated runtime state.

Ignored generated areas include:

```text
bitburnerFiles/catalog/
bitburnerFiles/data/
bitburnerFiles/found/
bitburnerFiles/scripts/
```

Generated state patterns are also ignored, including catalogue files, process state, restart markers, session gains, purchased-server runtime registry, and infection-version markers.

## Development workflow

```text
1. Agree the improvement.
2. Produce a complete drop-in/new file.
3. Test it in live Bitburner.
4. Sync the tested file into the local/repository source tree.
5. Commit/push the tested version.
```

Local repository:

```text
C:\Users\Jim\Documents\bitburnerScripts
```

Remote repository:

```text
MooMF/bitburner-scripts
```
