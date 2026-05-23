/**
 * info-share.js
 * Share/rental capacity report for the management console.
 *
 * This reports the ns.share()/rent-share side of the framework:
 *   - whether rent-capacity.js is running;
 *   - how many rent-share.js workers are active;
 *   - share threads and RAM committed;
 *   - idle share-capable RAM on purchased/player-owned hosts;
 *   - current share power, when the API is available.
 *
 * Usage:
 *   run info-share.js
 *   run info-share.js silent
 *
 * Writes:
 *   /data/manager/share.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    const reserveGb = Number(ns.args[2] || 8);
    const includeHome = parseBool(ns.args[3] || false);

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1120, 700);
    }

    const servers = scanAll(ns);
    const workerScript = "rent-share.js";
    const managerScript = "rent-capacity.js";
    const workerRamHome = scriptRamSafe(ns, workerScript, "home");

    const managers = [];
    const rows = [];

    let shareHosts = 0;
    let shareWorkers = 0;
    let shareThreads = 0;
    let shareRam = 0;
    let shareCapableHosts = 0;
    let shareCapableRam = 0;
    let shareCapableUsedRam = 0;
    let shareCapableFreeRam = 0;
    let idleShareCapableRam = 0;
    let possibleExtraThreads = 0;

    for (const host of servers) {
        const ps = ns.ps(host);
        for (const p of ps) {
            if (p.filename === managerScript) {
                managers.push({ host, pid: p.pid, threads: p.threads || 1, args: p.args || [] });
            }
        }
    }

    const rentalHosts = servers
        .filter(server => isShareHost(ns, server, includeHome))
        .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a) || a.localeCompare(b));

    for (const host of rentalHosts) {
        const maxRam = ns.getServerMaxRam(host);
        const usedRam = ns.getServerUsedRam(host);
        const freeRam = Math.max(0, maxRam - usedRam);
        const ps = ns.ps(host);
        const workers = ps.filter(p => p.filename === workerScript);
        const threads = workers.reduce((sum, p) => sum + Number(p.threads || 0), 0);
        const workerRam = scriptRamSafe(ns, workerScript, host) || workerRamHome;
        const committedRam = threads * workerRam;
        const freeAfterReserve = Math.max(0, freeRam - reserveGb);
        const extraThreads = workerRam > 0 ? Math.floor(freeAfterReserve / workerRam) : 0;

        shareCapableHosts++;
        shareCapableRam += maxRam;
        shareCapableUsedRam += usedRam;
        shareCapableFreeRam += freeRam;
        idleShareCapableRam += freeAfterReserve;
        possibleExtraThreads += extraThreads;

        if (workers.length > 0) {
            shareHosts++;
            shareWorkers += workers.length;
            shareThreads += threads;
            shareRam += committedRam;
        }

        rows.push({
            host,
            role: host === "home" ? "home" : isPurchasedLike(ns, host) ? "owned" : "rooted",
            ram: `${fmtRam(usedRam)}/${fmtRam(maxRam)} ${pct(maxRam > 0 ? usedRam / maxRam * 100 : 0)}`,
            share: workers.length > 0 ? `${threads}t ${fmtRam(committedRam)}` : "none",
            free: fmtRam(freeRam),
            extra: `${extraThreads}t`,
            status: workers.length > 0 ? "sharing" : extraThreads > 0 ? "available" : "blocked",
        });
    }

    const sharePower = getSharePowerSafe(ns);
    const report = {
        timestamp: Date.now(),
        summary: {
            managerRunning: managers.length > 0,
            managerCount: managers.length,
            managerHosts: managers.map(m => m.host),
            sharePower,
            shareCapableHosts,
            shareCapableRam,
            shareCapableUsedRam,
            shareCapableFreeRam,
            shareCapableUsedPct: shareCapableRam > 0 ? shareCapableUsedRam / shareCapableRam * 100 : 0,
            shareHosts,
            shareWorkers,
            shareThreads,
            shareRam,
            shareRamPct: shareCapableRam > 0 ? shareRam / shareCapableRam * 100 : 0,
            idleShareCapableRam,
            possibleExtraThreads,
            reserveGb,
            includeHome,
        },
        managers,
        hosts: rows,
    };

    ns.write("/data/manager/share.json", JSON.stringify(report, null, 2), "w");
    if (!silent) printShare(ns, report);
}

function printShare(ns, report) {
    const s = report.summary || {};
    ns.print("SHARE / RENTAL SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Manager:       ${s.managerRunning ? "running" : "not running"} ${s.managerHosts && s.managerHosts.length ? `@ ${s.managerHosts.join(", ")}` : ""}`);
    ns.print(`Share power:   ${s.sharePower === null || s.sharePower === undefined ? "unavailable" : Number(s.sharePower).toFixed(4)}`);
    ns.print(`Share workers: ${n(s.shareWorkers)} workers | ${n(s.shareThreads)} threads | ${fmtRam(s.shareRam)} committed`);
    ns.print(`Fleet:         ${n(s.shareCapableHosts)} hosts | ${fmtRam(s.shareCapableUsedRam)} / ${fmtRam(s.shareCapableRam)} used (${pct(s.shareCapableUsedPct)})`);
    ns.print(`Headroom:      ${fmtRam(s.idleShareCapableRam)} after ${s.reserveGb}GB/host reserve | possible extra ${n(s.possibleExtraThreads)}t`);
    ns.print("");
    ns.print("Host                   | Role   | RAM                    | Share          | Free       | Extra    | Status");
    ns.print("-----------------------|--------|------------------------|----------------|------------|----------|------------");
    for (const r of report.hosts || []) {
        ns.print(`${pad(r.host, 22)} | ${pad(r.role, 6)} | ${pad(r.ram, 22)} | ${pad(r.share, 14)} | ${pad(r.free, 10)} | ${pad(r.extra, 8)} | ${r.status}`);
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

function isShareHost(ns, server, includeHome) {
    if (server === "home") return includeHome;
    if (!ns.hasRootAccess(server)) return false;
    if (ns.getServerMaxRam(server) <= 0) return false;
    return isPurchasedLike(ns, server);
}

function isPurchasedLike(ns, server) {
    if (server.startsWith("pserv-")) return true;
    if (server.startsWith("MooMF")) return true;
    try {
        const info = ns.getServer(server);
        if (info && info.purchasedByPlayer) return true;
    } catch { }
    return false;
}

function scriptRamSafe(ns, script, host) {
    try { return Number(ns.getScriptRam(script, host) || 0); }
    catch { return 0; }
}

function getSharePowerSafe(ns) {
    try {
        if (typeof ns.getSharePower === "function") return ns.getSharePower();
    } catch { }
    return null;
}

function openConsole(ns, width = 1120, height = 700) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is useful but report generation should remain non-fatal.
    }
}

function parseBool(value) {
    if (typeof value === "boolean") return value;
    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function fmtRam(value) {
    value = Number(value || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}PB`;
    if (value >= 1024) return `${(value / 1024).toFixed(2)}TB`;
    return `${value.toFixed(2)}GB`;
}

function pct(value) { return `${Number(value || 0).toFixed(1)}%`; }
function n(value) { return Number(value || 0).toLocaleString(); }
function pad(value, width) {
    value = String(value ?? "");
    if (value.length > width) return value.slice(0, width - 1) + "…";
    return value + " ".repeat(width - value.length);
}
