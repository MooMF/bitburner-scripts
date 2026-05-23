/**
 * info-runtime.js
 * Runtime/deployment/process inventory for the management console.
 *
 * Usage:
 *   run info-runtime.js
 *   run info-runtime.js silent
 *
 * Writes:
 *   /data/manager/runtime.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");
    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    if (!silent) { ns.clearLog(); openConsole(ns, 1180, 720); }

    const servers = scanAll(ns);
    const processMap = buildProcessMap(ns, servers);
    const payload = ["process.js", "weaken.js", "grow.js", "hack.js"];
    const targets = [];

    let totalRam = 0, usedRam = 0, rooted = 0, moneyServers = 0;
    let managedTargets = 0, unmanagedTargets = 0, payloadMissing = 0;
    let weakenWorkers = 0, growWorkers = 0, hackWorkers = 0, idleManagers = 0;

    for (const server of servers) {
        const root = ns.hasRootAccess(server);
        const maxMoney = ns.getServerMaxMoney(server);
        const maxRam = ns.getServerMaxRam(server);
        const used = ns.getServerUsedRam(server);
        totalRam += maxRam;
        usedRam += used;
        if (root) rooted++;
        if (maxMoney > 0) moneyServers++;

        const localManager = ns.ps(server).some(p => p.filename === "process.js" && String(p.args[0] || server) === server);
        const remoteManager = processMap[server] || null;
        const managed = Boolean(localManager || remoteManager);
        const missing = root && payload.some(f => !ns.fileExists(f, server));
        if (missing) payloadMissing++;

        let cycle = "none";
        let cycleHost = "";
        let threads = 0;
        for (const host of servers) {
            for (const p of ns.ps(host)) {
                const target = String(p.args[0] || host);
                if (target !== server) continue;
                if (["weaken.js", "grow.js", "hack.js"].includes(p.filename)) {
                    cycle = p.filename.replace(".js", "");
                    cycleHost = host;
                    threads += p.threads || 0;
                }
            }
        }
        if (cycle === "weaken") weakenWorkers++;
        if (cycle === "grow") growWorkers++;
        if (cycle === "hack") hackWorkers++;
        if (managed && cycle === "none") idleManagers++;

        if (maxMoney > 0) {
            if (managed) managedTargets++; else unmanagedTargets++;
        }

        const status = !root ? "noRoot" : missing ? "payloadMissing" : maxMoney <= 0 ? "nonMoney" : managed ? "managed" : "unmanaged";
        targets.push({
            server,
            root: root ? "yes" : "no",
            ram: `${fmtGb(used)}/${fmtGb(maxRam)} ${pct(maxRam > 0 ? used / maxRam * 100 : 0)}`,
            manager: localManager ? "local" : remoteManager ? `remote@${remoteManager}` : "none",
            cycle: cycle === "none" ? "idle" : `${cycle}@${cycleHost} ${threads}t`,
            status,
        });
    }

    const report = {
        timestamp: Date.now(),
        summary: {
            totalServers: servers.length,
            rootedServers: rooted,
            unrootedServers: servers.length - rooted,
            moneyServers,
            managedTargets,
            unmanagedTargets,
            payloadMissing,
            totalRam,
            usedRam,
            ramUsedPct: totalRam > 0 ? usedRam / totalRam * 100 : 0,
            weakenWorkers,
            growWorkers,
            hackWorkers,
            idleManagers,
            restartRequired: ns.fileExists("restart-required.txt", "home"),
        },
        targets: targets.sort((a, b) => a.server.localeCompare(b.server)),
    };

    ns.write("/data/manager/runtime.json", JSON.stringify(report, null, 2), "w");
    if (!silent) printRuntime(ns, report);
}

function openConsole(ns, width = 1100, height = 700) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is helpful but not required. Keep report generation non-fatal.
    }
}

function scanAll(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    for (let i = 0; i < queue.length; i++) {
        for (const next of ns.scan(queue[i])) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return [...seen].sort();
}

function buildProcessMap(ns, servers) {
    const map = {};
    for (const host of servers) {
        for (const p of ns.ps(host)) {
            if (p.filename !== "process.js") continue;
            const target = String(p.args[0] || host);
            map[target] = host;
        }
    }
    return map;
}

function printRuntime(ns, report) {
    const s = report.summary;
    ns.print(`Rooted ${s.rootedServers}/${s.totalServers} | managed ${s.managedTargets}/${s.moneyServers} | RAM ${pct(s.ramUsedPct)}`);
    ns.print(`Workers: weaken ${s.weakenWorkers}, grow ${s.growWorkers}, hack ${s.hackWorkers}, idle managers ${s.idleManagers}`);
    ns.print("Server                 | Root | RAM                    | Manager          | Cycle              | Status");
    ns.print("-----------------------|------|------------------------|------------------|--------------------|----------------");
    for (const r of report.targets) ns.print(`${pad(r.server, 22)} | ${pad(r.root, 4)} | ${pad(r.ram, 22)} | ${pad(r.manager, 16)} | ${pad(r.cycle, 18)} | ${r.status}`);
}

function fmtGb(v) { return `${Number(v || 0).toFixed(2)}GB`; }
function pct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function pad(v, w) { v = String(v ?? ""); return v.length > w ? v.slice(0, w - 1) + "…" : v + " ".repeat(w - v.length); }
