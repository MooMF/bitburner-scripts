/**
 * info-money.js
 * Money readiness report for the management console.
 *
 * Usage:
 *   run info-money.js
 *   run info-money.js silent
 *
 * Writes:
 *   /data/manager/money.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");
    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    const moneyTargetRatio = Number(ns.args[2] || 0.85);
    if (!silent) { ns.clearLog(); openConsole(ns, 1100, 700); }

    const servers = scanAll(ns);
    const processMap = buildProcessMap(ns, servers);
    const cycleMap = buildCycleMap(ns, servers);
    const targets = [];
    let currentMoney = 0, maxMoney = 0, readyTargets = 0, lowMoneyTargets = 0;

    for (const server of servers) {
        const max = ns.getServerMaxMoney(server);
        if (max <= 0) continue;
        const current = ns.getServerMoneyAvailable(server);
        const pctValue = max > 0 ? current / max * 100 : 0;
        const ready = current >= max * moneyTargetRatio;
        if (ready) readyTargets++; else lowMoneyTargets++;
        currentMoney += current;
        maxMoney += max;

        const local = ns.ps(server).some(p => p.filename === "process.js" && String(p.args[0] || server) === server);
        const remote = processMap[server] || null;
        const cycle = cycleMap[server] || "idle";
        targets.push({
            server,
            money: `${pct(pctValue)} ${fmtMoney(current)}`,
            pct: pct(pctValue),
            max: fmtMoney(max),
            manager: local ? "local" : remote ? `remote@${remote}` : "none",
            cycle,
            currentMoney: current,
            maxMoney: max,
            moneyPct: pctValue,
            ready,
        });
    }

    targets.sort((a, b) => a.moneyPct - b.moneyPct || b.maxMoney - a.maxMoney);
    const report = {
        timestamp: Date.now(),
        summary: {
            moneyTargets: targets.length,
            currentMoney,
            maxMoney,
            moneyPct: maxMoney > 0 ? currentMoney / maxMoney * 100 : 0,
            readyTargets,
            lowMoneyTargets,
            moneyTargetRatio,
        },
        targets: targets.map(t => ({
            server: t.server, money: t.money, pct: t.pct, max: t.max,
            manager: t.manager, cycle: t.cycle,
            currentMoney: t.currentMoney, maxMoney: t.maxMoney, moneyPct: t.moneyPct, ready: t.ready,
        })),
    };

    ns.write("/data/manager/money.json", JSON.stringify(report, null, 2), "w");
    if (!silent) printMoney(ns, report);
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
    const seen = new Set(["home"]), queue = ["home"];
    for (let i = 0; i < queue.length; i++) for (const n of ns.scan(queue[i])) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    return [...seen].sort();
}
function buildProcessMap(ns, servers) {
    const map = {};
    for (const host of servers) for (const p of ns.ps(host)) if (p.filename === "process.js") map[String(p.args[0] || host)] = host;
    return map;
}
function buildCycleMap(ns, servers) {
    const map = {};
    for (const host of servers) for (const p of ns.ps(host)) {
        if (!["weaken.js", "grow.js", "hack.js"].includes(p.filename)) continue;
        const target = String(p.args[0] || host);
        map[target] = `${p.filename.replace(".js", "")}@${host} ${p.threads || 0}t`;
    }
    return map;
}
function printMoney(ns, report) {
    const s = report.summary;
    ns.print(`Money ${fmtMoney(s.currentMoney)} / ${fmtMoney(s.maxMoney)} (${pct(s.moneyPct)}) | ready ${s.readyTargets}/${s.moneyTargets}`);
    ns.print("Server                 | Money              | Max           | Manager          | Cycle");
    ns.print("-----------------------|--------------------|---------------|------------------|--------------------");
    for (const r of report.targets) ns.print(`${pad(r.server, 22)} | ${pad(r.money, 18)} | ${pad(r.max, 13)} | ${pad(r.manager, 16)} | ${r.cycle}`);
}
function fmtMoney(v) { v = Number(v || 0); const a = Math.abs(v); if (a >= 1e15) return `$${(v/1e15).toFixed(2)}q`; if (a >= 1e12) return `$${(v/1e12).toFixed(2)}t`; if (a >= 1e9) return `$${(v/1e9).toFixed(2)}b`; if (a >= 1e6) return `$${(v/1e6).toFixed(2)}m`; if (a >= 1e3) return `$${(v/1e3).toFixed(2)}k`; return `$${v.toFixed(0)}`; }
function pct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function pad(v, w) { v = String(v ?? ""); return v.length > w ? v.slice(0, w - 1) + "…" : v + " ".repeat(w - v.length); }
