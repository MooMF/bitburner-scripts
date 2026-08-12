/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("assign-targets.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Assign Remote Targets");
    ns.clearLog();

    /*
        Args:
        run assign-targets.js [minWorkerRam] [maxAssignmentsPerHost] [allowMoneyHosts] [forceRemoteSmallTargets] [localRamThreshold] [reserveGb]

        Recommended:
        run assign-targets.js 1 4 false true 128 8
    */

    const minWorkerRam = Number(ns.args[0] ?? 1);
    const maxAssignmentsPerHost = Number(ns.args[1] ?? 4);
    const allowMoneyHosts = parseBool(ns.args[2] ?? false);
    const forceRemoteSmallTargets = parseBool(ns.args[3] ?? true);
    const localRamThreshold = Number(ns.args[4] ?? 128);
    const reserveGb = Number(ns.args[5] ?? 8);

    const registryFile = "/data/purchased-servers.json";
    const processScript = "process.js";
    const requiredScripts = ["process.js", "weaken.js", "grow.js", "hack.js"];

    for (const script of requiredScripts) {
        if (!ns.fileExists(script, "home")) {
            ns.tprint(`ERROR: Missing ${script} on home.`);
            return -2;
        }
    }

    const servers = getAllServers(ns, "home").filter(s => s !== "home").sort();
    const ownedServers = getOwnedServerSet(ns, registryFile);

    ns.print("Remote target assignment");
    ns.print(`Minimum worker RAM:           ${fmtRam(ns, minWorkerRam)}`);
    ns.print(`Max assignments per host:     ${maxAssignmentsPerHost}`);
    ns.print(`Allow money hosts as workers: ${allowMoneyHosts}`);
    ns.print(`Force remote small targets:   ${forceRemoteSmallTargets}`);
    ns.print(`Local RAM threshold:          ${fmtRam(ns, localRamThreshold)}`);
    ns.print(`Worker reserve:               ${fmtRam(ns, reserveGb)}`);
    ns.print(`Bought/cloud servers known:   ${ownedServers.size}`);
    ns.print("Detection: API first, registry second, no prefix assumption.");
    ns.print("");

    const killed = await killExistingRemoteManagersAndTheirWorkers(ns, servers);
    ns.print(`Killed previous remote assignment processes/workers: ${killed}`);

    const workerHosts = getWorkerHosts(ns, servers, minWorkerRam, allowMoneyHosts)
        .sort((a, b) => hostScore(ns, b, ownedServers) - hostScore(ns, a, ownedServers));

    ns.print(`Candidate worker hosts: ${workerHosts.length}`);

    if (workerHosts.length === 0) {
        ns.tprint("ERROR: No suitable worker hosts found.");
        return -3;
    }

    for (const host of workerHosts) {
        await ns.scp(requiredScripts, host, "home");
        await ns.sleep(5);
    }

    const targets = getTargetsForRemoteManagement(ns, servers, {
        forceRemoteSmallTargets,
        localRamThreshold,
        workerHosts
    }).sort((a, b) => scoreTarget(ns, b.name) - scoreTarget(ns, a.name));

    ns.print(`Remote targets selected: ${targets.length}`);
    ns.print("");

    if (targets.length === 0) {
        ns.print("No remote targets currently need assignment.");
        printWorkerSummary(ns, workerHosts, ownedServers);
        return 0;
    }

    ns.print("Selected targets");
    ns.print(table(
        ["Target", "Reason", "Local RAM", "Money", "Security"],
        targets.map(t => [
            t.name,
            t.reason,
            fmtRam(ns, ns.getServerMaxRam(t.name)),
            fmtMoneyPct(ns, ns.getServerMoneyAvailable(t.name), ns.getServerMaxMoney(t.name)),
            fmtSecurity(ns, t.name)
        ])
    ));
    ns.print("");

    const hostAssignments = new Map();
    const assignments = [];
    const failures = [];
    let killedLocal = 0;

    for (const targetInfo of targets) {
        const target = targetInfo.name;

        if (targetInfo.killLocal) {
            killedLocal += killLocalManagedTarget(ns, target);
            await ns.sleep(10);
        }

        const host = chooseWorkerHost(ns, {
            hosts: workerHosts,
            hostAssignments,
            maxAssignmentsPerHost,
            processScript,
            reserveGb,
            ownedServers
        });

        if (!host) {
            failures.push({ target, host: "-", reason: "no worker host with enough available RAM/capacity" });
            ns.print(`FAIL ${target}: no worker host available.`);
            continue;
        }

        const result = startRemoteProcess(ns, host, target, processScript);

        if (result.pid > 0) {
            hostAssignments.set(host, (hostAssignments.get(host) ?? countExistingRemoteAssignments(ns, host)) + 1);
            assignments.push({ target, host, pid: result.pid, reason: targetInfo.reason });
            ns.print(`OK ${target} -> ${host}; PID ${result.pid}`);
        } else {
            failures.push({ target, host, reason: result.reason });
            ns.print(`FAIL ${target} -> ${host}: ${result.reason}`);
        }

        await ns.sleep(25);
    }

    ns.print("");
    ns.print("Assignment complete.");
    ns.print(`Assignments created: ${assignments.length}/${targets.length}`);
    ns.print(`Local managers killed: ${killedLocal}`);
    ns.print(`Failures: ${failures.length}`);

    ns.print("");
    ns.print("Assignments");
    ns.print(table(
        ["Target", "Host", "PID", "Reason"],
        assignments.map(a => [a.target, a.host, String(a.pid), a.reason])
    ));

    printWorkerSummary(ns, workerHosts, ownedServers);

    if (failures.length > 0) {
        ns.print("");
        ns.print("Failures");
        ns.print(table(
            ["Target", "Host", "Reason"],
            failures.map(f => [f.target, f.host, f.reason])
        ));
    }

    return assignments.length;
}

function getCloudApi(ns) {
    if (ns.cloud && typeof ns.cloud.getServerNames === "function") {
        return { available: true, mode: "ns.cloud", getNames: () => ns.cloud.getServerNames() };
    }

    if (typeof ns.getPurchasedServers === "function") {
        return { available: true, mode: "legacy purchased-server API", getNames: () => ns.getPurchasedServers() };
    }

    return { available: false, mode: "none", getNames: () => [] };
}

function getOwnedServerSet(ns, registryFile = "/data/purchased-servers.json") {
    const owned = new Set();
    const cloud = getCloudApi(ns);

    try {
        if (cloud.available) {
            for (const name of cloud.getNames()) {
                if (name && ns.serverExists(name)) owned.add(name);
            }
        }
    } catch {}

    try {
        if (ns.fileExists(registryFile, "home")) {
            const registry = JSON.parse(ns.read(registryFile));
            for (const item of registry.servers ?? []) {
                const name = typeof item === "string" ? item : item.name;
                if (name && ns.serverExists(name)) owned.add(name);
            }
        }
    } catch {}

    return owned;
}

async function killExistingRemoteManagersAndTheirWorkers(ns, servers) {
    const workerScripts = new Set(["weaken.js", "grow.js", "hack.js"]);
    const killedPairs = [];
    let killed = 0;

    for (const host of servers) {
        for (const proc of ns.ps(host)) {
            if (proc.filename !== "process.js") continue;
            if (!proc.args || proc.args.length === 0) continue;

            const target = String(proc.args[0]);
            if (target === host) continue;
            if (!ns.serverExists(target)) continue;

            ns.kill(proc.pid);
            killed++;
            killedPairs.push({ host, target });
            ns.print(`Killed remote process manager PID ${proc.pid} on ${host} for ${target}`);
            await ns.sleep(5);
        }
    }

    for (const pair of killedPairs) {
        for (const proc of ns.ps(pair.host)) {
            if (!workerScripts.has(proc.filename)) continue;
            if (!proc.args || proc.args.length === 0) continue;
            if (String(proc.args[0]) !== pair.target) continue;

            ns.kill(proc.pid);
            killed++;
            ns.print(`Killed stale ${proc.filename} PID ${proc.pid} on ${pair.host} for ${pair.target}`);
            await ns.sleep(5);
        }
    }

    return killed;
}

function getTargetsForRemoteManagement(ns, servers, options) {
    const targets = [];

    for (const server of servers) {
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerMaxMoney(server) <= 0) continue;

        const remoteManager = findRemoteManager(ns, servers, server);
        if (remoteManager) continue;

        const localManager = isLocallyManaged(ns, server);
        const maxRam = ns.getServerMaxRam(server);

        if (!localManager) {
            targets.push({ name: server, reason: "unmanaged", killLocal: false });
            continue;
        }

        if (
            options.forceRemoteSmallTargets &&
            maxRam < options.localRamThreshold &&
            hasBetterWorkerAvailable(ns, server, options.workerHosts, maxRam)
        ) {
            targets.push({ name: server, reason: `local-small<${options.localRamThreshold}GB`, killLocal: true });
        }
    }

    return targets;
}

function hasBetterWorkerAvailable(ns, target, workerHosts, targetRam) {
    for (const host of workerHosts) {
        if (host === target) continue;
        if (!ns.hasRootAccess(host)) continue;
        if (ns.getServerMaxRam(host) > targetRam) return true;
    }
    return false;
}

function getWorkerHosts(ns, servers, minWorkerRam, allowMoneyHosts) {
    const preferred = [];
    const fallback = [];

    for (const server of servers) {
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerMaxRam(server) < minWorkerRam) continue;

        const isMoneyServer = ns.getServerMaxMoney(server) > 0;
        if (!isMoneyServer) preferred.push(server);
        else if (allowMoneyHosts) fallback.push(server);
    }

    return [...preferred, ...fallback];
}

function chooseWorkerHost(ns, options) {
    const { hosts, hostAssignments, maxAssignmentsPerHost, processScript, reserveGb, ownedServers } = options;
    let best = null;
    let bestScore = -Infinity;

    for (const host of hosts) {
        const assigned = hostAssignments.get(host) ?? countExistingRemoteAssignments(ns, host);
        if (assigned >= maxAssignmentsPerHost) continue;
        if (!ns.fileExists(processScript, host)) continue;

        const processRam = ns.getScriptRam(processScript, host);
        const maxRam = ns.getServerMaxRam(host);
        const usedRam = ns.getServerUsedRam(host);
        const usableRam = Math.max(0, maxRam - usedRam - reserveGb);

        if (processRam <= 0 || usableRam < processRam) continue;

        const score = hostScore(ns, host, ownedServers) + usableRam - assigned * 1000;
        if (score > bestScore) {
            best = host;
            bestScore = score;
        }
    }

    return best;
}

function startRemoteProcess(ns, host, target, processScript) {
    if (!ns.serverExists(host)) return { pid: 0, reason: "host does not exist" };
    if (!ns.serverExists(target)) return { pid: 0, reason: "target does not exist" };
    if (!ns.hasRootAccess(host)) return { pid: 0, reason: "no root on host" };
    if (!ns.hasRootAccess(target)) return { pid: 0, reason: "no root on target" };
    if (!ns.fileExists(processScript, host)) return { pid: 0, reason: "process.js missing on host" };

    const alreadyRunning = ns.ps(host).some(p =>
        p.filename === processScript &&
        p.args.length > 0 &&
        String(p.args[0]) === String(target)
    );

    if (alreadyRunning) return { pid: 0, reason: "already running" };

    const ram = ns.getScriptRam(processScript, host);
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

    if (ram <= 0) return { pid: 0, reason: `process.js RAM reported as ${ram}` };
    if (free < ram) return { pid: 0, reason: `not enough RAM; free ${free.toFixed(2)}GB, need ${ram.toFixed(2)}GB` };

    const pid = ns.exec(processScript, host, 1, target);
    if (pid === 0) return { pid: 0, reason: "ns.exec returned 0" };

    return { pid, reason: "started" };
}

function killLocalManagedTarget(ns, target) {
    let killed = 0;
    const scripts = new Set(["process.js", "weaken.js", "grow.js", "hack.js"]);

    for (const proc of ns.ps(target)) {
        if (!scripts.has(proc.filename)) continue;

        if (
            proc.filename === "process.js" ||
            (proc.args && proc.args.length > 0 && String(proc.args[0]) === String(target))
        ) {
            ns.kill(proc.pid);
            killed++;
        }
    }

    return killed;
}

function isLocallyManaged(ns, server) {
    return ns.ps(server).some(p =>
        p.filename === "process.js" &&
        p.args.length > 0 &&
        String(p.args[0]) === String(server)
    );
}

function findRemoteManager(ns, servers, target) {
    for (const host of servers) {
        if (host === target) continue;
        const found = ns.ps(host).some(p =>
            p.filename === "process.js" &&
            p.args.length > 0 &&
            String(p.args[0]) === String(target)
        );
        if (found) return host;
    }
    return null;
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
    const currentSec = ns.getServerSecurityLevel(server);
    const hackLevel = ns.getServerRequiredHackingLevel(server);
    const currentMoney = ns.getServerMoneyAvailable(server);
    const securityPressure = Math.max(0, currentSec - minSec);
    const moneyGap = Math.max(0, maxMoney - currentMoney);

    return maxMoney / Math.max(1, minSec) / Math.max(1, hackLevel) + securityPressure * 1_000_000 + moneyGap / 1_000_000;
}

function hostScore(ns, server, ownedServers) {
    const maxRam = ns.getServerMaxRam(server);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = maxRam - usedRam;
    const nonMoneyBonus = ns.getServerMaxMoney(server) <= 0 ? 10_000 : 0;
    const ownedBonus = ownedServers.has(server) ? 25_000 : 0;

    return freeRam + maxRam + nonMoneyBonus + ownedBonus;
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();
        if (seen.has(server)) continue;
        seen.add(server);
        for (const next of ns.scan(server)) {
            if (!seen.has(next)) stack.push(next);
        }
    }

    return [...seen];
}

function printWorkerSummary(ns, workerHosts, ownedServers) {
    ns.print("");
    ns.print("Worker host summary");
    ns.print(table(
        ["Host", "Bought", "RAM", "Free", "Remote Managers"],
        workerHosts.map(host => [
            host,
            ownedServers.has(host) ? "yes" : "no",
            `${fmtRam(ns, ns.getServerUsedRam(host))}/${fmtRam(ns, ns.getServerMaxRam(host))}`,
            fmtRam(ns, Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host))),
            String(countExistingRemoteAssignments(ns, host))
        ])
    ));
}

function parseBool(value) {
    if (typeof value === "boolean") return value;
    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function fmtRam(ns, value, decimals = 2) {
    if (!Number.isFinite(value)) return "-";
    try {
        if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(value, decimals);
    } catch {}
    return `${Number(value).toFixed(decimals)}GB`;
}

function fmtNumber(ns, value, decimals = 2) {
    if (!Number.isFinite(value)) return "-";
    try {
        if (ns.format && typeof ns.format.number === "function") return ns.format.number(value, decimals);
    } catch {}
    return Number(value).toFixed(decimals);
}

function fmtMoneyPct(ns, current, max) {
    if (!Number.isFinite(max) || max <= 0) return "-";
    return `${fmtNumber(ns, current)} / ${fmtNumber(ns, max)} (${((current / max) * 100).toFixed(1)}%)`;
}

function fmtSecurity(ns, server) {
    const current = ns.getServerSecurityLevel(server);
    const min = ns.getServerMinSecurityLevel(server);
    return `${current.toFixed(2)} / ${min.toFixed(2)} (+${Math.max(0, current - min).toFixed(2)})`;
}

function table(headers, rows) {
    if (!rows || rows.length === 0) return "(none)";
    const all = [headers, ...rows];
    const widths = headers.map((_, i) => Math.max(...all.map(row => String(row[i] ?? "").length)));
    const line = row => row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ");
    return [line(headers), widths.map(w => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

async function openLargeTail(ns, title = null) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();
            await ns.sleep(50);
            if (title && typeof ns.ui.setTailTitle === "function") ns.ui.setTailTitle(title);
            if (typeof ns.ui.windowSize === "function" && typeof ns.ui.resizeTail === "function" && typeof ns.ui.moveTail === "function") {
                const size = ns.ui.windowSize();
                const width = Array.isArray(size) ? size[0] : size.width;
                const height = Array.isArray(size) ? size[1] : size.height;
                if (width && height) {
                    ns.ui.moveTail(10, 10);
                    ns.ui.resizeTail(Math.max(600, width - 30), Math.max(450, height - 60));
                }
            }
        }
    } catch {}
}
