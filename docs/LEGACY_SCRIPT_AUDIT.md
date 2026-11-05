# Script dependency and legacy audit

**Baseline:** `MooMF/bitburner-scripts` at the beginning of the dependency-audit change,
after base-game PR #5. Includes all JavaScript files in `bitburnerFiles/`.

## How this was classified

The sweep examines **literal `.js` filenames in script source**. It separates
**runtime dependencies** (executed, imported, deployed or read as data) from
mere mention (help text, inventory, diagnostics and cleanup lists). This avoids
mistaking absence of explicit references for proof that a script is unused.

- **Required:** currently executed/imported by the standard startup and reporting graph.
- **Optional:** invoked by a user, a special mode, or a non-default manager.
- **Compatibility:** intentionally maintained because users or scripts may call it.
- **Candidate legacy:** not part of the default startup route, but may have manual users.
- **Standalone:** has no incoming programmatic caller; this is normal for CLI commands.

**No legacy script was deleted.** A static sweep cannot establish absence of
manual scripts stored in the Bitburner save or third-party imports.

## Runtime execution/deployment graph

See [SCRIPT_DEPENDENCIES.md](SCRIPT_DEPENDENCIES.md) for the Mermaid diagram.

| Parent | Launches/imports/deploys | Why |
|---|---|---|
| `startup.js` | `clean.js`, `buy-servers.js` (optional), `upload.js`, `assign-targets.js`, `rent-capacity.js` (optional), `check-infection.js` | Standard operating sequence |
| `upload.js` | `process.js`, `iteration.js` and remote payload `infect*.js`, `weaken.js`, `grow.js`, `hack.js`, `rent-share.js` | Scans, roots, copies, starts target processes |
| `assign-targets.js` | `process.js`, `weaken.js`, `grow.js`, `hack.js` | Remote management of targets |
| `process.js` | `weaken.js`, `grow.js`, `hack.js` | One-shot worker selection |
| `rent-capacity.js` | `rent-share.js` | Spare-RAM work |
| `xp-farm.js` | `weaken.js` | Dedicated XP mode |
| `infect.js` | `infect-root.js`, `infect-deploy.js`, `infect-start.js` | Optional recursive infection path |
| `infect-start.js` | `infect.js`, `iteration.js`, `process.js` | Starts optional chain |
| `infect-deploy.js` | `process.js`, `iteration.js`, `infect*.js`, worker scripts | Payload copying |
| `check-infection.js` | `info-money.js`, `info-security.js`, `info-payouts.js`, `info-runtime.js`, `info-share.js`, `info-stock.js` (market mode) | Canonical management console |
| `manager-console.js` | `check-infection.js` | **Compatibility entrypoint** after consolidation |
| `info-contracts.js`, `info-contract-triage.js`, `solve-contracts.js`, test scripts | `contract-solvers.js` | Shared library import |
| `contract-help.js` | `help-contracts.js` | Optional compatibility naming alias |
| `clean.js` | Refers to managed script names | **Kill list, not an execution dependency** |
| `info-diagnostic.js` | Refers to expected script names | **Inventory list, not an execution dependency** |
| `info-money.js`, `info-security.js`, `info-runtime.js`, `info-payouts.js`, `info-share.js` | Refer to worker/manager names | **Observations**, not launches |

## Legacy candidates / careful review

| File/group | Current relationship | Disposition |
|---|---|---|
| `start-processes.js` | Older diagnostic launcher; not invoked by default startup | **Candidate legacy.** Confirm no manual usage; then archive/remove |
| `infect.js`, `infect-root.js`, `infect-deploy.js`, `infect-start.js` | Optional propagation pathway, *still copied by* `upload.js` and referenced in cleanup | **Optional, not orphaned.** Remove only after simplifying payload/cleanup/guide |
| `manager-console.js` | Previously full console, now thin alias to `check-infection.js` | **Compatibility**, keep until old commands retired |
| `check-infection.js` | Previously wrapper, now canonical complete console | **Required** |
| `iteration.js` | Deployed and started by `upload.js`, used by optional infection | **Keep** |
| `rent-share.js` | Worker for `rent-capacity.js` and referenced by faction-control/share diagnostics | **Keep** |
| `logview.js` | Manual diagnostic, also mentioned in cleanup | **Keep** |
| `session-gains.js` | Standalone reporting | **Keep** |
| `faction-control.js`, `backdoor-check.js` | Explicit player/progression commands, not startup dependencies | **Keep** |
| `info-startup-config.js` | Standalone advisor, not executed by startup by default | **Keep** — candidate for later orchestration integration |
| `info-infiltration.js`, `info-progression-gaps.js` | New independent reports | **Keep** |
| `stock-trader.js` | Standalone, deliberate opt-in; absent from startup | **Keep** |
| `help-*.js`, `contract-help.js` | Independent help entrypoints | **Keep** |

## Unreferenced does not mean redundant

Standalone utilities such as `buy-servers.js`, `backdoor-check.js`,
`solve-contracts.js`, `session-gains.js`, `info-diagnostic.js`,
`stock-trader.js`, `info-player.js` and test scripts are intended to be
run by the player and **should not be deleted** based solely on an incoming
reference count of zero.

## Consolidated management console

Before: `check-infection.js` immediately launched `manager-console.js`.
After: `check-infection.js` **contains the full reporting implementation**,
while `manager-console.js` is a minimal forwards-compatible alias.

- `run check-infection.js` starts the console directly, without the extra
  process/RAM cost of the old delegation.
- `run manager-console.js [mode]` still works by forwarding to the canonical console.
- All existing modes are retained: `overview`, `money`, `security`, `payouts`,
  `runtime`, `share`, `xp`, `actions`, `server <host>`, `market` and `marketing`.
- Startup's existing `run check-infection.js` path is unchanged.
- The new help scripts are independent read-only tools and do not alter startup behavior.

## Suggested next cleanup pass

1. Run standard `startup.js` and all management-console modes in-game.
2. Test optional infection deployment independently before declaring it obsolete.
3. Verify `start-processes.js` is not used manually, then archive it before removal.
4. If old infection is retired, remove its deployment/clean references **in one change**.
5. Maintain backwards-compatible aliases until real in-game usage is confirmed.

## Limits

Static analysis cannot infer computed filenames, dynamic import paths or
user-entered commands outside the repository. It also cannot certify that a
Bitburner save contains the same script versions. This audit is therefore an
evidence-based **candidate list**, not proof that a file is safe to delete.
