/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("assign-targets.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Assign Remote Targets");
    ns.clearLog();

    const minWorkerRam = Number(ns.args[0] ?? 1);
    const maxAssignmentsPerHost = Number(ns.args[1] ?? 2);
    const allowMoneyHosts = parseBool(ns.args[2] ?? true);

    const processScript = "process.js";

    const requiredScripts = [
        "process.js",
        "weaken.js",
        "grow.js",
        "hack.js"
    ];

    for (const script of requiredScripts) {
        if (!ns.fileExists(script, "home")) {
            ns.print(`ERROR: Missing ${script} on home.`);
            return -2;
        }
    }

    const servers = getAllServers(ns, "home")
        .filter(s => s !== "home")
        .sort((a, b) => a.localeCompare(b));

    ns.print("Remote target reassignment starting.");
    ns.print(`Minimum worker RAM: ${minWorkerRam}GB`);
    ns.print(`Max assignments per host: ${maxAssignmentsPerHost}`);
    ns.print(`Allow money servers as worker hosts: ${allowMoneyHosts}`);
    ns.print("");

    const killed = await killExistingRemoteAssignments(ns, servers);

    ns.print("");
    ns.print(`Killed remote assignment processes/workers: ${killed}`);
    ns.print("");

    const targets = getTargetsNeedingRemoteManagement(ns, servers)
        .sort((a, b) => scoreTarget(ns, b) - scoreTarget(ns, a));

    const workerHosts = getWorkerHosts(ns, servers, minWorkerRam, allowMoneyHosts);

    ns.print(`Remote targets needing assignment: ${targets.length}`);
    ns.print(`Candidate worker hosts: ${workerHosts.length}`);
    ns.print("");

    if (targets.length === 0) {
        ns.print("No remote targets needed.");
        return 0;
    }

    if (workerHosts.length === 0) {
        ns.print("No suitable worker hosts found.");
        return -3;
    }

    for (const host of workerHosts) {
        await ns.scp(requiredScripts, host, "home");
        await ns.sleep(5);
    }

    const hostAssignments = new Map();
    const assignments = [];
    const failures = [];

    for (const target of targets) {
        const host = chooseWorkerHost(
            ns,
            workerHosts,
            hostAssignments,
            maxAssignmentsPerHost,
            processScript
        );

        if (!host) {
            failures.push({
                target,
                host: "-",
                reason: "no worker host with available RAM / assignment capacity"
            });

            ns.print(`FAIL ${target}: no worker host available.`);
            continue;
        }

        const result = startRemoteProcess(ns, host, target, processScript);

        if (result.pid > 0) {
            hostAssignments.set(host, (hostAssignments.get(host) ?? 0) + 1);

            assignments.push({
                host,
                target,
                pid: result.pid
            });

            ns.print(`OK ${target} -> ${host}; PID ${result.pid}`);
        } else {
            failures.push({
                target,
                host,
                reason: result.reason
            });

            ns.print(`FAIL ${target} -> ${host}: ${result.reason}`);
        }

        await ns.sleep(25);
    }

    ns.print("");
    ns.print("Assignment complete.");
    ns.print(`Assignments created: ${assignments.length}/${targets.length}`);
    ns.print(`Failures: ${failures.length}`);

    ns.print("");
    ns.print("Assignments");
    ns.print(table(
        ["Target", "Host", "PID"],
        assignments.map(a => [a.target, a.host, String(a.pid)])
    ));

    if (failures.length > 0) {
        ns.print("");
        ns.print("Failures");
        ns.print(table(
            ["Target", "Host", "Reason"],
            failures.map(f => [f.target, f.host ?? "-", f.reason])
        ));
    }

    ns.print("");
    ns.print("Next command:");
    ns.print("run check-infection.js");

    return assignments.length;
}

async function killExistingRemoteAssignments(ns, servers) {
    const workerScripts = [
        "process.js",
        "weaken.js",
        "grow.js",
        "hack.js"
    ];

    let killed = 0;

    for (const host of servers) {
        const processes = ns.ps(host);

        for (const proc of processes) {
            if (!workerScripts.includes(proc.filename)) continue;
            if (!proc.args || proc.args.length === 0) continue;

            const target = String(proc.args[0]);

            // Preserve local process.js managers and their local workers.
            if (target === host) continue;

            if (!ns.serverExists(target)) continue;

            ns.kill(proc.pid);
            killed++;

            ns.print(`Killed ${proc.filename} PID ${proc.pid} on ${host} for remote target ${target}`);
            await ns.sleep(5);
        }
    }

    return killed;
}

function getTargetsNeedingRemoteManagement(ns, servers) {
    const targets = [];

    for (const server of servers) {
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerMaxMoney(server) <= 0) continue;

        if (isLocallyManaged(ns, server)) continue;
        if (isRemotelyManaged(ns, servers, server)) continue;

        targets.push(server);
    }

    return targets;
}

function getWorkerHosts(ns, servers, minWorkerRam, allowMoneyHosts) {
    const preferred = [];
    const fallback = [];

    for (const server of servers) {
        if (!ns.hasRootAccess(server)) continue;

        const maxRam = ns.getServerMaxRam(server);
        if (maxRam < minWorkerRam) continue;

        const isMoneyServer = ns.getServerMaxMoney(server) > 0;

        if (!isMoneyServer) {
            preferred.push(server);
        } else if (allowMoneyHosts) {
            fallback.push(server);
        }
    }

    preferred.sort((a, b) => hostScore(ns, b) - hostScore(ns, a));
    fallback.sort((a, b) => hostScore(ns, b) - hostScore(ns, a));

    return [...preferred, ...fallback];
}

function chooseWorkerHost(ns, hosts, hostAssignments, maxAssignmentsPerHost, processScript) {
    for (const host of hosts) {
        const assigned = hostAssignments.get(host) ?? countExistingRemoteAssignments(ns, host);

        if (assigned >= maxAssignmentsPerHost) continue;
        if (!ns.fileExists(processScript, host)) continue;

        const processRam = ns.getScriptRam(processScript, host);
        const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

        if (freeRam >= processRam) {
            return host;
        }
    }

    return null;
}

function startRemoteProcess(ns, host, target, processScript) {
    if (!ns.serverExists(host)) {
        return { pid: 0, reason: "host does not exist" };
    }

    if (!ns.serverExists(target)) {
        return { pid: 0, reason: "target does not exist" };
    }

    if (!ns.hasRootAccess(host)) {
        return { pid: 0, reason: "no root on host" };
    }

    if (!ns.hasRootAccess(target)) {
        return { pid: 0, reason: "no root on target" };
    }

    if (!ns.fileExists(processScript, host)) {
        return { pid: 0, reason: "process.js missing on host" };
    }

    const alreadyRunning = ns.ps(host).some(p =>
        p.filename === processScript &&
        p.args.length > 0 &&
        String(p.args[0]) === String(target)
    );

    if (alreadyRunning) {
        return { pid: 0, reason: "already running" };
    }

    const ram = ns.getScriptRam(processScript, host);
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

    if (ram <= 0) {
        return { pid: 0, reason: `process.js RAM reported as ${ram}` };
    }

    if (free < ram) {
        return {
            pid: 0,
            reason: `not enough RAM; free ${free.toFixed(2)}GB, need ${ram.toFixed(2)}GB`
        };
    }

    const pid = ns.exec(processScript, host, 1, target);

    if (pid === 0) {
        return { pid: 0, reason: "ns.exec returned 0" };
    }

    return { pid, reason: "started" };
}

function isLocallyManaged(ns, server) {
    return ns.ps(server).some(p =>
        p.filename === "process.js" &&
        p.args.length > 0 &&
        String(p.args[0]) === String(server)
    );
}

function isRemotelyManaged(ns, servers, target) {
    for (const host of servers) {
        if (host === target) continue;

        const found = ns.ps(host).some(p =>
            p.filename === "process.js" &&
            p.args.length > 0 &&
            String(p.args[0]) === String(target)
        );

        if (found) return true;
    }

    return false;
}

function countExistingRemoteAssignments(ns, host) {
    return ns.ps(host).filter(p =>
        p.filename === "process.js" &&
        p.args.length > 0 &&
        String(p.args[0]) !== String(host) &&
        ns.serverExists(String(p.args[0]))
    ).length;
}

function scoreTarget(ns, server) {
    const maxMoney = ns.getServerMaxMoney(server);
    const minSec = ns.getServerMinSecurityLevel(server);
    const hackLevel = ns.getServerRequiredHackingLevel(server);

    return maxMoney / Math.max(1, minSec) / Math.max(1, hackLevel);
}

function hostScore(ns, server) {
    const maxRam = ns.getServerMaxRam(server);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = maxRam - usedRam;

    const nonMoneyBonus = ns.getServerMaxMoney(server) <= 0 ? 10_000 : 0;
    const purchasedBonus = server.startsWith("pserv-") ? 20_000 : 0;
    const moomBonus = server.startsWith("MooMF") ? 15_000 : 0;

    return freeRam + maxRam + nonMoneyBonus + purchasedBonus + moomBonus;
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();

        if (seen.has(server)) continue;
        seen.add(server);

        for (const next of ns.scan(server)) {
            if (!seen.has(next)) {
                stack.push(next);
            }
        }
    }

    return [...seen];
}

function table(headers, rows) {
    if (!rows || rows.length === 0) return "(none)";

    const all = [headers, ...rows];

    const widths = headers.map((_, i) =>
        Math.max(...all.map(row => String(row[i] ?? "").length))
    );

    const fmt = row =>
        row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ");

    return [
        fmt(headers),
        widths.map(w => "-".repeat(w)).join("-|-"),
        ...rows.map(fmt)
    ].join("\n");
}

function parseBool(value) {
    if (value === true) return true;
    if (value === false) return false;

    const text = String(value).toLowerCase();

    return text === "true" ||
        text === "1" ||
        text === "yes" ||
        text === "y";
}

async function openLargeTail(ns, title = null) {
    ns.ui.openTail();

    try {
        if (title && ns.ui.setTailTitle) {
            ns.ui.setTailTitle(title);
        }
    } catch {
        // Ignore title failures.
    }

    await ns.sleep(50);

    try {
        if (!ns.ui.windowSize || !ns.ui.resizeTail || !ns.ui.moveTail) return;

        const size = ns.ui.windowSize();
        const width = Array.isArray(size) ? size[0] : size.width;
        const height = Array.isArray(size) ? size[1] : size.height;

        if (!width || !height) return;

        ns.ui.moveTail(10, 10);
        ns.ui.resizeTail(Math.max(500, width - 30), Math.max(350, height - 60));
    } catch {
        // Leave default size.
    }
}