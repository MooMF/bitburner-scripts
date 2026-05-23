/**
 * info-security.js
 * Security pressure report for the management console.
 *
 * Usage:
 *   run info-security.js
 *   run info-security.js silent
 *   run info-security.js silent <stamp> <securityBuffer>
 *
 * Writes:
 *   /data/manager/security.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    const securityBuffer = Number(ns.args[2] || 5);

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1120, 700);
    }

    const servers = scanAll(ns);
    const cycleMap = buildCycleMap(ns, servers);

    const targets = [];

    let readyTargets = 0;
    let notReadyTargets = 0;
    let totalSecurityExcess = 0;
    let worstServer = "";
    let worstExcess = 0;

    for (const server of servers) {
        const maxMoney = ns.getServerMaxMoney(server);
        if (maxMoney <= 0) continue;

        const current = ns.getServerSecurityLevel(server);
        const min = ns.getServerMinSecurityLevel(server);

        const aboveMin = Math.max(0, current - min);
        const allowed = min + securityBuffer;
        const excess = Math.max(0, current - allowed);

        const reductionToMinPct = current > 0 ? (aboveMin / current) * 100 : 0;
        const reductionToBufferPct = current > 0 ? (excess / current) * 100 : 0;

        const ready = excess <= 0;
        const weakenTime = ns.getWeakenTime(server);

        if (ready) readyTargets++;
        else notReadyTargets++;

        totalSecurityExcess += excess;

        if (excess > worstExcess) {
            worstExcess = excess;
            worstServer = server;
        }

        targets.push({
            server,

            security: `${current.toFixed(2)}/${min.toFixed(2)}`,
            aboveMin: aboveMin.toFixed(2),
            buffer: securityBuffer.toFixed(2),
            allowed: allowed.toFixed(2),
            excess: excess.toFixed(2),
            reducePct: `↓${reductionToBufferPct.toFixed(1)}%`,
            eta: excess > 0 ? fmtDuration(weakenTime) : "now",
            cycle: cycleMap[server] || "idle",

            currentSecurity: current,
            minSecurity: min,
            allowedSecurity: allowed,
            securityAboveMin: aboveMin,
            securityExcess: excess,
            securityReductionToMinPct: reductionToMinPct,
            securityReductionToBufferPct: reductionToBufferPct,
            securityEtaMs: excess > 0 ? weakenTime : 0,
            securityEtaText: excess > 0 ? fmtDuration(weakenTime) : "now",
            ready,
        });
    }

    targets.sort((a, b) =>
        b.securityExcess - a.securityExcess ||
        b.securityAboveMin - a.securityAboveMin ||
        a.server.localeCompare(b.server)
    );

    const report = {
        timestamp: Date.now(),
        summary: {
            moneyTargets: targets.length,
            readyTargets,
            notReadyTargets,
            totalSecurityExcess,
            worstServer,
            worstExcess,
            securityBuffer,
        },
        worst: targets.slice(0, 10),
        targets,
    };

    ns.write("/data/manager/security.json", JSON.stringify(report, null, 2), "w");

    if (!silent) {
        printSecurity(ns, report);
    }
}

function printSecurity(ns, report) {
    const s = report.summary;

    ns.print("SECURITY PRESSURE REPORT");
    ns.print("=".repeat(112));
    ns.print(`Targets: ${s.moneyTargets}`);
    ns.print(`Ready:   ${s.readyTargets}`);
    ns.print(`Blocked: ${s.notReadyTargets}`);
    ns.print(`Buffer:  +${Number(s.securityBuffer || 0).toFixed(2)} above minimum`);
    ns.print(`Excess:  ${Number(s.totalSecurityExcess || 0).toFixed(2)}`);
    ns.print(`Worst:   ${s.worstServer || "none"} ${s.worstExcess ? `(+${Number(s.worstExcess).toFixed(2)})` : ""}`);
    ns.print("");

    printSecurityTable(ns, report.targets || []);
}

function printSecurityTable(ns, rows) {
    const columns = [
        ["server", "Server", 22],
        ["security", "Sec/min", 17],
        ["aboveMin", "Above", 8],
        ["buffer", "Buffer", 8],
        ["allowed", "Allowed", 8],
        ["excess", "Excess", 8],
        ["reducePct", "Reduce", 8],
        ["eta", "ETA", 8],
        ["cycle", "Cycle", 24],
    ];

    if (!rows || rows.length === 0) {
        ns.print("No money targets found.");
        return;
    }

    printHeader(ns, columns);

    for (let i = 0; i < rows.length; i++) {
        if (i > 0 && i % 25 === 0) {
            ns.print("");
            printHeader(ns, columns);
        }

        const row = rows[i];
        ns.print(columns.map(([key, _label, width]) => {
            return pad(String(row[key] ?? ""), width);
        }).join(" | "));
    }
}

function printHeader(ns, columns) {
    ns.print(columns.map(([_key, label, width]) => pad(label, width)).join(" | "));
    ns.print(columns.map(([_key, _label, width]) => "-".repeat(width)).join("-|-"));
}

function scanAll(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    for (let i = 0; i < queue.length; i++) {
        const host = queue[i];

        for (const next of ns.scan(host)) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }

    return [...seen].sort();
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

function openConsole(ns, width = 1120, height = 700) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();
        }

        if (ns.ui && typeof ns.ui.resizeTail === "function") {
            ns.ui.resizeTail(width, height);
        }
    } catch {
        // Tail display is useful but not required.
    }
}