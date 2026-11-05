# Darknet swarm design (proposed, not yet active)

## Assessment

A manager with distributed neighbor-probing worms is a good architecture for an
unstable network. It must not be built on ordinary `ns.scan()`: that API excludes
Darknet servers. Agents use `ns.dnet.probe()` relative to their current host.

### API constraints

- The remote target of `authenticate()` must be directly connected to the
  running script. Successful authentication grants a session **to the PID**,
  not to every script on that host.
- `connectToSession(host,password)` can obtain a fresh per-script session
  at a distance, but `exec()` still requires direct connectivity, a backdoor
  or a stasis link. Copying files with `scp()` to darknet destinations also
  requires a session.
- Nodes move, restart (killing running agents), or disappear. Hostnames can be
  reused with changed credentials: never treat historical access as current.
- Stasis links are limited; reserve for high-value relay nodes.
- Persistent state should be anchored on home because darknet servers and
  processes are ephemeral. Avoid network-wide backdooring, which can increase
  instability.

## Proposed components

1. `dnet-manager.js` (home): stable inventory, priority frontier, queue,
   deduplication and retries; reports immutable snapshots to home JSON.
2. `dnet-worm.js` (darknet): bounded local `probe()`, authenticated
   neighbor discovery, parent/child heartbeat, and observations.
3. `dnet-relay.js` (optional): forwards small deltas/acknowledgements to
   available peers, with hop-count and message-ID deduplication.

Messages need `origin`, `sessionEpoch`, `observedAt`, `nodeIP` and
`messageId`. The manager merges observations as last-seen state with
expiration; it does not assume network topology is monotonic. Include stale,
lost, moved, blocked and re-auth-required states.

## Important refinement to the worm idea

Information gossip alone does not grant authentication sessions or execution
rights. An agent that encounters a previously known node still needs a valid
session, and migration can invalidate the current route. Rather than rely on
*eventual return of a single worm*, use a home-based append-only report stream
whenever communications are possible, with local retry queues for partitions.
Use `nextMutation()` to trigger re-probing; do not busy-spin.

Start with a read-only discovery/report phase. Add authentication/propagation
only after observing the current game behavior and API failure codes.

References: Bitburner 3.x `Darknet` API and `NS.scp`/ `NS.scan` docs.
