/**
 * rent-capacity.js
 *
 * Controlled share/rental capacity manager.
 *
 * Purpose:
 *   - Run rent-share.js on spare high-RAM hosts.
 *   - Cap share usage so money/security/hack workers retain capacity.
 *   - Keep share from consuming ~98%+ of the estate while targets still need work.
 *
 * Usage:
 *   run rent-capacity.js
 *   run rent-capacity.js <maxSharePct>
 *   run rent-capacity.js <maxSharePct> <reserveGb>
 *   run rent-capacity.js <maxSharePct> <reserveGb> <includeHome>
 *   run rent-capacity.js <maxSharePct> <reserveGb> <includeHome> <loopMs>
 *
 * Args:
 *   0 maxSharePct   default 60
 *   1 reserveGb     default 1024
 *   2 includeHome   default false
 *   3 loopMs        default 10000
 *
 * Examples:
 *   run rent-capacity.js 50 2048 false
 *   run rent-capacity.js 25 4096 false
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const maxSharePct = clamp(num(ns.args[0], 60), 0, 100);
    const reserveGb = Math.max(0, num(ns.args[1], 1024));
    const includeHome = parseBool(ns.args[2], false);
    const loopMs = Math.max(1000, num(ns.args[3], 10000));

    const workerScript = "rent-share.js";

    ns.clearLog();
    openConsole(ns, 1180, 720);

    if (!ns.fileExists(workerScript, "home")) {
        ns.print(`ERROR: ${workerScript} is missing on home.`);
        return;
    }

    while (true) {
        try {
            await manageShare(ns, {
                workerScript,
                maxSharePct,
                reserveGb,
                includeHome,
            });
        } catch (e) {
            ns.print(`ERROR: ${String(e)}`);
        }

        await ns.sleep(loopMs);
    }
}

async function manageShare(ns, config) {
    const allHosts = scanAll(ns)
        .filter(host => config.includeHome || host !== "home")
        .filter(host => ns.hasRootAccess(host))
        .filter(host => ns.getServerMaxRam(host) > 0)
        .filter(host => isShareCandidate(ns, host));

    const workerRamHome = ns.getScriptRam(config.workerScript, "home");

    if (!Number.isFinite(workerRamHome) || workerRamHome <= 0) {
        ns.print(`ERROR: Could not determine RAM for ${config.workerScript}.`);
        return;
    }

    const results = [];

    for (const host of allHosts) {
        if (!ns.fileExists(config.workerScript, host)) {
            await ns.scp(config.workerScript, host, "home");
        }

        const result = rightSizeHost(ns, host, config.workerScript, workerRamHome, config);
        results.push(result);
    }

    printReport(ns, results, config);
    writeReport(ns, results, config);
}

function rightSizeHost(ns, host, workerScript, workerRam, config) {
    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);

    const shareProcs = ns.ps(host).filter(p => p.filename === workerScript);
    const currentShareThreads = sum(shareProcs.map(p => p.threads || 0));
    const currentShareRam = currentShareThreads * workerRam;

    const nonShareUsedRam = Math.max(0, usedRam - currentShareRam);

    const shareBudgetByPct = maxRam * (config.maxSharePct / 100);
    const shareBudget = Math.max(0, shareBudgetByPct - nonShareUsedRam - config.reserveGb);
    const desiredThreads = Math.max(0, Math.floor(shareBudget / workerRam));

    const desiredShareRam = desiredThreads * workerRam;
    const deltaThreads = desiredThreads - currentShareThreads;

    const significantChange =
        Math.abs(deltaThreads) >= 10 &&
        Math.abs(deltaThreads) >= Math.max(10, Math.floor(Math.max(currentShareThreads, desiredThreads) * 0.02));

    let action = "unchanged";

    if (currentShareThreads > 0 && desiredThreads === 0) {
        killShare(ns, host, workerScript);
        action = "killed";
    } else if (significantChange) {
        killShare(ns, host, workerScript);

        if (desiredThreads > 0) {
            const pid = ns.exec(workerScript, host, desiredThreads);
            action = pid ? `resized ${currentShareThreads}t -> ${desiredThreads}t` : "resize failed";
        } else {
            action = "killed";
        }
    } else if (currentShareThreads === 0 && desiredThreads > 0) {
        const pid = ns.exec(workerScript, host, desiredThreads);
        action = pid ? `started ${desiredThreads}t` : "start failed";
    }

    return {
        host,
        maxRam,
        usedRam,
        nonShareUsedRam,
        currentShareThreads,
        currentShareRam,
        desiredThreads,
        desiredShareRam,
        freeRam: Math.max(0, maxRam - usedRam),
        reserveGb: config.reserveGb,
        maxSharePct: config.maxSharePct,
        action,
    };
}

function killShare(ns, host, workerScript) {
    for (const proc of ns.ps(host)) {
        if (proc.filename === workerScript) {
            ns.kill(proc.pid);
        }
    }
}

function isShareCandidate(ns, host) {
    if (host === "home") return true;

    const maxRam = ns.getServerMaxRam(host);
    if (maxRam < 64) return false;

    const purchasedNames = safeCall(() => ns.getPurchasedServers(), []);
    if (purchasedNames.includes(host)) return true;

    if (/^pserv-/i.test(host)) return true;
    if (/^MooMF/i.test(host)) return true;

    const maxMoney = ns.getServerMaxMoney(host);
    if (maxMoney <= 0 && maxRam >= 1024) return true;

    return false;
}

function printReport(ns, rows, config) {
    ns.clearLog();

    const totalMax = sum(rows.map(r => r.maxRam));
    const totalUsed = sum(rows.map(r => r.usedRam));
    const totalShareNow = sum(rows.map(r => r.currentShareRam));
    const totalShareTarget = sum(rows.map(r => r.desiredShareRam));
    const totalCurrentThreads = sum(rows.map(r => r.currentShareThreads));
    const totalDesiredThreads = sum(rows.map(r => r.desiredThreads));

    ns.print("RENT / SHARE CAPACITY MANAGER");
    ns.print("=".repeat(118));
    ns.print(`Max share cap:      ${config.maxSharePct.toFixed(1)}% per host after non-share usage`);
    ns.print(`Reserve:            ${formatRam(config.reserveGb)} per host`);
    ns.print(`Include home:        ${config.includeHome ? "yes" : "no"}`);
    ns.print(`Share power:         ${safeCall(() => ns.getSharePower(), 0).toFixed(6)}`);
    ns.print("");
    ns.print(`Hosts:               ${rows.length}`);
    ns.print(`Total RAM:           ${formatRam(totalUsed)} / ${formatRam(totalMax)} (${pct(totalMax > 0 ? totalUsed / totalMax * 100 : 0)})`);
    ns.print(`Current share:       ${formatRam(totalShareNow)} | ${Math.round(totalCurrentThreads).toLocaleString()}t`);
    ns.print(`Target share:        ${formatRam(totalShareTarget)} | ${Math.round(totalDesiredThreads).toLocaleString()}t`);
    ns.print("");

    const columns = [
        ["host", "Host", 18],
        ["ramText", "RAM", 22],
        ["nonShareText", "Non-share", 14],
        ["shareText", "Share now", 18],
        ["targetText", "Share target", 18],
        ["action", "Action", 30],
    ];

    printHeader(ns, columns);

    for (const row of rows) {
        const display = {
            ...row,
            ramText: `${formatRam(row.usedRam)}/${formatRam(row.maxRam)}`,
            nonShareText: formatRam(row.nonShareUsedRam),
            shareText: `${Math.round(row.currentShareThreads).toLocaleString()}t ${formatRam(row.currentShareRam)}`,
            targetText: `${Math.round(row.desiredThreads).toLocaleString()}t ${formatRam(row.desiredShareRam)}`,
        };

        ns.print(columns.map(([key, _label, width]) => pad(String(display[key] ?? ""), width)).join(" | "));
    }
}

function writeReport(ns, rows, config) {
    const totalMax = sum(rows.map(r => r.maxRam));
    const totalUsed = sum(rows.map(r => r.usedRam));
    const totalShareNow = sum(rows.map(r => r.currentShareRam));
    const totalShareTarget = sum(rows.map(r => r.desiredShareRam));
    const totalCurrentThreads = sum(rows.map(r => r.currentShareThreads));
    const totalDesiredThreads = sum(rows.map(r => r.desiredThreads));

    const report = {
        timestamp: Date.now(),
        timestampText: new Date().toISOString(),
        summary: {
            managerRunning: true,
            maxSharePct: config.maxSharePct,
            reserveGb: config.reserveGb,
            includeHome: config.includeHome,
            hosts: rows.length,
            totalMaxRam: totalMax,
            totalUsedRam: totalUsed,
            totalUsedPct: totalMax > 0 ? totalUsed / totalMax * 100 : 0,
            currentShareRam: totalShareNow,
            currentShareThreads: totalCurrentThreads,
            targetShareRam: totalShareTarget,
            targetShareThreads: totalDesiredThreads,
            sharePower: safeCall(() => ns.getSharePower(), 0),
        },
        hosts: rows,
    };

    ns.write("/data/manager/rent-capacity.json", JSON.stringify(sanitizeForJson(report), null, 2), "w");
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

function printHeader(ns, columns) {
    ns.print(columns.map(([_key, label, width]) => pad(label, width)).join(" | "));
    ns.print(columns.map(([_key, _label, width]) => "-".repeat(width)).join("-|-"));
}

function openConsole(ns, width = 1180, height = 720) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is useful but not required.
    }
}

function formatRam(gb) {
    gb = Number(gb || 0);

    if (gb >= 1024 * 1024) return `${(gb / 1024 / 1024).toFixed(2)}PB`;
    if (gb >= 1024) return `${(gb / 1024).toFixed(2)}TB`;

    return `${gb.toFixed(2)}GB`;
}

function pct(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function pad(value, width) {
    value = String(value ?? "");

    if (value.length > width) {
        return value.slice(0, width - 1) + "…";
    }

    return value + " ".repeat(width - value.length);
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function parseBool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;

    const text = String(value).toLowerCase();

    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;

    return fallback;
}

function sum(values) {
    return values.reduce((a, b) => a + Number(b || 0), 0);
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