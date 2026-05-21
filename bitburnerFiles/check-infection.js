/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const CFG = {
        corePayload: [
            "process.js",
            "weaken.js",
            "grow.js",
            "hack.js",
            "iteration.js"
        ],
        stagePayload: [
            "infect.js",
            "infect-root.js",
            "infect-deploy.js",
            "infect-start.js"
        ],

        maxTableRows: Number(ns.args[0] ?? 120),
        showNonMoneyRows: parseBool(ns.args[1] ?? false),
        colour: parseBool(ns.args[2] ?? true),

        rentManagerScript: "rent-capacity.js",
        rentWorkerScript: "rent-share.js",

        // These should match process.js defaults.
        securityBuffer: Number(ns.args[3] ?? 5),
        moneyTargetRatio: Number(ns.args[4] ?? 0.85),
        hackTargetRatio: Number(ns.args[5] ?? 0.10),

        forecastRows: Number(ns.args[6] ?? 18)
    };

    await openTail(ns, "Network Health");
    ns.clearLog();

    const allServers = scanAll(ns, "home").sort((a, b) => a.localeCompare(b));
    const visibleServers = allServers.filter(s => s !== "home");

    const procIndex = buildProcessIndex(ns, allServers);
    const processMap = buildProcessMap(ns, allServers);
    const purchased = getPurchasedState(ns, allServers, procIndex, CFG);
    const restartState = getRestartState(ns);
    const rentState = getRentState(ns, allServers, procIndex, purchased.playerOwnedHosts, CFG);

    const stats = makeStats(restartState, purchased, rentState);
    const rows = [];
    const forecasts = [];

    for (const server of visibleServers) {
        const row = inspectServer(ns, server, processMap, procIndex, CFG, rentState);
        const forecast = row.isMoneyServer ? forecastTarget(ns, row, CFG) : null;

        row.forecast = forecast;

        collect(stats, row);

        if (forecast) forecasts.push(forecast);

        if (CFG.showNonMoneyRows || row.isMoneyServer || row.status !== "ok" || row.hostClass === "owned") {
            rows.push(toDisplayRow(ns, row, CFG));
        }
    }

    // Add global share cycle directly from rent-share.js processes.
    stats.cycles.share.servers = rentState.shareHosts.length;
    stats.cycles.share.threads = rentState.workerThreads;

    rows.sort(sortRows);

    p(ns, title("Network Health — compact v3 dashboard", CFG));
    p(ns, dim("Includes forecast estimates for next hack/grow/weaken timing and spare-capacity share value.", CFG));
    p(ns, dim("Forecasts are approximate because process.js is adaptive and workers are not scheduled as fixed batches.", CFG));
    p(ns, "");

    printMainTable(ns, rows, CFG);
    p(ns, "");
    printSummary(ns, stats, CFG);
    p(ns, "");
    printCloud(ns, stats, CFG);
    p(ns, "");
    printRent(ns, stats, CFG);
    p(ns, "");
    printForecast(ns, forecasts, CFG);
    p(ns, "");
    printCycles(ns, stats, CFG);
    p(ns, "");
    printIssues(ns, stats, CFG);
    p(ns, "");
    printHandoff(ns, stats, forecasts, CFG);

    return 1;
}

/* ==============================
   Rendering / colour
   ============================== */

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    grey: "\x1b[90m",
    white: "\x1b[37m"
};

function colour(text, name, CFG) {
    if (!CFG.colour) return String(text);
    return `${ANSI[name] ?? ""}${text}${ANSI.reset}`;
}

function bold(text, CFG) {
    if (!CFG.colour) return String(text);
    return `${ANSI.bold}${text}${ANSI.reset}`;
}

function dim(text, CFG) {
    return colour(text, "grey", CFG);
}

function title(text, CFG) {
    return bold(colour(text, "cyan", CFG), CFG);
}

function statusColour(status) {
    if (["ok", "good", "clear", "working", "busy", "max"].includes(status)) return "green";
    if (["watch", "partial", "low", "idle", "upgrade", "capacity", "space"].includes(status)) return "yellow";
    if (["fix", "red", "poor", "missing", "restart"].includes(status)) return "red";
    if (["info", "light", "telemetry"].includes(status)) return "cyan";
    return "white";
}

function colourStatus(status, CFG) {
    return colour(status, statusColour(status), CFG);
}

function colourReason(status, reason, CFG) {
    return `${colourStatus(status, CFG)}: ${colour(reason, statusColour(status), CFG)}`;
}

function colourCycle(cycle, CFG) {
    const map = {
        weaken: "cyan",
        grow: "green",
        hack: "magenta",
        share: "yellow",
        idle: "grey",
        none: "grey",
        unknown: "red"
    };
    return colour(cycle, map[cycle] ?? "white", CFG);
}

function colourRoot(value, CFG) {
    return value ? colour("yes", "green", CFG) : colour("NO", "red", CFG);
}

function colourClass(hostClass, CFG) {
    const map = {
        owned: "yellow",
        money: "green",
        other: "grey",
        home: "cyan"
    };
    return colour(hostClass, map[hostClass] ?? "white", CFG);
}

function p(ns, text) {
    ns.print(text);
}

function stripAnsi(text) {
    return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(text) {
    return stripAnsi(text).length;
}

function padVisible(text, width) {
    const raw = String(text ?? "");
    const missing = width - visibleLength(raw);
    return raw + " ".repeat(Math.max(0, missing));
}

function table(headers, rows, CFG) {
    const renderedHeaders = headers.map(h => bold(h, CFG));
    const safeRows = rows.map(r => headers.map((_, i) => String(r[i] ?? "")));

    const widths = headers.map((h, i) => Math.max(
        visibleLength(h),
        ...safeRows.map(r => visibleLength(r[i]))
    ));

    const line = values => values.map((v, i) => padVisible(v, widths[i])).join(dim(" | ", CFG));
    const sep = widths.map(w => dim("-".repeat(w), CFG)).join(dim("-|-", CFG));

    return [
        line(renderedHeaders),
        sep,
        ...safeRows.map(line)
    ].join("\n");
}

/* ==============================
   Inspection
   ============================== */

function makeStats(restartState, purchased, rentState) {
    return {
        restartState,
        purchased,
        rentState,

        totalServers: 0,
        rooted: 0,
        coreDeployed: 0,
        stagedDeployed: 0,

        rentManagerAvailable: rentState.managerAvailable,
        rentManagerRunning: rentState.managerRunning,
        rentWorkerDeployed: rentState.workerDeployedCount,
        rentWorkerDeployableHosts: rentState.workerDeployableHostCount,

        moneyServers: 0,
        nonMoneyServers: 0,
        managedMoneyServers: 0,
        localManagedMoneyServers: 0,
        remoteManagedMoneyServers: 0,

        totalMaxMoney: 0,
        totalCurrentMoney: 0,
        totalMaxRam: 0,
        totalUsedRam: 0,
        totalFreeRam: 0,

        estimatedNextHackValue: 0,
        estimatedNextHackExpectedValue: 0,
        hackEligibleNow: 0,

        cycles: {
            weaken: { servers: 0, threads: 0 },
            grow: { servers: 0, threads: 0 },
            hack: { servers: 0, threads: 0 },
            share: { servers: 0, threads: 0 },
            idle: { servers: 0, threads: 0 },
            none: { servers: 0, threads: 0 },
            unknown: { servers: 0, threads: 0 }
        },

        statusCounts: {
            ok: 0,
            watch: 0,
            fix: 0,
            info: 0
        },

        reasons: {
            noRoot: [],
            missingPayload: [],
            missingRentWorker: [],
            unmanagedMoney: [],
            remoteManaged: [],
            localManaged: [],
            processIdle: [],
            preparing: [],
            hacking: [],
            nonMoney: [],
            ownedIdle: [],
            ownedActive: [],
            ownedSharing: [],
            unknown: []
        },

        topRamUsers: [],
        topMoneyTargets: []
    };
}

function inspectServer(ns, server, processMap, procIndex, CFG, rentState) {
    const rooted = ns.hasRootAccess(server);
    const maxRam = ns.getServerMaxRam(server);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = Math.max(0, maxRam - usedRam);
    const maxMoney = ns.getServerMaxMoney(server);
    const currentMoney = ns.getServerMoneyAvailable(server);
    const isMoneyServer = maxMoney > 0;
    const hostClass = classifyHost(ns, server);

    const hasCorePayload = CFG.corePayload.every(f => ns.fileExists(f, server));
    const hasStagePayload = CFG.stagePayload.every(f => ns.fileExists(f, server));
    const hasRentWorker = hostClass === "owned" ? ns.fileExists(CFG.rentWorkerScript, server) : false;

    const localProcess = findLocalProcess(procIndex, server);
    const remoteProcess = processMap.get(server) ?? null;
    const isLocalManaged = Boolean(localProcess);
    const isRemoteManaged = Boolean(remoteProcess && remoteProcess.host !== server);
    const isManaged = isLocalManaged || isRemoteManaged;

    const cycleInfo = hostClass === "owned"
        ? getOwnedHostCycle(procIndex, server, CFG)
        : getMoneyCycleInfo(procIndex, server, localProcess, remoteProcess);

    const statusInfo = classifyStatus({
        rooted,
        isMoneyServer,
        hasCorePayload,
        hasRentWorker,
        hostClass,
        isManaged,
        cycleInfo,
        maxRam,
        usedRam,
        rentState
    });

    return {
        server,
        rooted,
        maxRam,
        usedRam,
        freeRam,
        maxMoney,
        currentMoney,
        isMoneyServer,
        hostClass,
        hasCorePayload,
        hasStagePayload,
        hasRentWorker,
        localProcess,
        remoteProcess,
        isManaged,
        isLocalManaged,
        isRemoteManaged,
        cycle: cycleInfo.cycle,
        cycleHost: cycleInfo.host,
        cycleThreads: cycleInfo.threads,
        status: statusInfo.status,
        reason: statusInfo.reason
    };
}

function classifyStatus(x) {
    if (!x.rooted) return { status: "fix", reason: "no root" };

    if (x.hostClass === "owned") {
        if (x.cycleInfo.cycle === "share") return { status: "ok", reason: "sharing spare RAM" };
        if (x.usedRam > 0) return { status: "ok", reason: "owned active" };

        if (x.rentState.managerRunning && x.rentState.shareRamPct >= 80) {
            return { status: "info", reason: "owned idle; fleet already saturated" };
        }

        if (!x.hasRentWorker) return { status: "watch", reason: "owned idle; rent worker missing" };
        return { status: "watch", reason: "owned idle" };
    }

    if (!x.hasCorePayload) return { status: "fix", reason: "payload missing" };

    if (!x.isMoneyServer) return { status: "info", reason: "non-money" };

    if (!x.isManaged) return { status: "fix", reason: "money server unmanaged" };

    if (x.cycleInfo.cycle === "idle" || x.cycleInfo.cycle === "none") {
        return { status: "watch", reason: "managed but no active worker" };
    }

    if (x.cycleInfo.cycle === "weaken" || x.cycleInfo.cycle === "grow") {
        return { status: "ok", reason: "preparing target" };
    }

    if (x.cycleInfo.cycle === "hack") {
        return { status: "ok", reason: "hacking" };
    }

    return { status: "watch", reason: "unknown cycle" };
}

function collect(stats, row) {
    stats.totalServers++;
    if (row.rooted) stats.rooted++;
    if (row.hasCorePayload) stats.coreDeployed++;
    if (row.hasStagePayload) stats.stagedDeployed++;

    stats.totalMaxRam += row.maxRam;
    stats.totalUsedRam += row.usedRam;
    stats.totalFreeRam += row.freeRam;

    if (row.isMoneyServer) {
        stats.moneyServers++;
        stats.totalMaxMoney += row.maxMoney;
        stats.totalCurrentMoney += row.currentMoney;

        if (row.isManaged) stats.managedMoneyServers++;
        if (row.isLocalManaged) stats.localManagedMoneyServers++;
        if (row.isRemoteManaged) stats.remoteManagedMoneyServers++;

        if (row.forecast) {
            stats.estimatedNextHackValue += row.forecast.estimatedHackTake;
            stats.estimatedNextHackExpectedValue += row.forecast.expectedHackValue;
            if (row.forecast.readyToHackNow) stats.hackEligibleNow++;
        }

        stats.topMoneyTargets.push({
            name: row.server,
            currentMoney: row.currentMoney,
            maxMoney: row.maxMoney,
            moneyPct: pctNum(row.currentMoney, row.maxMoney),
            cycle: row.cycle,
            threads: row.cycleThreads
        });
    } else {
        stats.nonMoneyServers++;
    }

    if (row.hostClass !== "owned") {
        if (!stats.cycles[row.cycle]) row.cycle = "unknown";
        stats.cycles[row.cycle].servers++;
        stats.cycles[row.cycle].threads += row.cycleThreads;
    }

    if (!stats.statusCounts[row.status]) stats.statusCounts[row.status] = 0;
    stats.statusCounts[row.status]++;

    addReason(stats, row);

    if (row.hostClass === "owned" || row.usedRam > 0) {
        stats.topRamUsers.push({
            name: row.server,
            hostClass: row.hostClass,
            usedRam: row.usedRam,
            maxRam: row.maxRam,
            usedPct: pctNum(row.usedRam, row.maxRam),
            cycle: row.cycle,
            threads: row.cycleThreads
        });
    }
}

function addReason(stats, row) {
    const name = row.isRemoteManaged ? `${row.server}@${row.remoteProcess.host}` : row.server;

    if (!row.rooted) stats.reasons.noRoot.push(row.server);
    else if (!row.hasCorePayload && row.hostClass !== "owned") stats.reasons.missingPayload.push(row.server);
    else if (row.hostClass === "owned" && !row.hasRentWorker) stats.reasons.missingRentWorker.push(row.server);
    else if (row.isMoneyServer && !row.isManaged) stats.reasons.unmanagedMoney.push(row.server);
    else if (row.isRemoteManaged) stats.reasons.remoteManaged.push(name);
    else if (row.isLocalManaged) stats.reasons.localManaged.push(row.server);
    else if (row.status === "watch" && row.reason.includes("no active")) stats.reasons.processIdle.push(row.server);
    else if (row.status === "ok" && row.reason.includes("preparing")) stats.reasons.preparing.push(row.server);
    else if (row.status === "ok" && row.reason.includes("hacking")) stats.reasons.hacking.push(row.server);
    else if (!row.isMoneyServer && row.hostClass !== "owned") stats.reasons.nonMoney.push(row.server);

    if (row.hostClass === "owned") {
        if (row.cycle === "share") stats.reasons.ownedSharing.push(row.server);
        else if (row.usedRam <= 0) stats.reasons.ownedIdle.push(row.server);
        else stats.reasons.ownedActive.push(row.server);
    }
}

/* ==============================
   Forecasting
   ============================== */

function forecastTarget(ns, row, CFG) {
    const target = row.server;

    const minSec = safeCall(() => ns.getServerMinSecurityLevel(target), 1);
    const sec = safeCall(() => ns.getServerSecurityLevel(target), minSec);
    const maxMoney = Math.max(0, row.maxMoney);
    const money = Math.max(0, row.currentMoney);

    const weakenTime = safeCall(() => ns.getWeakenTime(target), 0);
    const growTime = safeCall(() => ns.getGrowTime(target), 0);
    const hackTime = safeCall(() => ns.getHackTime(target), 0);

    const securityLimit = minSec + CFG.securityBuffer;
    const moneyTarget = maxMoney * CFG.moneyTargetRatio;

    const securityExcess = Math.max(0, sec - securityLimit);
    const moneyDeficit = Math.max(0, moneyTarget - money);

    const hackAnalyze = Math.max(0, safeCall(() => ns.hackAnalyze(target), 0));
    const hackChance = clampNumber(safeCall(() => ns.hackAnalyzeChance(target), 0), 0, 1);

    const activeThreads = Math.max(1, row.cycleThreads || 1);
    const weakenPerThread = Math.max(0.0001, safeCall(() => ns.weakenAnalyze(1), 0.05));
    const activeWeakenEffect = weakenPerThread * activeThreads;

    const weakenCyclesNeeded = securityExcess > 0
        ? Math.ceil(securityExcess / activeWeakenEffect)
        : 0;

    const growRatio = money <= 0
        ? Infinity
        : moneyTarget > money
            ? moneyTarget / Math.max(1, money)
            : 1;

    const estimatedGrowThreads = growRatio > 1 && Number.isFinite(growRatio)
        ? Math.ceil(safeCall(() => ns.growthAnalyze(target, growRatio), 0))
        : money <= 0 && maxMoney > 0
            ? Math.ceil(safeCall(() => ns.growthAnalyze(target, CFG.moneyTargetRatio * maxMoney), 0))
            : 0;

    const growSecurityIncrease = estimatedGrowThreads * 0.004;
    const growWeakenCyclesNeeded = growSecurityIncrease > 0
        ? Math.ceil(growSecurityIncrease / activeWeakenEffect)
        : 0;

    let stage = "hack-ready";
    let etaMs = 0;

    if (securityExcess > 0) {
        stage = "weaken";
        etaMs += weakenCyclesNeeded * weakenTime;
    }

    if (moneyDeficit > 0) {
        if (stage === "hack-ready") stage = "grow";
        else stage = "weaken+grow";

        etaMs += growTime;

        if (growWeakenCyclesNeeded > 0) {
            etaMs += growWeakenCyclesNeeded * weakenTime;
        }
    }

    const readyToHackNow = securityExcess <= 0 && money >= moneyTarget;

    const estimatedHackThreads = hackAnalyze > 0
        ? Math.max(1, Math.ceil(CFG.hackTargetRatio / hackAnalyze))
        : 0;

    const estimatedHackFraction = hackAnalyze > 0
        ? clampNumber(estimatedHackThreads * hackAnalyze, 0, 1)
        : 0;

    const estimatedHackBasis = readyToHackNow
        ? money
        : Math.max(money, moneyTarget);

    const estimatedHackTake = estimatedHackBasis * estimatedHackFraction;
    const expectedHackValue = estimatedHackTake * hackChance;

    const nextGrowCycleLength = growTime;
    const nextWeakenCycleLength = weakenTime;
    const nextHackCycleLength = hackTime;

    return {
        server: target,
        stage,
        readyToHackNow,
        etaMs,
        etaText: fmtDuration(etaMs),
        currentMoney: money,
        maxMoney,
        moneyPct: pctNum(money, maxMoney),
        moneyTarget,
        security: sec,
        minSecurity: minSec,
        securityExcess,
        weakenCyclesNeeded,
        growRatio: Number.isFinite(growRatio) ? growRatio : null,
        estimatedGrowThreads,
        growWeakenCyclesNeeded,
        estimatedHackThreads,
        estimatedHackFraction,
        hackChance,
        estimatedHackTake,
        expectedHackValue,
        hackTime,
        growTime,
        weakenTime,
        nextGrowCycleLength,
        nextWeakenCycleLength,
        nextHackCycleLength,
        manager: row.isRemoteManaged ? `remote@${row.remoteProcess.host}` : row.isLocalManaged ? "local" : "none",
        cycle: row.cycle,
        cycleThreads: row.cycleThreads
    };
}

/* ==============================
   Display rows
   ============================== */

function toDisplayRow(ns, row, CFG) {
    const forecastBits = row.forecast && row.isMoneyServer
        ? ` | ETA ${row.forecast.etaText} | ${fmtMoney(ns, row.forecast.expectedHackValue)} exp`
        : "";

    return [
        colour(row.server, row.status === "fix" ? "red" : row.status === "watch" ? "yellow" : "white", CFG),
        colourClass(row.hostClass, CFG),
        colourRoot(row.rooted, CFG),
        row.isMoneyServer ? colour(moneyPct(row.currentMoney, row.maxMoney), moneyTextColour(row.currentMoney, row.maxMoney), CFG) : dim("-", CFG),
        colour(`${fmtRam(ns, row.usedRam)}/${fmtRam(ns, row.maxRam)} ${pct(row.usedRam, row.maxRam)}`, ramTextColour(row.usedRam, row.maxRam), CFG),
        colour(formatManager(row), managerColour(row), CFG),
        formatCycle(row, CFG),
        colourReason(row.status, `${row.reason}${forecastBits}`, CFG)
    ];
}

function sortRows(a, b) {
    const cleanA = stripAnsi(a[7]);
    const cleanB = stripAnsi(b[7]);
    const statusA = cleanA.split(":")[0];
    const statusB = cleanB.split(":")[0];

    const rank = { fix: 0, watch: 1, ok: 2, info: 3 };
    const ra = rank[statusA] ?? 9;
    const rb = rank[statusB] ?? 9;

    if (ra !== rb) return ra - rb;
    return stripAnsi(a[0]).localeCompare(stripAnsi(b[0]));
}

/* ==============================
   Printing
   ============================== */

function printMainTable(ns, rows, CFG) {
    p(ns, title("Main table", CFG));
    p(ns, table([
        "Server",
        "Class",
        "Root",
        "Money",
        "RAM",
        "Manager",
        "Cycle",
        "Status / reason"
    ], rows.slice(0, CFG.maxTableRows), CFG));

    if (rows.length > CFG.maxTableRows) {
        p(ns, dim(`... ${rows.length - CFG.maxTableRows} rows hidden. Run: run check-infection.js 999 true`, CFG));
    }
}

function printSummary(ns, s, CFG) {
    const rentWorkerPct = pct(s.rentWorkerDeployed, s.rentWorkerDeployableHosts);

    const rows = [
        ["Rooted", `${s.rooted}/${s.totalServers} (${pct(s.rooted, s.totalServers)})`, statusCell(s.rooted === s.totalServers ? "good" : "fix", CFG)],
        ["Core payload", `${s.coreDeployed}/${s.totalServers} (${pct(s.coreDeployed, s.totalServers)})`, statusCell(s.coreDeployed === s.totalServers ? "good" : "fix", CFG)],
        ["Staged payload", `${s.stagedDeployed}/${s.totalServers} (${pct(s.stagedDeployed, s.totalServers)})`, statusCell(s.stagedDeployed === s.totalServers ? "good" : "watch", CFG)],
        ["Rent manager", `${s.rentManagerAvailable ? "available" : "missing"}; ${s.rentManagerRunning ? "running" : "stopped"}`, statusCell(s.rentManagerRunning ? "working" : s.rentManagerAvailable ? "idle" : "missing", CFG)],
        ["Rent worker", `${s.rentWorkerDeployed}/${s.rentWorkerDeployableHosts} owned hosts (${rentWorkerPct})`, statusCell(s.rentWorkerDeployed > 0 ? "working" : "missing", CFG)],
        ["Money servers", `${s.moneyServers}`, statusCell("info", CFG)],
        ["Managed money", `${s.managedMoneyServers}/${s.moneyServers} (${pct(s.managedMoneyServers, s.moneyServers)})`, statusCell(s.managedMoneyServers === s.moneyServers ? "good" : "fix", CFG)],
        ["Local / remote", `${s.localManagedMoneyServers} local / ${s.remoteManagedMoneyServers} remote`, statusCell("info", CFG)],
        ["Network RAM", `${fmtRam(ns, s.totalUsedRam)}/${fmtRam(ns, s.totalMaxRam)} used (${pct(s.totalUsedRam, s.totalMaxRam)})`, statusCell(ramStatus(s.totalUsedRam, s.totalMaxRam), CFG)],
        ["Free RAM", fmtRam(ns, s.totalFreeRam), statusCell("capacity", CFG)],
        ["Money available", `${fmtMoney(ns, s.totalCurrentMoney)} / ${fmtMoney(ns, s.totalMaxMoney)} (${pct(s.totalCurrentMoney, s.totalMaxMoney)})`, statusCell(moneyStatus(s.totalCurrentMoney, s.totalMaxMoney), CFG)],
        ["Hack-ready targets", `${s.hackEligibleNow}/${s.moneyServers}`, statusCell(s.hackEligibleNow > 0 ? "working" : "watch", CFG)],
        ["Next hack gross", fmtMoney(ns, s.estimatedNextHackValue), statusCell("info", CFG)],
        ["Next hack expected", fmtMoney(ns, s.estimatedNextHackExpectedValue), statusCell("info", CFG)],
        ["Status counts", `ok ${s.statusCounts.ok}, watch ${s.statusCounts.watch}, fix ${s.statusCounts.fix}, info ${s.statusCounts.info}`, statusCell(s.statusCounts.fix ? "fix" : s.statusCounts.watch ? "watch" : "good", CFG)],
        ["Restart marker", s.restartState.restartRequired ? "present" : "absent", statusCell(s.restartState.restartRequired ? "restart" : "clear", CFG)]
    ];

    p(ns, title("Summary", CFG));
    p(ns, table(["Metric", "Value", "Status"], rows, CFG));
}

function printCloud(ns, s, CFG) {
    const x = s.purchased;

    const rows = [
        ["Purchased/cloud", `${x.count}/${x.limit}`, statusCell(x.count >= x.limit ? "full" : "space", CFG)],
        ["Fleet RAM", `${fmtRam(ns, x.usedRam)}/${fmtRam(ns, x.totalRam)} used (${pct(x.usedRam, x.totalRam)})`, statusCell(ramStatus(x.usedRam, x.totalRam), CFG)],
        ["Free RAM", fmtRam(ns, x.freeRam), statusCell("capacity", CFG)],
        ["Capacity ceiling", fmtRam(ns, x.maxPossibleRam), statusCell("info", CFG)],
        ["Fleet capacity", `${pct(x.totalRam, x.maxPossibleRam)} of max possible`, statusCell(x.totalRam >= x.maxPossibleRam ? "max" : "upgrade", CFG)],
        ["Active / idle", `${x.activeCount} active / ${x.idleCount} idle`, statusCell(x.idleCount && s.rentState.shareRamPct < 80 ? "watch" : "info", CFG)],
        ["Processes", `${x.totalProcesses} total`, statusCell("info", CFG)],
        ["Managers", `${x.managerCount} process.js`, statusCell("info", CFG)],
        ["Workers", `${x.workerCount} hack/grow/weaken, ${x.workerThreads} threads`, statusCell("info", CFG)],
        ["Share", `${x.shareCount} rent-share.js, ${x.shareThreads} threads`, statusCell(x.shareThreads ? "working" : "idle", CFG)],
        ["Largest / smallest", `${fmtRam(ns, x.largestRam)} / ${fmtRam(ns, x.smallestRam)}`, statusCell("info", CFG)],
        ["Idle hosts", x.idleHosts.length ? abbreviateList(x.idleHosts, 10) : "none", statusCell(x.idleHosts.length && s.rentState.shareRamPct < 80 ? "watch" : "info", CFG)]
    ];

    p(ns, title("Cloud / Purchased Server Detail", CFG));
    p(ns, table(["Metric", "Value", "Status"], rows, CFG));

    const top = s.topRamUsers
        .filter(x => x.hostClass === "owned")
        .sort((a, b) => b.usedRam - a.usedRam)
        .slice(0, 12)
        .map(x => [
            colour(x.name, "white", CFG),
            colour(`${fmtRam(ns, x.usedRam)}/${fmtRam(ns, x.maxRam)}`, ramTextColour(x.usedRam, x.maxRam), CFG),
            colour(`${x.usedPct.toFixed(2)}%`, ramTextColour(x.usedRam, x.maxRam), CFG),
            colourCycle(x.cycle, CFG),
            colour(String(x.threads), x.threads > 0 ? "green" : "grey", CFG)
        ]);

    if (top.length) {
        p(ns, "");
        p(ns, title("Top owned RAM users", CFG));
        p(ns, table(["Server", "RAM", "Use", "Cycle", "Threads"], top, CFG));
    }
}

function printRent(ns, s, CFG) {
    const r = s.rentState;

    const rows = [
        ["Manager file", r.managerAvailable ? "present on home" : "missing on home", statusCell(r.managerAvailable ? "clear" : "missing", CFG)],
        ["Manager running", r.managerRunning ? `yes on ${r.managerHost}` : "no", statusCell(r.managerRunning ? "working" : "idle", CFG)],
        ["Worker file", `${r.workerDeployedCount}/${r.workerDeployableHostCount} owned hosts (${pct(r.workerDeployedCount, r.workerDeployableHostCount)})`, statusCell(r.workerDeployedCount > 0 ? "working" : "missing", CFG)],
        ["Share workers", `${r.workerProcesses} processes`, statusCell(r.workerProcesses ? "working" : "idle", CFG)],
        ["Share threads", `${r.workerThreads}`, statusCell(r.workerThreads ? "working" : "idle", CFG)],
        ["Share RAM", `${fmtRam(ns, r.shareRam)} (${pct(r.shareRam, s.totalMaxRam)} of network RAM)`, statusCell(r.shareRam > 0 ? "working" : "idle", CFG)],
        ["Share hosts", r.shareHosts.length ? abbreviateList(r.shareHosts, 12) : "none", statusCell(r.shareHosts.length ? "working" : "idle", CFG)],
        ["Direct money earned", "$0", statusCell("info", CFG)],
        ["Share power", r.sharePower === null ? "unavailable" : r.sharePower.toFixed(6), statusCell(r.sharePower ? "working" : "info", CFG)],
        ["Rep benefit", "boosts faction reputation gain; no direct cash rental API", statusCell("info", CFG)],
        ["Idle owned hosts", r.idleOwnedHosts.length ? abbreviateList(r.idleOwnedHosts, 12) : "none", statusCell(r.idleOwnedHosts.length && r.shareRamPct < 80 ? "watch" : "info", CFG)],
        ["Missing worker hosts", r.missingWorkerHosts.length ? abbreviateList(r.missingWorkerHosts, 12) : "none", statusCell(r.missingWorkerHosts.length && !r.managerRunning ? "watch" : "info", CFG)]
    ];

    p(ns, title("Spare Capacity / Faction Share", CFG));
    p(ns, table(["Metric", "Value", "Status"], rows, CFG));
}

function printForecast(ns, forecasts, CFG) {
    const moneyRows = forecasts
        .filter(f => f.maxMoney > 0)
        .sort((a, b) => {
            if (a.readyToHackNow !== b.readyToHackNow) return a.readyToHackNow ? -1 : 1;
            if (a.etaMs !== b.etaMs) return a.etaMs - b.etaMs;
            return b.expectedHackValue - a.expectedHackValue;
        })
        .slice(0, CFG.forecastRows)
        .map(f => [
            colour(f.server, f.readyToHackNow ? "green" : f.stage.includes("weaken") ? "cyan" : "yellow", CFG),
            colour(f.stage, f.readyToHackNow ? "green" : f.stage.includes("weaken") ? "cyan" : "yellow", CFG),
            f.etaText,
            `${f.moneyPct.toFixed(1)}%`,
            `${f.security.toFixed(1)}/${f.minSecurity.toFixed(1)} +${f.securityExcess.toFixed(1)}`,
            String(f.estimatedHackThreads),
            fmtMoney(ns, f.estimatedHackTake),
            fmtMoney(ns, f.expectedHackValue),
            `${(f.hackChance * 100).toFixed(1)}%`,
            `${fmtDuration(f.hackTime)} / ${fmtDuration(f.growTime)} / ${fmtDuration(f.weakenTime)}`,
            f.manager
        ]);

    p(ns, title("Forecast — next hack / grow / weaken estimates", CFG));

    if (!moneyRows.length) {
        p(ns, dim("No money-server forecasts available.", CFG));
        return;
    }

    p(ns, table([
        "Target",
        "Stage",
        "ETA hack",
        "Money",
        "Sec",
        "Hack t",
        "Hack gross",
        "Hack expected",
        "Chance",
        "H/G/W time",
        "Manager"
    ], moneyRows, CFG));

    p(ns, "");
    p(ns, dim("Forecast assumptions: process.js defaults; security buffer/money target/hack target can be passed as args 4–6.", CFG));
    p(ns, dim("ETA is rough: weaken/grow are adaptive and can change after each worker finishes.", CFG));
}

function printCycles(ns, s, CFG) {
    const rows = Object.entries(s.cycles).map(([cycle, v]) => [
        colourCycle(cycle, CFG),
        `${v.servers}/${s.totalServers} (${pct(v.servers, s.totalServers)})`,
        colour(String(v.threads), v.threads > 0 ? "green" : "grey", CFG)
    ]);

    p(ns, title("Cycles", CFG));
    p(ns, table(["Cycle", "Servers", "Threads"], rows, CFG));
}

function printIssues(ns, s, CFG) {
    const issues = [];

    if (s.rooted < s.totalServers) {
        issues.push(["red", "Unrooted servers", `Root remaining: ${abbreviateList(s.reasons.noRoot, 10)}`]);
    }

    if (s.coreDeployed < s.totalServers) {
        issues.push(["red", "Core payload incomplete", "Run upload.js, then assign-targets.js."]);
    }

    if (s.managedMoneyServers < s.moneyServers) {
        issues.push(["red", "Unmanaged money servers", `Run assign-targets.js. Servers: ${abbreviateList(s.reasons.unmanagedMoney, 10)}`]);
    }

    if (!s.rentState.managerAvailable) {
        issues.push(["yellow", "Rent manager script missing", "Copy rent-capacity.js to home."]);
    } else if (!s.rentState.managerRunning && s.totalUsedRam / Math.max(1, s.totalMaxRam) < 0.85) {
        issues.push(["yellow", "Spare-capacity manager is not running", "Run rent-capacity.js 8 0.98 5000 1 false rep."]);
    }

    if (s.rentState.managerRunning && s.rentState.workerProcesses === 0 && s.totalUsedRam / Math.max(1, s.totalMaxRam) < 0.85) {
        issues.push(["yellow", "Rent manager running but no share workers", "Check rent-share.js exists on home and manager logs."]);
    }

    if (s.purchased.totalRam < s.purchased.maxPossibleRam && s.purchased.count >= s.purchased.limit) {
        issues.push(["yellow", "Purchased/cloud fleet full but under-upgraded", "Run buy-servers.js when cash permits, then startup.js true false."]);
    }

    if (s.cycles.weaken.servers + s.cycles.grow.servers > Math.max(1, s.cycles.hack.servers * 2)) {
        issues.push(["yellow", "Network is still preparing targets", "Normal after redeploy. Let weaken/grow cycles complete."]);
    }

    if (s.totalMaxRam > 0 && s.totalUsedRam / s.totalMaxRam < 0.25) {
        issues.push(["yellow", "Network RAM is underused", "If all money targets are managed, run rent-capacity.js as filler."]);
    }

    if (!issues.length) {
        issues.push(["green", "No major issues", "Continue monitoring."]);
    }

    const rows = issues.map(([severity, issue, action]) => [
        colour(severity, severity === "red" ? "red" : severity === "yellow" ? "yellow" : "green", CFG),
        colour(issue, severity === "red" ? "red" : severity === "yellow" ? "yellow" : "green", CFG),
        action
    ]);

    p(ns, title("Actions", CFG));
    p(ns, table(["Severity", "Issue", "Suggested action"], rows, CFG));
}

function statusCell(status, CFG) {
    return colourStatus(status, CFG);
}

function managerColour(row) {
    if (row.isRemoteManaged) return "cyan";
    if (row.isLocalManaged) return "green";
    if (row.hostClass === "owned") return "yellow";
    return "grey";
}

function ramTextColour(used, total) {
    const p = pctNum(used, total);
    if (p >= 85) return "green";
    if (p >= 40) return "cyan";
    if (p >= 10) return "yellow";
    return "grey";
}

function moneyTextColour(current, max) {
    const p = pctNum(current, max);
    if (p >= 80) return "green";
    if (p >= 40) return "cyan";
    if (p >= 10) return "yellow";
    return "red";
}

/* ==============================
   AI handoff
   ============================== */

function printHandoff(ns, s, forecasts, CFG) {
    const forecastPayload = forecasts
        .sort((a, b) => a.etaMs - b.etaMs || b.expectedHackValue - a.expectedHackValue)
        .slice(0, CFG.forecastRows)
        .map(f => ({
            server: f.server,
            stage: f.stage,
            readyToHackNow: f.readyToHackNow,
            etaMs: f.etaMs,
            etaText: f.etaText,
            moneyPct: f.moneyPct,
            security: f.security,
            minSecurity: f.minSecurity,
            securityExcess: f.securityExcess,
            estimatedHackThreads: f.estimatedHackThreads,
            estimatedHackTake: f.estimatedHackTake,
            expectedHackValue: f.expectedHackValue,
            hackChance: f.hackChance,
            hackTime: f.hackTime,
            growTime: f.growTime,
            weakenTime: f.weakenTime,
            manager: f.manager,
            cycle: f.cycle,
            cycleThreads: f.cycleThreads
        }));

    const payload = {
        context: "Bitburner compact v3 network health report",
        timestamp: Date.now(),
        summary: {
            totalServers: s.totalServers,
            rooted: s.rooted,
            corePayloadDeployed: s.coreDeployed,
            stagedPayloadDeployed: s.stagedDeployed,
            rent: {
                managerAvailable: s.rentState.managerAvailable,
                managerRunning: s.rentState.managerRunning,
                managerHost: s.rentState.managerHost,
                workerDeployedCount: s.rentState.workerDeployedCount,
                workerDeployableHostCount: s.rentState.workerDeployableHostCount,
                workerDeployedPct: pctNum(s.rentState.workerDeployedCount, s.rentState.workerDeployableHostCount),
                workerProcesses: s.rentState.workerProcesses,
                workerThreads: s.rentState.workerThreads,
                shareRam: s.rentState.shareRam,
                shareRamPct: s.rentState.shareRamPct,
                sharePower: s.rentState.sharePower,
                directMoneyEarned: 0,
                shareHosts: s.rentState.shareHosts,
                idleOwnedHosts: s.rentState.idleOwnedHosts,
                missingWorkerHosts: s.rentState.missingWorkerHosts
            },
            forecast: {
                hackEligibleNow: s.hackEligibleNow,
                estimatedNextHackGross: s.estimatedNextHackValue,
                estimatedNextHackExpected: s.estimatedNextHackExpectedValue,
                rows: forecastPayload
            },
            serverPurchase: s.restartState,
            cloudServers: {
                purchasedCount: s.purchased.count,
                limit: s.purchased.limit,
                totalRam: s.purchased.totalRam,
                usedRam: s.purchased.usedRam,
                freeRam: s.purchased.freeRam,
                usedPct: pctNum(s.purchased.usedRam, s.purchased.totalRam),
                maxPossibleRam: s.purchased.maxPossibleRam,
                capacityPct: pctNum(s.purchased.totalRam, s.purchased.maxPossibleRam),
                activeCount: s.purchased.activeCount,
                idleCount: s.purchased.idleCount,
                idleHosts: s.purchased.idleHosts,
                managers: s.purchased.managerCount,
                workers: s.purchased.workerCount,
                workerThreads: s.purchased.workerThreads,
                shareProcesses: s.purchased.shareCount,
                shareThreads: s.purchased.shareThreads
            },
            moneyServers: s.moneyServers,
            nonMoneyServers: s.nonMoneyServers,
            managedMoneyServers: s.managedMoneyServers,
            localManagedMoneyServers: s.localManagedMoneyServers,
            remoteManagedMoneyServers: s.remoteManagedMoneyServers,
            managedMoneyPct: pctNum(s.managedMoneyServers, s.moneyServers),
            totalRamGb: s.totalMaxRam,
            usedRamGb: s.totalUsedRam,
            freeRamGb: s.totalFreeRam,
            ramUsedPct: pctNum(s.totalUsedRam, s.totalMaxRam),
            totalPossibleMoney: s.totalMaxMoney,
            currentMoney: s.totalCurrentMoney,
            currentMoneyPct: pctNum(s.totalCurrentMoney, s.totalMaxMoney)
        },
        cycles: s.cycles,
        drilldown: {
            remoteManaged: s.reasons.remoteManaged,
            localManaged: s.reasons.localManaged,
            unmanagedMoney: s.reasons.unmanagedMoney,
            processIdle: s.reasons.processIdle,
            ownedIdle: s.reasons.ownedIdle,
            ownedActive: s.reasons.ownedActive,
            ownedSharing: s.reasons.ownedSharing,
            missingPayload: s.reasons.missingPayload,
            missingRentWorker: s.reasons.missingRentWorker,
            noRoot: s.reasons.noRoot
        },
        request: "Please diagnose this Bitburner deployment and suggest specific script or operational fixes."
    };

    ns.print("AI handoff block");
    ns.print("Copy/paste the block below back into ChatGPT if you want diagnosis or script changes:");
    ns.print(JSON.stringify(payload, null, 2));
}

/* ==============================
   Process/network state
   ============================== */

function buildProcessMap(ns, servers) {
    const map = new Map();

    for (const host of servers) {
        for (const proc of ns.ps(host)) {
            if (proc.filename !== "process.js") continue;
            const target = proc.args && proc.args.length > 0 ? String(proc.args[0]) : host;
            if (!map.has(target)) {
                map.set(target, { host, pid: proc.pid, args: proc.args });
            }
        }
    }

    return map;
}

function buildProcessIndex(ns, servers) {
    const index = new Map();
    for (const host of servers) {
        index.set(host, ns.ps(host));
    }
    return index;
}

function findLocalProcess(procIndex, server) {
    const processes = procIndex.get(server) ?? [];
    return processes.find(p =>
        p.filename === "process.js" &&
        (!p.args || p.args.length === 0 || String(p.args[0]) === server)
    ) ?? null;
}

function getMoneyCycleInfo(procIndex, target, localProcess, remoteProcess) {
    const manager = remoteProcess || localProcess;
    if (!manager) return { cycle: "none", host: null, threads: 0 };

    const host = manager.host ?? target;
    const processes = procIndex.get(host) ?? [];

    const workerNames = ["weaken.js", "grow.js", "hack.js"];
    const workers = processes.filter(proc =>
        workerNames.includes(proc.filename) &&
        proc.args &&
        proc.args.length > 0 &&
        String(proc.args[0]) === target
    );

    if (!workers.length) {
        if (processes.some(p => p.filename === "process.js")) {
            return { cycle: "idle", host, threads: 0 };
        }
        return { cycle: "none", host, threads: 0 };
    }

    const priority = ["hack.js", "grow.js", "weaken.js"];
    workers.sort((a, b) => priority.indexOf(a.filename) - priority.indexOf(b.filename));

    const chosen = workers[0];
    const threads = workers
        .filter(p => p.filename === chosen.filename)
        .reduce((sum, p) => sum + (p.threads ?? 0), 0);

    return {
        cycle: chosen.filename.replace(".js", ""),
        host,
        threads
    };
}

function getOwnedHostCycle(procIndex, host, CFG) {
    const processes = procIndex.get(host) ?? [];

    const shareWorkers = processes.filter(p => p.filename === CFG.rentWorkerScript);
    if (shareWorkers.length) {
        return {
            cycle: "share",
            host,
            threads: shareWorkers.reduce((sum, p) => sum + (p.threads ?? 0), 0)
        };
    }

    const hgwWorkers = processes.filter(p => ["weaken.js", "grow.js", "hack.js"].includes(p.filename));
    if (hgwWorkers.length) {
        const priority = ["hack.js", "grow.js", "weaken.js"];
        hgwWorkers.sort((a, b) => priority.indexOf(a.filename) - priority.indexOf(b.filename));
        const chosen = hgwWorkers[0];

        return {
            cycle: chosen.filename.replace(".js", ""),
            host,
            threads: hgwWorkers
                .filter(p => p.filename === chosen.filename)
                .reduce((sum, p) => sum + (p.threads ?? 0), 0)
        };
    }

    if (processes.length > 0) return { cycle: "unknown", host, threads: 0 };
    return { cycle: "none", host, threads: 0 };
}

function getPurchasedState(ns, allServers, procIndex, CFG) {
    const purchasedNames = safePurchasedServers(ns);
    const playerOwnedHosts = allServers.filter(s => isOwned(ns, s) && s !== "home");
    const hosts = unique([...purchasedNames, ...playerOwnedHosts]);

    let totalRam = 0;
    let usedRam = 0;
    let totalProcesses = 0;
    let managerCount = 0;
    let workerCount = 0;
    let workerThreads = 0;
    let shareCount = 0;
    let shareThreads = 0;
    let largestRam = 0;
    let smallestRam = Infinity;

    const activeHosts = [];
    const idleHosts = [];

    for (const host of hosts) {
        const maxRam = ns.getServerMaxRam(host);
        const used = ns.getServerUsedRam(host);
        const procs = procIndex.get(host) ?? [];

        totalRam += maxRam;
        usedRam += used;
        totalProcesses += procs.length;
        largestRam = Math.max(largestRam, maxRam);
        if (maxRam > 0) smallestRam = Math.min(smallestRam, maxRam);

        for (const proc of procs) {
            if (proc.filename === "process.js") managerCount++;

            if (["weaken.js", "grow.js", "hack.js"].includes(proc.filename)) {
                workerCount++;
                workerThreads += proc.threads ?? 0;
            }

            if (proc.filename === CFG.rentWorkerScript) {
                shareCount++;
                shareThreads += proc.threads ?? 0;
            }
        }

        if (used > 0) activeHosts.push(host);
        else idleHosts.push(host);
    }

    const limit = safeCall(() => ns.cloud?.getServerLimit?.() ?? ns.getPurchasedServerLimit?.(), hosts.length || 0);
    const maxRamPerServer = safeCall(() => ns.cloud?.getRamLimit?.() ?? ns.getPurchasedServerMaxRam?.(), largestRam || 0);
    const maxPossibleRam = limit * maxRamPerServer;

    return {
        hosts,
        playerOwnedHosts: hosts,
        count: hosts.length,
        limit,
        slotsFree: Math.max(0, limit - hosts.length),
        totalRam,
        usedRam,
        freeRam: Math.max(0, totalRam - usedRam),
        maxPossibleRam,
        maxRamPerServer,
        largestRam,
        smallestRam: smallestRam === Infinity ? 0 : smallestRam,
        activeCount: activeHosts.length,
        idleCount: idleHosts.length,
        activeHosts,
        idleHosts,
        totalProcesses,
        managerCount,
        workerCount,
        workerThreads,
        shareCount,
        shareThreads
    };
}

function getRentState(ns, allServers, procIndex, ownedHosts, CFG) {
    const managerAvailable = ns.fileExists(CFG.rentManagerScript, "home");
    const workerAvailableHome = ns.fileExists(CFG.rentWorkerScript, "home");

    let managerRunning = false;
    let managerHost = null;
    let workerProcesses = 0;
    let workerThreads = 0;
    let shareRam = 0;

    const shareHosts = [];
    const idleOwnedHosts = [];
    const missingWorkerHosts = [];

    const shareRamPerThread = safeCall(() => ns.getScriptRam(CFG.rentWorkerScript, "home"), 0);
    const totalNetworkRam = allServers.reduce((sum, h) => sum + ns.getServerMaxRam(h), 0);
    const sharePower = safeCall(() => {
        if (typeof ns.getSharePower === "function") return ns.getSharePower();
        return null;
    }, null);

    for (const host of allServers) {
        const procs = procIndex.get(host) ?? [];

        for (const proc of procs) {
            if (proc.filename === CFG.rentManagerScript) {
                managerRunning = true;
                managerHost = host;
            }

            if (proc.filename === CFG.rentWorkerScript) {
                workerProcesses++;
                workerThreads += proc.threads ?? 0;
                shareRam += (proc.threads ?? 0) * shareRamPerThread;
                if (!shareHosts.includes(host)) shareHosts.push(host);
            }
        }
    }

    let workerDeployedCount = 0;
    const workerDeployableHostCount = ownedHosts.length;

    for (const host of ownedHosts) {
        if (ns.fileExists(CFG.rentWorkerScript, host)) {
            workerDeployedCount++;
        } else {
            missingWorkerHosts.push(host);
        }

        if ((ns.getServerUsedRam(host) ?? 0) <= 0) {
            idleOwnedHosts.push(host);
        }
    }

    return {
        managerAvailable,
        managerRunning,
        managerHost,
        workerAvailableHome,
        workerDeployedCount,
        workerDeployableHostCount,
        workerProcesses,
        workerThreads,
        shareRam,
        shareRamPct: pctNum(shareRam, totalNetworkRam),
        sharePower,
        shareHosts,
        idleOwnedHosts,
        missingWorkerHosts
    };
}

function getRestartState(ns) {
    const marker = "restart-required.txt";
    const exists = ns.fileExists(marker, "home");
    let text = null;

    if (exists) {
        try {
            text = ns.read(marker);
        } catch (_) {
            text = null;
        }
    }

    const buyRunning = (ns.ps("home") ?? []).some(p => p.filename === "buy-servers.js");

    return {
        buyRunning,
        restartRequired: exists,
        marker: text
    };
}

/* ==============================
   Helpers
   ============================== */

function classifyHost(ns, server) {
    if (server === "home") return "home";
    if (isOwned(ns, server)) return "owned";
    if (ns.getServerMaxMoney(server) > 0) return "money";
    return "other";
}

function isOwned(ns, server) {
    if (server === "home") return true;

    try {
        const info = ns.getServer(server);
        if (info && info.purchasedByPlayer) return true;
    } catch (_) {}

    return server.startsWith("pserv-") || server.startsWith("MooMF");
}

function safePurchasedServers(ns) {
    try {
        if (ns.cloud && typeof ns.cloud.getServerNames === "function") return ns.cloud.getServerNames();
    } catch (_) {}

    try {
        if (typeof ns.getPurchasedServers === "function") return ns.getPurchasedServers();
    } catch (_) {}

    return [];
}

function scanAll(ns, start = "home") {
    const seen = new Set([start]);
    const stack = [start];

    while (stack.length) {
        const host = stack.pop();

        for (const next of ns.scan(host)) {
            if (seen.has(next)) continue;
            seen.add(next);
            stack.push(next);
        }
    }

    return [...seen];
}

function formatManager(row) {
    if (row.isRemoteManaged) return `remote@${row.remoteProcess.host}`;
    if (row.isLocalManaged) return "local";
    if (row.hostClass === "owned") return "host";
    return "none";
}

function formatCycle(row, CFG) {
    if (!row.cycle || row.cycle === "none") return dim("none", CFG);

    const host = row.cycleHost && row.cycleHost !== row.server ? `@${row.cycleHost}` : "";
    return `${colourCycle(row.cycle, CFG)}${host} ${colour(String(row.cycleThreads), row.cycleThreads > 0 ? "green" : "grey", CFG)}t`;
}

function moneyPct(current, max) {
    if (max <= 0) return "-";
    return `${pct(current, max)} ${formatCompactMoney(current)}`;
}

function formatCompactMoney(value) {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}t`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;
    return `$${Number(value).toFixed(0)}`;
}

function fmtMoney(ns, value) {
    try {
        if (ns.format && typeof ns.format.money === "function") return ns.format.money(value);
    } catch (_) {}

    return formatCompactMoney(value);
}

function fmtRam(ns, value) {
    try {
        if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(value);
    } catch (_) {}

    try {
        if (typeof ns.formatRam === "function") return ns.formatRam(value);
    } catch (_) {}

    return `${Number(value).toFixed(1)}GB`;
}

function pct(value, total) {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "0.0%";
    return `${((value / total) * 100).toFixed(1)}%`;
}

function pctNum(value, total) {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
    return (value / total) * 100;
}

function ramStatus(used, total) {
    const p = pctNum(used, total);
    if (p >= 85) return "busy";
    if (p >= 40) return "working";
    if (p >= 10) return "light";
    return "idle";
}

function moneyStatus(current, max) {
    const p = pctNum(current, max);
    if (p >= 80) return "good";
    if (p >= 40) return "partial";
    if (p >= 10) return "low";
    return "poor";
}

function abbreviateList(values, limit = 8) {
    if (!values || !values.length) return "none";
    if (values.length <= limit) return values.join(", ");
    return `${values.slice(0, limit).join(", ")} ... +${values.length - limit} more`;
}

function unique(values) {
    return [...new Set(values)];
}

function parseBool(value) {
    if (typeof value === "boolean") return value;
    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function safeCall(fn, fallback) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch (_) {
        return fallback;
    }
}

function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "now";

    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

async function openTail(ns, titleText) {
    const x = 5;
    const y = 5;
    const width = 1400;
    const height = 750;

    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();
            await ns.sleep(75);

            try {
                if (typeof ns.ui.resizeTail === "function") {
                    ns.ui.resizeTail(width, height);
                }
            } catch (_) {}

            try {
                if (typeof ns.ui.moveTail === "function") {
                    ns.ui.moveTail(x, y);
                }
            } catch (_) {}

            try {
                if (titleText && typeof ns.ui.setTailTitle === "function") {
                    ns.ui.setTailTitle(titleText);
                }
            } catch (_) {}

            return;
        }
    } catch (_) {}

    try {
        ns.tail();
        await ns.sleep(75);

        try {
            if (typeof ns.resizeTail === "function") {
                ns.resizeTail(width, height);
            }
        } catch (_) {}

        try {
            if (typeof ns.moveTail === "function") {
                ns.moveTail(x, y);
            }
        } catch (_) {}

        try {
            if (titleText && typeof ns.setTitle === "function") {
                ns.setTitle(titleText);
            }
        } catch (_) {}
    } catch (_) {}
}