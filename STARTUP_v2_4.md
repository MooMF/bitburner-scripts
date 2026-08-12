# Bitburner Script Suite v2.4 - Quick Start

This is the short operating guide. For the full explanation, see:

```text
Bitburner_Script_Suite_v2_4_Manual.txt
```

## Normal startup

After an augmentation, reload, or manual reset, run:

```text
run startup.js true false
```

This performs the normal v2.4 launch sequence:

1. cleans managed money scripts;
2. cleans the share/rent layer;
3. deploys the current scripts from `home`;
4. assigns remote managers for low-RAM money targets;
5. starts the controlled spare-RAM share manager;
6. opens the management console through `check-infection.js`.

## Main dashboard

Compatibility command:

```text
run check-infection.js
```

Direct command:

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

Then redeploy:

```text
run startup.js true false
```

Or combine purchase and startup:

```text
run startup.js true true 0.4
```

## Share/rent spare RAM

Normal startup starts the share manager automatically.

Manual default:

```text
run rent-capacity.js
```

Conservative:

```text
run rent-capacity.js 40 2048 false 10000
```

Aggressive:

```text
run rent-capacity.js 80 512 false 10000
```

Argument order:

```text
run rent-capacity.js <maxSharePct> <reserveGb> <includeHome> <loopMs>
```

Typical defaults:

```text
maxSharePct = 60
reserveGb   = 1024
includeHome = false
loopMs      = 10000
```

## Manual redeploy sequence

Use this when stepping through startup manually:

```text
run clean.js managed
run clean.js share
run upload.js
run assign-targets.js 1 2
run rent-capacity.js 60 1024 false 10000
run check-infection.js
```

## Coding contracts

Contract handling is now a three-stage workflow:

```text
info-contracts.js
    -> /data/manager/contracts.json

info-contract-triage.js
    -> /data/manager/contracts-triage.json

solve-contracts.js
    -> /data/manager/contracts-solve-results.json
```

Normal safe sequence:

```text
run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

If the dry run looks correct:

```text
run solve-contracts.js
```

Useful solver filters:

```text
run solve-contracts.js --type prime --dry
run solve-contracts.js --type encryption --dry
run solve-contracts.js --type stock --dry
```

### After an augmentation

Contract JSON can survive even though the underlying `.cct` contracts have changed.

Clean stale state first:

```text
rm /data/manager/contracts.json
rm /data/manager/contracts-triage.json
rm /data/manager/contracts-solve-results.json

run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

Important:

`solve-contracts.js` prefers:

```text
/data/manager/contracts-triage.json
```

over:

```text
/data/manager/contracts.json
```

So a stale triage file can cause:

```text
Contract file no longer exists on source server.
```

even after `info-contracts.js` has been refreshed.

## Backdoor checker

On BN1, use:

```text
run backdoor-check.js
```

The v2.4 checker is intended to show only useful backdoors:

```text
CSEC
avmnite-02h
I.I.I.I
run4theh111z
fulcrumassets
powerhouse-fitness
w0r1d_d43m0n
```

These cover faction, progression, and achievement-related targets.

On BN1 the checker is advisory/manual because automatic backdoor installation
requires Singularity access.

For a READY server, use the route printed by the script and finish with:

```text
backdoor
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

Early after startup it is normal to see mostly weaken/grow work and little or
no hacking. Hacking starts once money and security preparation succeeds.

## Common fixes

Deployment incomplete:

```text
run startup.js true false
```

Server capacity changed:

```text
run startup.js true false
```

Many unmanaged targets:

```text
run assign-targets.js 1 2
```

Share/rent appears stale:

```text
run clean.js share
run startup.js true false
```

Server appears stuck:

```text
run manager-console.js server <serverName>
run logview.js <managerHost>
```

Contract solver reports missing source files:

```text
rm /data/manager/contracts.json
rm /data/manager/contracts-triage.json
rm /data/manager/contracts-solve-results.json

run info-contracts.js silent
run info-contract-triage.js silent
run solve-contracts.js --dry
```

## Git/source-control note

The repository should contain maintained scripts and documentation, not generated
runtime state.

Generated areas to ignore include:

```text
bitburnerFiles/catalog/
bitburnerFiles/data/
bitburnerFiles/found/
bitburnerFiles/scripts/
```

Generated root/state files to ignore include:

```text
servers.json
home_cat.json
*_cat.json
process-state*.json
restart-required.txt
session-gains-*.json
purchased-servers.json
*infect-version*.txt
```

## Development workflow

For project changes:

```text
1. Agree the improvement.
2. Produce a complete copy/paste drop-in file or new file.
3. Test it in the live Bitburner environment.
4. Sync the tested file into the local repository.
5. Commit/push the tested version to Git.
```

Local repository:

```text
C:\Users\Jim\Documents\bitburnerScripts
```

Remote repository:

```text
MooMF/bitburner-scripts
```

See `Bitburner_Script_Suite_v2_4_Manual.txt` for architecture, script interaction,
contract details, backdoor handling, source-control policy, and development notes.
