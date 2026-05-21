# Bitburner Script Suite v2 — Quick Start

## Purpose

This is the short operating guide for the Version 2 script suite.

Use this when you just want to get the system running and monitor it.

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
| `check-infection.js` | Main operational dashboard |
| `logview.js` | Inspect one server's running script logs |
| `clean.js` | Kill managed scripts for reset/redeploy |

---

## Normal Startup

After augmentation, restart, or loading the game:

```text
run startup.js true false
```

This will:

1. clean managed scripts;
2. deploy the payload with `upload.js`;
3. assign remote targets with `assign-targets.js`;
4. launch `check-infection.js`.

---

## Buy/Upgrade Servers

To spend 40% of current home cash buying/upgrading purchased/cloud servers:

```text
run buy-servers.js 0.4
```

After it finishes, run:

```text
run startup.js true false
```

Reason: buying/upgrading changes available capacity, so the framework should be redeployed and remote targets reassigned.

You can also do both in one startup run, if your current `startup.js` supports it:

```text
run startup.js true true 0.4
```

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
- weaken/grow/hack distribution;
- total RAM use;
- purchased/cloud server status;
- whether a restart/redeploy is recommended;
- what command to run next.

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

If supported by your saved version, avoid using money servers as worker hosts:

```text
run assign-targets.js 1 2 false
```

---

## What Good Looks Like

A healthy `check-infection.js` report should trend toward:

```text
Servers rooted:        100%
Payload deployed:      100%
Fully staged:          100%
Money servers managed: high, ideally 90%+
RAM used:              high but not totally saturated
Current money:         rising over time
Cycle distribution:    weaken/grow first, hack later
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
