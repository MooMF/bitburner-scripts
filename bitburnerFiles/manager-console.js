/**
 * manager-console.js
 * High-level Bitburner management console.
 *
 * Child scripts collect focused reports:
 *   info-money.js      -> /data/manager/money.json
 *   info-security.js   -> /data/manager/security.json
 *   info-payouts.js    -> /data/manager/payouts.json
 *   info-runtime.js    -> /data/manager/runtime.json
 *   info-share.js      -> /data/manager/share.json
 *
 * Usage:
 *   run manager-console.js
 *   run manager-console.js overview
 *   run manager-console.js money
 *   run manager-console.js security
 *   run manager-console.js payouts
 *   run manager-console.js runtime
 *   run manager-console.js share
 *   run manager-console.js actions
 *   run manager-console.js server 4sigma
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();
    openConsole(ns, 1180, 720, 20, 20);

    const mode = String(ns.args[0] || "overview").toLowerCase();
    const serverArg = String(ns.args[1] || "");
    const scripts = ["info-money.js", "info-security.js", "info-payouts.js", "info-runtime.js", "info-share.js"];
    const reportFiles = {
        money: "/data/manager/money.json",
        security: "/data/manager/security.json",
        payouts: "/data/manager/payouts.json",
        runtime: "/data/manager/runtime.json",
        share: "/data/manager/share.json",
    };

    for (const script of scripts) {
        if (!ns.fileExists(script, "home")) {
            ns.print(`ERROR: Missing child script: ${script}`);
            ns.print("Install all manager console scripts on home.");
            return;
        }
    }

    await refreshReports(ns, scripts, reportFiles);

    const money = readJson(ns, reportFiles.money, {});
    const security = readJson(ns, reportFiles.security, {});
    const payouts = readJson(ns, reportFiles.payouts, {});
    const runtime = readJson(ns, reportFiles.runtime, {});
    const share = readJson(ns, reportFiles.share, {});

    printHeader(ns, mode);

    if (mode === "money") return printMoney(ns, money);
    if (mode === "security") return printSecurity(ns, security);
    if (mode === "payouts") return printPayouts(ns, payouts);
    if (mode === "runtime") return printRuntime(ns, runtime);
    if (mode === "share") return printShare(ns, share);
    if (mode === "actions") return printActions(ns, money, security, payouts, runtime, share);
    if (mode === "server") return printServer(ns, serverArg, money, security, payouts, runtime, share);

    printOverview(ns, money, security, payouts, runtime, share);
    printActions(ns, money, security, payouts, runtime, share);
}

async function refreshReports(ns, scripts, reportFiles) {
    const stamp = Date.now();
    const running = [];

    for (const script of scripts) {
        const pid = ns.run(script, 1, "silent", stamp);
        if (pid) running.push(pid);
        else ns.print(`WARN: Could not start ${script}; using last report if present.`);
    }

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const stillRunning = running.some(pid => ns.isRunning(pid));
        const allReportsExist = Object.values(reportFiles).every(file => ns.fileExists(file, "home"));
        if (!stillRunning && allReportsExist) return;
        await ns.sleep(200);
    }
}

function readJson(ns, file, fallback) {
    try {
        if (!ns.fileExists(file, "home")) return fallback;
        const text = ns.read(file);
        if (!text || !text.trim()) return fallback;
        return JSON.parse(text);
    } catch (e) {
        ns.print(`WARN: Could not read ${file}: ${String(e)}`);
        return fallback;
    }
}

function openConsole(ns, width = 1180, height = 720, x = 20, y = 20) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
        if (ns.ui && typeof ns.ui.moveTail === "function") ns.ui.moveTail(x, y);
    } catch {
        // Tail display is helpful but not required. Keep the console non-fatal.
    }
}

function printHeader(ns, mode) {
    ns.clearLog();
    ns.print("Bitburner Management Console");
    ns.print(`Mode: ${mode}`);
    ns.print(`Updated: ${new Date().toLocaleString()}`);
    ns.print("=".repeat(100));
}

function printOverview(ns, money, security, payouts, runtime, share) {
    const m = money.summary || {};
    const s = security.summary || {};
    const p = payouts.summary || {};
    const r = runtime.summary || {};
    const sh = share.summary || {};

    ns.print("HIGH-LEVEL SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Network:       ${n(r.rootedServers)}/${n(r.totalServers)} rooted | ${n(r.managedTargets)}/${n(r.moneyServers)} money targets managed | ${fmtPct(r.ramUsedPct)} RAM used`);
    ns.print(`Money:         ${fmtMoney(m.currentMoney)} / ${fmtMoney(m.maxMoney)} (${fmtPct(m.moneyPct)}) | ready ${n(m.readyTargets)}/${n(m.moneyTargets)}`);
    ns.print(`Security:      ready ${n(s.readyTargets)}/${n(s.moneyTargets)} | excess ${fmtNum(s.totalSecurityExcess, 2)} | worst ${s.worstServer || "none"}`);
    ns.print(`Payouts:       est next hack ${fmtMoney(p.nextHackMoney)} | hack-ready ${n(p.hackReadyTargets)} | best ${p.bestTarget || "none"}`);
    ns.print(`Processes:     weaken ${n(r.weakenWorkers)} | grow ${n(r.growWorkers)} | hack ${n(r.hackWorkers)} | idle managers ${n(r.idleManagers)}`);
    ns.print(`Share:         ${sh.managerRunning ? "manager running" : "manager stopped"} | ${n(sh.shareThreads)} threads | ${fmtRam(sh.shareRam)} RAM | power ${fmtSharePower(sh.sharePower)}`);
    ns.print("");

    ns.print("TOP ISSUES");
    ns.print("-".repeat(100));
    const issues = [];
    if ((r.unrootedServers || 0) > 0) issues.push(`${r.unrootedServers} servers not rooted`);
    if ((r.unmanagedTargets || 0) > 0) issues.push(`${r.unmanagedTargets} money targets unmanaged`);
    if ((s.notReadyTargets || 0) > 0) issues.push(`${s.notReadyTargets} targets above security buffer`);
    if ((m.lowMoneyTargets || 0) > 0) issues.push(`${m.lowMoneyTargets} targets below money threshold`);
    if ((r.restartRequired || false)) issues.push("restart/redeploy marker present");
    if (!(sh.managerRunning || false) && (sh.possibleExtraThreads || 0) > 0) issues.push(`share/rent manager stopped; ${sh.possibleExtraThreads} possible spare threads`);
    if (issues.length === 0) ns.print("No major issues detected.");
    else for (const issue of issues) ns.print(`- ${issue}`);
    ns.print("");

    printCompactRows(ns, "Worst security", security.worst || [], ["server", "security", "excess", "reducePct", "eta"]);
    printCompactRows(ns, "Best payouts", payouts.best || [], ["server", "money", "hackMoney", "hackEta", "cycle"]);
    printCompactRows(ns, "Share capacity", share.hosts || [], ["host", "share", "free", "extra", "status"]);
}

function printMoney(ns, report) {
    const s = report.summary || {};
    ns.print("MONEY SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Current/max: ${fmtMoney(s.currentMoney)} / ${fmtMoney(s.maxMoney)} (${fmtPct(s.moneyPct)})`);
    ns.print(`Ready targets: ${n(s.readyTargets)}/${n(s.moneyTargets)} | low money: ${n(s.lowMoneyTargets)}`);
    ns.print("");
    printTable(ns, report.targets || [], [
        ["server", "Server", 22], ["money", "Money", 20], ["pct", "%", 8],
        ["max", "Max", 14], ["manager", "Manager", 16], ["cycle", "Cycle", 16]
    ]);
}

function printSecurity(ns, report) {
    const s = report.summary || {};
    const allRows = report.targets || [];

    const blockedRows = allRows
        .filter(r => Number(r.securityExcess || r.excess || 0) > 0)
        .sort((a, b) =>
            Number(b.securityExcess || b.excess || 0) - Number(a.securityExcess || a.excess || 0)
        );

    const readyRows = allRows
        .filter(r => Number(r.securityExcess || r.excess || 0) <= 0)
        .sort((a, b) => String(a.server).localeCompare(String(b.server)));

    const maxRows = Number(ns.args[1] || 40);
    const rows = blockedRows.length > 0
        ? blockedRows.slice(0, maxRows)
        : readyRows.slice(0, maxRows);

    ns.print("SECURITY SUMMARY");
    ns.print("=".repeat(112));
    ns.print(`Targets: ${n(s.moneyTargets)}`);
    ns.print(`Ready:   ${n(s.readyTargets)}`);
    ns.print(`Blocked: ${n(s.notReadyTargets)}`);
    ns.print(`Buffer:  +${fmtNum(s.securityBuffer, 2)} above minimum`);
    ns.print(`Excess:  ${fmtNum(s.totalSecurityExcess, 2)}`);
    ns.print(`Worst:   ${s.worstServer || "none"}${s.worstExcess ? ` (+${fmtNum(s.worstExcess, 2)})` : ""}`);
    ns.print("");

    if (blockedRows.length > 0) {
        ns.print(`Showing blocked targets only, worst first. Max rows: ${maxRows}`);
    } else {
        ns.print(`No security-blocked targets. Showing ready targets. Max rows: ${maxRows}`);
    }

    ns.print("");

    const columns = [
        ["server", "Server", 22],
        ["security", "Sec/min", 17],
        ["aboveMin", "Above", 8],
        ["excess", "Excess", 8],
        ["reducePct", "Reduce", 8],
        ["eta", "ETA", 8],
        ["cycle", "Cycle", 24],
    ];

    printRepeatedHeaderTable(ns, rows, columns, 10);

    ns.print("");
    ns.print(`Rows shown: ${rows.length}`);
    ns.print(`Blocked targets: ${blockedRows.length}`);
    ns.print(`Ready targets: ${readyRows.length}`);

    if (blockedRows.length > maxRows) {
        ns.print(`Hidden blocked rows: ${blockedRows.length - maxRows}`);
        ns.print(`Use: run manager-console.js security ${blockedRows.length}`);
    }
}

function printRepeatedHeaderTable(ns, rows, columns, repeatEvery = 10) {
    if (!rows || rows.length === 0) {
        ns.print("No rows.");
        return;
    }

    for (let i = 0; i < rows.length; i++) {
        if (i === 0 || i % repeatEvery === 0) {
            if (i > 0) ns.print("");
            printTableHeader(ns, columns);
        }

        const row = rows[i];

        ns.print(columns.map(([key, _label, width]) => {
            return pad(String(row[key] ?? ""), width);
        }).join(" | "));
    }
}

function printTableHeader(ns, columns) {
    ns.print(columns.map(([_key, label, width]) => pad(label, width)).join(" | "));
    ns.print(columns.map(([_key, _label, width]) => "-".repeat(width)).join("-|-"));
}

function printPayouts(ns, report) {
    const s = report.summary || {};
    ns.print("PAYOUT / FORECAST SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Hack-ready: ${n(s.hackReadyTargets)} | est next hack: ${fmtMoney(s.nextHackMoney)} | best target: ${s.bestTarget || "none"}`);
    ns.print("");
    printTable(ns, report.targets || [], [
        ["server", "Server", 22], ["money", "Money", 16], ["security", "Security", 14],
        ["hackMoney", "Hack $", 14], ["hackEta", "Hack ETA", 10], ["growEta", "Grow ETA", 10], ["weakenEta", "Weak ETA", 10]
    ]);
}

function printRuntime(ns, report) {
    const s = report.summary || {};
    ns.print("RUNTIME SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Rooted: ${n(s.rootedServers)}/${n(s.totalServers)} | managed: ${n(s.managedTargets)}/${n(s.moneyServers)} | RAM used: ${fmtPct(s.ramUsedPct)}`);
    ns.print(`Workers: weaken ${n(s.weakenWorkers)} | grow ${n(s.growWorkers)} | hack ${n(s.hackWorkers)} | idle managers ${n(s.idleManagers)}`);
    ns.print("");
    printTable(ns, report.targets || [], [
        ["server", "Server", 22], ["root", "Root", 7], ["ram", "RAM", 22],
        ["manager", "Manager", 18], ["cycle", "Cycle", 18], ["status", "Status", 32]
    ]);
}

function printShare(ns, report) {
    const s = report.summary || {};
    ns.print("SHARE / RENTAL SUMMARY");
    ns.print("-".repeat(100));
    ns.print(`Manager:       ${s.managerRunning ? "running" : "not running"} ${s.managerHosts && s.managerHosts.length ? `@ ${s.managerHosts.join(", ")}` : ""}`);
    ns.print(`Share power:   ${fmtSharePower(s.sharePower)}`);
    ns.print(`Share workers: ${n(s.shareWorkers)} workers | ${n(s.shareThreads)} threads | ${fmtRam(s.shareRam)} committed`);
    ns.print(`Fleet:         ${n(s.shareCapableHosts)} hosts | ${fmtRam(s.shareCapableUsedRam)} / ${fmtRam(s.shareCapableRam)} used (${fmtPct(s.shareCapableUsedPct)})`);
    ns.print(`Headroom:      ${fmtRam(s.idleShareCapableRam)} after ${n(s.reserveGb)}GB/host reserve | possible extra ${n(s.possibleExtraThreads)}t`);
    ns.print("");
    printTable(ns, report.hosts || [], [
        ["host", "Host", 22], ["role", "Role", 8], ["ram", "RAM", 22],
        ["share", "Share", 16], ["free", "Free", 12], ["extra", "Extra", 10], ["status", "Status", 12]
    ]);
}

function printActions(ns, money, security, payouts, runtime, share) {
    const m = money.summary || {};
    const s = security.summary || {};
    const r = runtime.summary || {};
    const sh = share.summary || {};

    ns.print("ACTIONS");
    ns.print("-".repeat(100));
    if (r.restartRequired) ns.print("run startup.js true false        # redeploy after purchased/cloud server change");
    if ((r.unmanagedTargets || 0) > 0) ns.print("run assign-targets.js 1 2        # assign unmanaged/low-RAM targets");
    if ((r.payloadMissing || 0) > 0) ns.print("run upload.js                    # refresh payload deployment");
    if ((s.notReadyTargets || 0) > 0) ns.print("run manager-console.js security  # inspect security pressure / weaken ETA");
    if ((m.lowMoneyTargets || 0) > 0) ns.print("run manager-console.js money     # inspect grow backlog");
    if (!(sh.managerRunning || false) && (sh.possibleExtraThreads || 0) > 0) ns.print("run rent-capacity.js             # start spare RAM sharing/rental manager");
    if (!r.restartRequired && !(r.unmanagedTargets > 0) && !(r.payloadMissing > 0) && !(s.notReadyTargets > 0) && !(m.lowMoneyTargets > 0) && !(!(sh.managerRunning || false) && (sh.possibleExtraThreads || 0) > 0)) {
        ns.print("No immediate action recommended.");
    }
    ns.print("");
    ns.print("Views: overview | money | security | payouts | runtime | share | actions | server <name>");
}

function printServer(ns, name, money, security, payouts, runtime, share) {
    if (!name) {
        ns.print("Usage: run manager-console.js server <serverName>");
        return;
    }
    const rows = [
        ["Runtime", findByServer(runtime.targets, name)],
        ["Money", findByServer(money.targets, name)],
        ["Security", findByServer(security.targets, name)],
        ["Payout", findByServer(payouts.targets, name)],
        ["Share", findByServer(share.hosts, name, "host")],
    ];
    ns.print(`SERVER DETAIL: ${name}`);
    ns.print("-".repeat(100));
    for (const [section, row] of rows) {
        ns.print(section);
        if (!row) ns.print("  no data");
        else for (const key of Object.keys(row)) ns.print(`  ${key}: ${row[key]}`);
        ns.print("");
    }
}

function printCompactRows(ns, title, rows, keys) {
    ns.print(title.toUpperCase());
    ns.print("-".repeat(100));
    if (!rows || rows.length === 0) { ns.print("none"); ns.print(""); return; }
    for (const row of rows.slice(0, 5)) ns.print(keys.map(k => row[k]).join(" | "));
    ns.print("");
}

function printTable(ns, rows, columns) {
    if (!rows || rows.length === 0) { ns.print("No rows."); return; }
    ns.print(columns.map(c => pad(String(c[1]), c[2])).join(" | "));
    ns.print(columns.map(c => "-".repeat(c[2])).join("-|"));
    for (const row of rows) ns.print(columns.map(c => pad(String(row[c[0]] ?? ""), c[2])).join(" | "));
}

function findByServer(rows, name, field = "server") {
    return (rows || []).find(r => String(r[field]).toLowerCase() === String(name).toLowerCase());
}

function pad(value, width) {
    value = String(value ?? "");
    if (value.length > width) return value.slice(0, width - 1) + "…";
    return value + " ".repeat(width - value.length);
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

function fmtRam(value) {
    value = Number(value || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}PB`;
    if (value >= 1024) return `${(value / 1024).toFixed(2)}TB`;
    return `${value.toFixed(2)}GB`;
}

function fmtSharePower(value) {
    if (value === null || value === undefined) return "unavailable";
    return Number(value || 0).toFixed(4);
}

function fmtPct(value) {
    value = Number(value || 0);
    return `${value.toFixed(1)}%`;
}

function fmtNum(value, dp = 1) {
    value = Number(value || 0);
    return value.toFixed(dp);
}

function n(value) {
    return Number(value || 0).toLocaleString();
}
