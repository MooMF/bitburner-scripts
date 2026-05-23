/**
 * xp-farm.js
 *
 * Spare-RAM hacking XP farmer.
 *
 * Purpose:
 *   Uses spare RAM to run weaken.js against a chosen target.
 *   weaken() gives hacking XP and does not steal money from the target.
 *
 * Recommended use:
 *   run clean.js share
 *   run xp-farm.js nwo 1024 false 10000 60
 *
 * Usage:
 *   run xp-farm.js [target] [reserveGb] [includeHome] [loopMs] [maxUsePct]
 *
 * Args:
 *   target       Server to weaken for XP. Default: nwo if available, else joesguns.
 *   reserveGb    RAM to leave free per host. Default: 1024.
 *   includeHome  Whether home can be used. Default: false.
 *   loopMs       Manager refresh loop. Default: 10000.
 *   maxUsePct    Max host RAM usage percentage. Default: 60.
 *
 * Stop:
 *   run xp-farm.js stop
 *
 * Report:
 *   /data/manager/xp-farm.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();

    if (host !== "home") {
        ns.tprint("ERROR: xp-farm.js should be run from home.");
        return -1;
    }

    const firstArg = String(ns.args[0] ?? "").toLowerCase();

    if (firstArg === "stop" || firstArg === "clean" || firstArg === "kill") {
        const killed = killXpWorkers(ns);
        ns.tprint(`xp-farm.js: killed ${killed} XP-farm worker process(es).`);
        return killed;
    }

    await openLargeTail(ns, "XP Farm");
    ns.clearLog();

    const target = String(ns.args[0] ?? chooseDefaultTarget(ns));
    const reserveGb = Math.max(0, Number(ns.args[1] ?? 1024));
    const includeHome = parseBool(ns.args[2] ?? false);
    const loopMs = Math.max(1000, Number(ns.args[3] ?? 10000));
    const maxUsePct = clamp(Number(ns.args[4] ?? 60), 1, 100);

    const worker = "weaken.js";
    const marker = "xp-farm";
    const reportFile = "/data/manager/xp-farm.json";

    if (!ns.serverExists(target)) {
        ns.tprint(`ERROR: Target does not exist: ${target}`);
        return -2;
    }

    if (!ns.hasRootAccess(target)) {
        ns.tprint(`ERROR: No root on target: ${target}`);
        return -3;
    }

    if (!ns.fileExists(worker, "home")) {
        ns.tprint(`ERROR: Missing ${worker} on home.`);
        return -4;
    }

    const workerRam = ns.getScriptRam(worker, "home");

    if (!Number.isFinite(workerRam) || workerRam <= 0) {
        ns.tprint(`ERROR: Could not determine RAM for ${worker}.`);
        return -5;
    }

    ns.print("XP Farm");
    ns.print("=======");
    ns.print(`Target:       ${target}`);
    ns.print(`Reserve/host: ${formatRam(reserveGb)}`);
    ns.print(`Include home: ${includeHome}`);
    ns.print(`Loop:         ${loopMs}ms`);
    ns.print(`Max use:      ${maxUsePct}%`);
    ns.print(`Worker:       ${worker}`);
    ns.print("");

    // Clear stale workers from an earlier run before starting.
    killXpWorkers(ns);

    while (true) {
        const start = Date.now();

        const servers = getAllServers(ns, "home")
            .filter(s => includeHome || s !== "home")
            .filter(s => ns.hasRootAccess(s))
            .filter(s => ns.getServerMaxRam(s) > 0)
            .filter(s => isGoodXpHost(ns, s, includeHome))
            .sort((a, b) => hostPriority(ns, a) - hostPriority(ns, b));

        let started = 0;
        let running = 0;
        let totalThreads = 0;
        let committedRam = 0;
        let possibleThreads = 0;

        const rows = [];

        for (const server of servers) {
            const maxRam = ns.getServerMaxRam(server);
            const usedRam = ns.getServerUsedRam(server);
            const freeRam = Math.max(0, maxRam - usedRam);

            const existing = getXpWorkers(ns, server);
            const existingThreads = existing.reduce((sum, p) => sum + p.threads, 0);
            const existingRam = existingThreads * workerRam;

            running += existing.length;
            totalThreads += existingThreads;
            committedRam += existingRam;

            if (existing.length > 0) {
                rows.push([
                    server,
                    "running",
                    `${existingThreads}t`,
                    `${formatRam(usedRam)} / ${formatRam(maxRam)}`,
                    formatRam(freeRam),
                    "-"
                ]);

                continue;
            }

            const targetUsedRam = maxRam * (maxUsePct / 100);
            const allowedExtraByPct = Math.max(0, targetUsedRam - usedRam);
            const allowedExtraByReserve = Math.max(0, freeRam - reserveGb);
            const usableRam = Math.min(allowedExtraByPct, allowedExtraByReserve);

            const threads = Math.floor(usableRam / workerRam);
            possibleThreads += Math.max(0, threads);

            if (threads <= 0) {
                rows.push([
                    server,
                    "reserved",
                    "0t",
                    `${formatRam(usedRam)} / ${formatRam(maxRam)}`,
                    formatRam(freeRam),
                    "-"
                ]);

                continue;
            }

            try {
                await ns.scp(worker, server, "home");
            } catch {
                rows.push([
                    server,
                    "copyFail",
                    "0t",
                    `${formatRam(usedRam)} / ${formatRam(maxRam)}`,
                    formatRam(freeRam),
                    "-"
                ]);
                continue;
            }

            const pid = ns.exec(worker, server, threads, target, marker);

            if (pid > 0) {
                started++;
                running++;
                totalThreads += threads;
                committedRam += threads * workerRam;

                rows.push([
                    server,
                    `started:${pid}`,
                    `${threads}t`,
                    `${formatRam(usedRam)} / ${formatRam(maxRam)}`,
                    formatRam(freeRam),
                    formatRam(threads * workerRam)
                ]);
            } else {
                rows.push([
                    server,
                    "execFail",
                    "0t",
                    `${formatRam(usedRam)} / ${formatRam(maxRam)}`,
                    formatRam(freeRam),
                    "-"
                ]);
            }

            await ns.sleep(5);
        }

        const report = {
            context: "Bitburner XP farm report",
            schemaVersion: 1,
            generatedAt: Date.now(),
            generatedAtText: new Date().toISOString(),
            target,
            worker,
            marker,
            settings: {
                reserveGb,
                includeHome,
                loopMs,
                maxUsePct
            },
            summary: {
                hostsConsidered: servers.length,
                workersRunning: running,
                workersStartedThisLoop: started,
                totalThreads,
                possibleExtraThreads: possibleThreads,
                committedRam,
                workerRam,
                hacking: safe(() => ns.getPlayer().skills.hacking, null),
                hackingExp: safe(() => ns.getPlayer().exp.hacking, null),
                targetSecurity: safe(() => ns.getServerSecurityLevel(target), null),
                targetMinSecurity: safe(() => ns.getServerMinSecurityLevel(target), null),
                targetMoney: safe(() => ns.getServerMoneyAvailable(target), null),
                targetMaxMoney: safe(() => ns.getServerMaxMoney(target), null),
                weakenTimeMs: safe(() => ns.getWeakenTime(target), null)
            },
            hosts: rows.map(r => ({
                host: r[0],
                status: r[1],
                threads: r[2],
                ram: r[3],
                free: r[4],
                committed: r[5]
            }))
        };

        await ns.write(reportFile, JSON.stringify(report, null, 2), "w");

        ns.clearLog();
        printDashboard(ns, report, rows);

        const elapsed = Date.now() - start;
        await ns.sleep(Math.max(1000, loopMs - elapsed));
    }
}

function chooseDefaultTarget(ns) {
    const preferred = [
        "nwo",
        "kuai-gong",
        "omnitek",
        "4sigma",
        "clarkinc",
        "joesguns",
        "n00dles"
    ];

    for (const server of preferred) {
        if (ns.serverExists(server) && ns.hasRootAccess(server)) {
            return server;
        }
    }

    return "joesguns";
}

function isGoodXpHost(ns, server, includeHome) {
    if (server === "home") return includeHome;

    // Prefer purchased / owned high-RAM hosts and non-money hosts.
    // Avoid using ordinary money servers as XP hosts because process.js may need them.
    if (server.startsWith("pserv-")) return true;
    if (server.startsWith("MooMF")) return true;

    const maxMoney = ns.getServerMaxMoney(server);

    return maxMoney <= 0;
}

function hostPriority(ns, server) {
    if (server.startsWith("MooMF")) return 0;
    if (server.startsWith("pserv-")) return 1;
    if (server === "home") return 9;
    if (ns.getServerMaxMoney(server) <= 0) return 5;
    return 20;
}

function getXpWorkers(ns, server) {
    return ns.ps(server).filter(p =>
        p.filename === "weaken.js" &&
        p.args.length >= 2 &&
        String(p.args[1]) === "xp-farm"
    );
}

function killXpWorkers(ns) {
    let killed = 0;

    for (const server of getAllServers(ns, "home")) {
        if (!ns.hasRootAccess(server)) continue;

        for (const proc of getXpWorkers(ns, server)) {
            if (ns.kill(proc.pid)) {
                killed++;
            }
        }
    }

    return killed;
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

function printDashboard(ns, report, rows) {
    const s = report.summary;

    ns.print("XP FARM");
    ns.print("=======");
    ns.print(`Updated:       ${report.generatedAtText}`);
    ns.print(`Target:        ${report.target}`);
    ns.print(`Hacking:       ${s.hacking ?? "-"}`);
    ns.print(`Hacking XP:    ${formatNumber(s.hackingExp)}`);
    ns.print(`Workers:       ${s.workersRunning} running | ${s.workersStartedThisLoop} started this loop`);
    ns.print(`Threads:       ${formatNumber(s.totalThreads)} committed | ${formatNumber(s.possibleExtraThreads)} possible extra`);
    ns.print(`RAM committed: ${formatRam(s.committedRam)}`);
    ns.print(`Weaken time:   ${formatDuration(s.weakenTimeMs)}`);
    ns.print(`Target sec:    ${formatNumber(s.targetSecurity)} / ${formatNumber(s.targetMinSecurity)}`);
    ns.print("");
    ns.print("Settings");
    ns.print("--------");
    ns.print(`Reserve/host:  ${formatRam(report.settings.reserveGb)}`);
    ns.print(`Max use:       ${report.settings.maxUsePct}%`);
    ns.print(`Include home:  ${report.settings.includeHome}`);
    ns.print(`Loop:          ${report.settings.loopMs}ms`);
    ns.print("");
    ns.print(table(
        ["Host", "Status", "Threads", "RAM", "Free", "Committed"],
        rows
    ));
    ns.print("");
    ns.print("Stop command:");
    ns.print("run xp-farm.js stop");
    ns.print("");
    ns.print("Return to normal:");
    ns.print("run xp-farm.js stop");
    ns.print("run startup.js true false");
}

function table(headers, rows) {
    const all = [headers, ...rows];

    const widths = headers.map((_, i) =>
        Math.max(...all.map(row => String(row[i] ?? "").length))
    );

    const line = row =>
        row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ");

    return [
        line(headers),
        widths.map(w => "-".repeat(w)).join("-|-"),
        ...rows.map(line)
    ].join("\n");
}

function parseBool(value) {
    if (value === true) return true;
    if (value === false) return false;

    const text = String(value).toLowerCase().trim();

    return text === "true" ||
        text === "1" ||
        text === "yes" ||
        text === "y";
}

function clamp(value, min, max) {
    const n = Number(value);

    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function safe(fn, fallback) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function formatRam(gb) {
    const n = Number(gb);

    if (!Number.isFinite(n) || n <= 0) return "0.00GB";

    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}PB`;
    if (n >= 1024) return `${(n / 1024).toFixed(2)}TB`;

    return `${n.toFixed(2)}GB`;
}

function formatNumber(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) return "-";

    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;

    return n.toFixed(2);
}

function formatDuration(ms) {
    const n = Number(ms);

    if (!Number.isFinite(n) || n <= 0) return "-";

    const totalSeconds = Math.ceil(n / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

async function openLargeTail(ns, title = null) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();

            try {
                if (title && ns.ui.setTailTitle) {
                    ns.ui.setTailTitle(title);
                }
            } catch (_) {}

            await ns.sleep(50);

            try {
                if (!ns.ui.windowSize || !ns.ui.resizeTail || !ns.ui.moveTail) return;

                const size = ns.ui.windowSize();
                const width = Array.isArray(size) ? size[0] : size.width;
                const height = Array.isArray(size) ? size[1] : size.height;

                if (!width || !height) return;

                ns.ui.moveTail(10, 10);
                ns.ui.resizeTail(Math.max(500, width - 30), Math.max(350, height - 60));
            } catch (_) {}

            return;
        }
    } catch (_) {}

    try {
        ns.tail();
        await ns.sleep(50);
        ns.resizeTail(1100, 700);
        ns.moveTail(10, 10);

        if (title && typeof ns.setTitle === "function") {
            ns.setTitle(title);
        }
    } catch (_) {
        // Leave default tail behaviour.
    }
}