/**
 * info-payouts.js
 *
 * Hack/grow/weaken forecast and payout estimate for the management console.
 *
 * Usage:
 *   run info-payouts.js
 *   run info-payouts.js silent
 *   run info-payouts.js silent <stamp> <securityBuffer> <moneyTargetRatio> <hackTargetRatio>
 *
 * Writes:
 *   /data/manager/payouts.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    const securityBuffer = Number(ns.args[2] || 5);
    const moneyTargetRatio = Number(ns.args[3] || 0.85);
    const hackTargetRatio = Number(ns.args[4] || 0.10);

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1180, 700);
    }

    const servers = scanAll(ns).filter(s => isValidHost(ns, s));
    const cycleMap = buildCycleMap(ns, servers);

    const targets = [];

    let hackReadyTargets = 0;
    let preparedButUnhackableTargets = 0;
    let blockedBySecurityTargets = 0;
    let blockedByMoneyTargets = 0;
    let nextHackMoney = 0;
    let bestTarget = "";
    let bestHack = 0;

    for (const server of servers) {
        const maxMoney = safeCall(() => ns.getServerMaxMoney(server), 0);
        if (maxMoney <= 0 || !safeCall(() => ns.hasRootAccess(server), false)) continue;

        const currentMoney = ns.getServerMoneyAvailable(server);
        const currentSecurity = ns.getServerSecurityLevel(server);
        const minSecurity = ns.getServerMinSecurityLevel(server);

        const moneyPct = maxMoney > 0 ? currentMoney / maxMoney * 100 : 0;
        const securityExcess = Math.max(0, currentSecurity - (minSecurity + securityBuffer));

        const moneyReady = currentMoney >= maxMoney * moneyTargetRatio;
        const securityReady = securityExcess <= 0;

        const hackFractionPerThread = Math.max(0, safeCall(() => ns.hackAnalyze(server), 0));
        const hackThreads = hackFractionPerThread > 0
            ? Math.max(1, Math.ceil(hackTargetRatio / hackFractionPerThread))
            : 0;

        const prepared = moneyReady && securityReady;
        const hackable = hackThreads > 0;
        const hackReady = prepared && hackable;

        let readiness = "hackReady";

        if (!securityReady) readiness = "blockedBySecurity";
        else if (!moneyReady) readiness = "blockedByMoney";
        else if (!hackable) readiness = "preparedButUnhackable";

        const hackMoney = hackReady ? Math.min(currentMoney * hackTargetRatio, currentMoney) : 0;

        if (hackReady) {
            hackReadyTargets++;
            nextHackMoney += hackMoney;
        }

        if (prepared && !hackable) preparedButUnhackableTargets++;
        if (!securityReady) blockedBySecurityTargets++;
        else if (!moneyReady) blockedByMoneyTargets++;

        if (hackMoney > bestHack) {
            bestHack = hackMoney;
            bestTarget = server;
        }

        targets.push({
            server,

            money: `${pct(moneyPct)} ${fmtMoney(currentMoney)}`,
            security: `${currentSecurity.toFixed(2)}/${minSecurity.toFixed(2)}`,

            readiness,
            prepared,
            hackable,
            hackReady,

            hackMoney: fmtMoney(hackMoney),
            hackEta: hackReady ? fmtDuration(ns.getHackTime(server)) : "blocked",
            growEta: moneyReady ? "now" : fmtDuration(ns.getGrowTime(server)),
            weakenEta: securityReady ? "now" : fmtDuration(ns.getWeakenTime(server)),

            cycle: cycleMap[server] || "idle",

            currentMoney,
            maxMoney,
            moneyPct,
            currentSecurity,
            minSecurity,
            securityExcess,

            moneyReady,
            securityReady,

            hackFractionPerThread,
            hackThreads,
            estimatedHackMoney: hackMoney,

            hackTimeMs: ns.getHackTime(server),
            growTimeMs: ns.getGrowTime(server),
            weakenTimeMs: ns.getWeakenTime(server),
        });
    }

    targets.sort(compareTargets);

    const report = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        summary: {
            targets: targets.length,

            hackReadyTargets,
            preparedButUnhackableTargets,
            blockedBySecurityTargets,
            blockedByMoneyTargets,

            nextHackMoney,
            bestTarget,
            bestHackMoney: bestHack,

            securityBuffer,
            moneyTargetRatio,
            hackTargetRatio,

            note: "hackReady now requires hackThreads > 0. Prepared high-value targets with hackAnalyze() == 0 are reported as preparedButUnhackable.",
        },
        best: targets.filter(t => t.hackReady).slice(0, 10),
        preparedButUnhackable: targets.filter(t => t.readiness === "preparedButUnhackable").slice(0, 20),
        targets,
    };

    ns.write("/data/manager/payouts.json", JSON.stringify(sanitizeForJson(report), null, 2), "w");

    if (!silent) {
        printPayouts(ns, report);
    }
}

function compareTargets(a, b) {
    const readinessRank = {
        hackReady: 0,
        preparedButUnhackable: 1,
        blockedByMoney: 2,
        blockedBySecurity: 3,
    };

    const rankDiff = (readinessRank[a.readiness] ?? 99) - (readinessRank[b.readiness] ?? 99);
    if (rankDiff !== 0) return rankDiff;

    const hackDiff = Number(b.estimatedHackMoney || 0) - Number(a.estimatedHackMoney || 0);
    if (hackDiff !== 0) return hackDiff;

    const maxMoneyDiff = Number(b.maxMoney || 0) - Number(a.maxMoney || 0);
    if (maxMoneyDiff !== 0) return maxMoneyDiff;

    return String(a.server).localeCompare(String(b.server));
}

function printPayouts(ns, report) {
    const s = report.summary;

    ns.print("PAYOUT / FORECAST REPORT");
    ns.print("=".repeat(118));
    ns.print(`Targets:                  ${s.targets}`);
    ns.print(`Hack-ready:               ${s.hackReadyTargets}`);
    ns.print(`Prepared but unhackable:  ${s.preparedButUnhackableTargets}`);
    ns.print(`Blocked by security:      ${s.blockedBySecurityTargets}`);
    ns.print(`Blocked by money:         ${s.blockedByMoneyTargets}`);
    ns.print(`Estimated next hack:      ${fmtMoney(s.nextHackMoney)}`);
    ns.print(`Best hack-ready target:   ${s.bestTarget || "none"}`);
    ns.print("");

    const columns = [
        ["server", "Server", 22],
        ["readiness", "Readiness", 22],
        ["money", "Money", 17],
        ["security", "Security", 14],
        ["hackMoney", "Hack $", 13],
        ["hackThreadsText", "Threads", 9],
        ["hackEta", "Hack ETA", 9],
        ["growEta", "Grow ETA", 9],
        ["weakenEta", "Weak ETA", 9],
        ["cycle", "Cycle", 22],
    ];

    printHeader(ns, columns);

    const rows = report.targets || [];

    for (let i = 0; i < rows.length; i++) {
        if (i > 0 && i % 20 === 0) {
            ns.print("");
            printHeader(ns, columns);
        }

        const row = {
            ...rows[i],
            hackThreadsText: String(rows[i].hackThreads || 0),
        };

        ns.print(columns.map(([key, _label, width]) => pad(String(row[key] ?? ""), width)).join(" | "));
    }
}

function scanAll(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    for (let i = 0; i < queue.length; i++) {
        const host = queue[i];

        for (const next of ns.scan(host)) {
            if (!next || next === "." || next === "..") continue;
            if (seen.has(next)) continue;

            seen.add(next);
            queue.push(next);
        }
    }

    return [...seen].sort();
}

function isValidHost(ns, host) {
    if (!host || host === "." || host === "..") return false;

    try {
        if (typeof ns.serverExists === "function") {
            return ns.serverExists(host);
        }
    } catch {
        return false;
    }

    try {
        ns.ls(host);
        return true;
    } catch {
        return false;
    }
}

function buildCycleMap(ns, servers) {
    const map = {};

    for (const host of servers) {
        for (const proc of ns.ps(host)) {
            if (!["weaken.js", "grow.js", "hack.js"].includes(proc.filename)) continue;

            const target = String(proc.args[0] || host);
            const action = proc.filename.replace(".js", "");
            const threads = proc.threads || 0;

            map[target] = `${action}@${host} ${threads}t`;
        }
    }

    return map;
}

function printHeader(ns, columns) {
    ns.print(columns.map(([_key, label, width]) => pad(label, width)).join(" | "));
    ns.print(columns.map(([_key, _label, width]) => "-".repeat(width)).join("-|-"));
}

function openConsole(ns, width = 1180, height = 700) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is useful but not required.
    }
}

function fmtMoney(value) {
    value = Number(value || 0);
    const abs = Math.abs(value);

    if (abs >= 1e15) return `$${(value / 1e15).toFixed(2)}q`;
    if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}t`;
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;

    return `$${value.toFixed(0)}`;
}

function pct(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function fmtDuration(ms) {
    ms = Math.max(0, Number(ms || 0));

    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;

    return `${seconds}s`;
}

function pad(value, width) {
    value = String(value ?? "");

    if (value.length > width) {
        return value.slice(0, width - 1) + "…";
    }

    return value + " ".repeat(width - value.length);
}

function safeCall(fn, fallback = null) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function sanitizeForJson(value) {
    if (typeof value === "bigint") return value.toString();
    if (value === undefined) return null;
    if (value === null) return null;

    if (typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) return null;
        return value;
    }

    if (Array.isArray(value)) return value.map(sanitizeForJson);

    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = sanitizeForJson(value[key]);
    }

    return output;
}