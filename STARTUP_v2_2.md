# Bitburner Script Suite v2.2 — Quick Start

## Purpose

This is the short operating guide for the Version 2.2 script suite.

Use this when you just want to start the framework, expand servers, monitor health, or use spare RAM for reputation sharing.

---

## Core Scripts

| Script | Purpose |
|---|---|
| `startup.js` | One-command launch after restart/augmentation |
| `buy-servers.js` | Buy/upgrade purchased/cloud servers |
| `upload.js` | Deploy/refresh scripts across the network |
| `assign-targets.js` | Assign low-RAM targets to bigger worker hosts |
| `process.js` | Persistent weaken/grow/hack manager |
| `weaken.js` / `grow.js` / `hack.js` | One-shot worker scripts |
| `rent-capacity.js` | Fill spare RAM with `ns.share()` workers |
| `rent-share.js` | Tiny looping `ns.share()` worker |
| `check-infection.js` | Main compact v3 operational dashboard |
| `logview.js` | Inspect one server's running script logs |
| `clean.js` | Kill managed scripts for reset/redeploy |
| `iteration.js` | Catalogue useful discovered files |

---

## Normal Startup

After augmentation, restart, or loading the game:

```text
run startup.js true false
```

This will normally:

1. clean managed scripts;
2. deploy the payload with `upload.js`;
3. assign remote targets with `assign-targets.js`;
4. start spare-capacity sharing with `rent-capacity.js`;
5. launch `check-infection.js`.

---

## Startup With Server Buying

To clean, buy/upgrade servers using 40% of current home cash, deploy, assign, start sharing, and open the dashboard:

```text
run startup.js true true 0.4
```

The default spend ratio is 50% if omitted.

---

## Buy/Upgrade Servers Separately

To spend 40% of current home cash buying/upgrading purchased/cloud servers:

```text
run buy-servers.js 0.4
```

After it finishes, run:

```text
run startup.js true false
```

Reason: buying/upgrading changes available capacity, so the framework should be redeployed and remote targets reassigned.

---

## Spare-Capacity Sharing

Version 2.2 includes a spare-capacity layer.

`rent-capacity.js` fills unused RAM with `rent-share.js`, which loops `ns.share()`. This helps faction reputation gain. It is not direct cash rental.

Default command:

```text
run rent-capacity.js
```

Explicit default-style command:

```text
run rent-capacity.js 8 0.98 5000 1 false rep
```

Meaning:

| Argument | Meaning |
|---|---|
| `8` | Leave 8GB free per host |
| `0.98` | Use up to 98% RAM per host |
| `5000` | Rescan every 5 seconds |
| `1` | Minimum 1 thread before launching |
| `false` | Do not use home |
| `rep` | Reputation/share mode |

Normally you do not need to run this manually because `startup.js` starts it by default.

---

## Monitor the System

Main dashboard:

```text
run check-infection.js
```

This tells you:

- whether all known servers are rooted;
- whether the payload is deployed;
- how many money servers are managed;
- how many are locally versus remotely managed;
- weaken/grow/hack/share distribution;
- total RAM use;
- purchased/cloud server status;
- spare-capacity share status;
- approximate next-cycle forecasts;
- whether a restart/redeploy is recommended;
- what command to run next.

Useful variants:

```text
run check-infection.js 200
run check-infection.js 200 true
run check-infection.js 120 false false
```

The first shows more rows. The second includes non-money servers. The third disables colour.

---

## Inspect One Server

Use this when `check-infection.js` points at a specific server:

```text
run logview.js serverName
```

Example:

```text
run logview.js sigma-cosmetics
```

Optional refresh and line-count settings:

```text
run logview.js sigma-cosmetics 3000 80
```

---

## Manual Redeploy Sequence

If you want to do the startup flow manually:

```text
run clean.js managed
run upload.js
run assign-targets.js 1 2
run rent-capacity.js
run check-infection.js
```

---

## Remote Assignment Tuning

Normal:

```text
run assign-targets.js 1 2
```

Conservative:

```text
run assign-targets.js 1 1
```

More aggressive:

```text
run assign-targets.js 1 3
```

Avoid using money servers as worker hosts:

```text
run assign-targets.js 1 2 false
```

---

## Full Startup Argument Pattern

```text
run startup.js [clean] [buyServers] [buySpendRatio] [assignMinRam] [assignPerHost] [assignAllowMoneyHosts] [startRent] [rentReserveGb] [rentTargetUsePct] [rentLoopMs] [rentMinThreads] [rentIncludeHome]
```

Example with explicit normal-style settings:

```text
run startup.js true false 0.5 1 2 true true 8 0.98 5000 1 false
```

---

## What Good Looks Like

A healthy `check-infection.js` report should trend toward:

```text
Servers rooted:        100%
Payload deployed:      100%
Fully staged:          high / complete where relevant
Money servers managed: high, ideally 90%+
RAM used:              high but not completely jammed
Current money:         rising over time
Cycle distribution:    weaken/grow first, hack later
Share threads:         present when spare RAM exists
```

At the start of a run, it is normal to see mostly:

```text
weaken
grow
```

Do not expect much hacking until money and security recover.

---

## Important Dashboard Interpretation

### `processIdle`

Usually not fatal. It can mean the dashboard sampled the server between worker launches.

Confirm with:

```text
run logview.js serverName
```

### `lowRam`

The server cannot run `process.js` locally. Use remote assignment:

```text
run assign-targets.js 1 2
```

### `restart recommended`

Usually means `buy-servers.js` changed purchased/cloud server capacity.

Run:

```text
run startup.js true false
```

### `remoteManaged`

Good. It means another host is managing that money server.

### `share`

Good, provided the core hack/grow/weaken layer is already running. It means spare RAM is being used by `rent-share.js` for `ns.share()` reputation support.

---

## Minimal Daily Flow

```text
run check-infection.js
```

If it recommends restart:

```text
run startup.js true false
```

If you have spare money and want more capacity:

```text
run buy-servers.js 0.4
run startup.js true false
```

If a server looks odd:

```text
run logview.js serverName
```
