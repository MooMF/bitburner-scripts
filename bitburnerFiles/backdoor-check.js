/** @param {NS} ns */
export async function main(ns) {
    const TARGETS = {
        "CSEC": {
            type: "FACTION",
            reason: "CyberSec"
        },
        "avmnite-02h": {
            type: "FACTION",
            reason: "NiteSec"
        },
        "I.I.I.I": {
            type: "FACTION",
            reason: "The Black Hand"
        },
        "run4theh111z": {
            type: "FACTION",
            reason: "BitRunners"
        },
        "fulcrumassets": {
            type: "FACTION",
            reason: "Fulcrum Secret Technologies"
        },
        "powerhouse-fitness": {
            type: "ACHIEVEMENT",
            reason: "DISCOUNT achievement"
        },
        "w0r1d_d43m0n": {
            type: "PROGRESSION",
            reason: "BitNode completion"
        }
    };

    const playerHack = ns.getHackingLevel();
    const discovered = scanNetwork(ns);
    const rows = [];

    for (const [hostname, meta] of Object.entries(TARGETS)) {
        if (!discovered.has(hostname)) continue;

        const server = ns.getServer(hostname);
        const path = findPath(ns, "home", hostname);
        const rooted = server.hasAdminRights;
        const hackReady = playerHack >= server.requiredHackingSkill;
        const backdoored = server.backdoorInstalled;

        let status;
        if (backdoored) status = "DONE";
        else if (!rooted) status = "NO ROOT";
        else if (!hackReady) status = "LEVEL";
        else status = "READY";

        rows.push({
            hostname,
            ...meta,
            status,
            rooted,
            requiredHack: server.requiredHackingSkill,
            path,
            backdoored
        });
    }

    const order = { READY: 0, "NO ROOT": 1, LEVEL: 2, DONE: 3 };
    rows.sort((a, b) =>
        order[a.status] - order[b.status] ||
        a.requiredHack - b.requiredHack ||
        a.hostname.localeCompare(b.hostname)
    );

    ns.tprint("");
    ns.tprint("=== CRITICAL BACKDOORS ===");
    ns.tprint(`Hacking level: ${playerHack}`);
    ns.tprint("");

    for (const row of rows) {
        const req = row.requiredHack.toLocaleString();
        ns.tprint(`${row.status.padEnd(7)} ${row.hostname.padEnd(20)} [${row.type}] ${row.reason} (hack ${req})`);

        if (row.status === "READY" && row.path.length > 0) {
            ns.tprint(`         ${buildCommand(row.path)}`);
        } else if (row.status === "LEVEL") {
            ns.tprint(`         Need hacking ${req} (${Math.max(0, row.requiredHack - playerHack).toLocaleString()} more)`);
        }
    }

    const pending = rows.filter(r => !r.backdoored);
    const ready = rows.filter(r => r.status === "READY");
    const done = rows.filter(r => r.backdoored);

    ns.tprint("");
    ns.tprint(`Critical discovered: ${rows.length} | Done: ${done.length} | Ready now: ${ready.length} | Pending: ${pending.length}`);

    if (ready.length > 0) {
        ns.tprint("");
        ns.tprint("NEXT:");
        ns.tprint(`  ${buildCommand(ready[0].path)}`);
    } else if (pending.length === 0 && rows.length > 0) {
        ns.tprint("All currently discovered critical backdoors are installed.");
    } else {
        ns.tprint("No critical backdoors are currently ready.");
    }
}

function scanNetwork(ns) {
    const found = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbour of ns.scan(current)) {
            if (found.has(neighbour)) continue;
            found.add(neighbour);
            queue.push(neighbour);
        }
    }

    return found;
}

function findPath(ns, start, target) {
    if (start === target) return [start];

    const queue = [[start]];
    const visited = new Set([start]);

    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];

        for (const neighbour of ns.scan(current)) {
            if (visited.has(neighbour)) continue;

            const nextPath = [...path, neighbour];
            if (neighbour === target) return nextPath;

            visited.add(neighbour);
            queue.push(nextPath);
        }
    }

    return [];
}

function buildCommand(path) {
    if (!path || path.length < 2) return "";
    return path.slice(1).map(host => `connect ${host}`).join("; ") + "; backdoor";
}
