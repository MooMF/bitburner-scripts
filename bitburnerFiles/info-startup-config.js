/**
 * info-startup-config.js
 *
 * Diagnostic-driven startup configuration generator.
 *
 * Purpose:
 *   Read current info-* reports and decide the best considered startup config
 *   for this moment. startup.js should consume this file rather than hard-code
 *   strategy.
 *
 * Reads:
 *   /data/manager/runtime.json
 *   /data/manager/money.json
 *   /data/manager/security.json
 *   /data/manager/payouts.json
 *   /data/manager/share.json
 *   /data/manager/contracts.json
 *   /data/manager/contracts-triage.json
 *   /data/manager/ai-diagnostic.json
 *
 * Writes:
 *   /data/manager/startup-config.json
 *
 * Usage:
 *   run info-startup-config.js
 *   run info-startup-config.js silent
 *   run info-startup-config.js silent normal
 *   run info-startup-config.js silent money-first
 *   run info-startup-config.js silent no-share
 *   run info-startup-config.js silent no-buy
 *   run info-startup-config.js silent reports
 *
 * Args:
 *   0 silent|mode     If "silent", do not open tail. Otherwise treated as mode.
 *   1 mode           Used when arg0 is "silent".
 *
 * Modes:
 *   normal       choose from reports
 *   money-first  bias towards lower share and larger reserve
 *   no-share     disable share startup
 *   no-buy       skip buy-servers
 *   reports      reports-only recommendation
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const arg0 = String(ns.args[0] || "").toLowerCase();
    const silent = arg0 === "silent";
    const mode = silent
        ? String(ns.args[1] || "normal").toLowerCase()
        : String(ns.args[0] || "normal").toLowerCase();

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1180, 720);
    }

    const reports = readReports(ns);
    const observations = buildObservations(ns, reports);
    const recommendation = buildRecommendation(mode, observations, reports);

    const output = {
        context: "Bitburner startup configuration recommendation",
        schemaVersion: 1,
        generatedAt: Date.now(),
        generatedAtText: new Date().toISOString(),
        mode,
        source: "info-startup-config.js",

        inputs: {
            reportFiles: {
                runtime: "/data/manager/runtime.json",
                money: "/data/manager/money.json",
                security: "/data/manager/security.json",
                payouts: "/data/manager/payouts.json",
                share: "/data/manager/share.json",
                contracts: "/data/manager/contracts.json",
                contractsTriage: "/data/manager/contracts-triage.json",
                diagnostic: "/data/manager/ai-diagnostic.json",
            },
            reportsPresent: {
                runtime: Boolean(reports.runtime),
                money: Boolean(reports.money),
                security: Boolean(reports.security),
                payouts: Boolean(reports.payouts),
                share: Boolean(reports.share),
                contracts: Boolean(reports.contracts),
                contractsTriage: Boolean(reports.contractsTriage),
                diagnostic: Boolean(reports.diagnostic),
            },
        },

        observations,
        config: recommendation.config,
        reasoning: recommendation.reasoning,
        warnings: recommendation.warnings,
        suggestedManualChecks: recommendation.suggestedManualChecks,

        nextPromptSeed: {
            prompt: "Review this startup-config.json together with ai-diagnostic.json. Check whether the chosen share cap, reserve, buy budget, and assignment settings are appropriate. If not, rewrite info-startup-config.js.",
            focus: recommendation.reasoning.slice(0, 8),
        },
    };

    ns.write("/data/manager/startup-config.json", JSON.stringify(sanitizeForJson(output), null, 2), "w");

    if (!silent) {
        printReport(ns, output);
    }
}

function readReports(ns) {
    return {
        runtime: readJson(ns, "/data/manager/runtime.json", null),
        money: readJson(ns, "/data/manager/money.json", null),
        security: readJson(ns, "/data/manager/security.json", null),
        payouts: readJson(ns, "/data/manager/payouts.json", null),
        share: readJson(ns, "/data/manager/share.json", null),
        contracts: readJson(ns, "/data/manager/contracts.json", null),
        contractsTriage: readJson(ns, "/data/manager/contracts-triage.json", null),
        diagnostic: readJson(ns, "/data/manager/ai-diagnostic.json", null),
    };
}

function buildObservations(ns, reports) {
    const runtime = reports.runtime?.summary || {};
    const money = reports.money?.summary || {};
    const security = reports.security?.summary || {};
    const payouts = reports.payouts?.summary || {};
    const share = reports.share?.summary || {};
    const contracts = reports.contracts?.summary || {};
    const contractsTriage = reports.contractsTriage?.summary || {};

    const totalServers = number(runtime.totalServers, 0);
    const moneyServers = number(runtime.moneyServers, number(money.moneyTargets, 0));

    const managedTargets = number(runtime.managedTargets, 0);
    const unmanagedTargets = number(runtime.unmanagedTargets, Math.max(0, moneyServers - managedTargets));

    const ramUsedPct = number(runtime.ramUsedPct, null);
    const payloadMissing = number(runtime.payloadMissing, 0);
    const restartRequired = Boolean(runtime.restartRequired || ns.fileExists("restart-required.txt", "home"));

    const lowMoneyTargets = number(money.lowMoneyTargets, 0);
    const moneyPct = number(money.moneyPct, null);

    const securityBlockedTargets = number(security.notReadyTargets, 0);
    const securityExcess = number(security.totalSecurityExcess, 0);
    const worstSecurityServer = stringOrNull(security.worstServer);

    const hackReadyTargets = number(payouts.hackReadyTargets, 0);
    const preparedButUnhackableTargets = number(payouts.preparedButUnhackableTargets, 0);
    const blockedBySecurityTargets = number(payouts.blockedBySecurityTargets, securityBlockedTargets);
    const blockedByMoneyTargets = number(payouts.blockedByMoneyTargets, lowMoneyTargets);

    const shareManagerRunning = Boolean(
        share.managerRunning ||
        share.rentCapacityRunning ||
        share.managerAvailable === true && share.managerRunning === true
    );

    const shareRamPct = firstNumber([
        share.shareRamPct,
        share.totalShareRamPct,
        share.currentSharePct,
        share.shareCapableUsedPct,
    ], null);

    const shareThreads = firstNumber([
        share.shareThreads,
        share.workerThreads,
        share.currentShareThreads,
    ], 0);

    const shareWorkers = firstNumber([
        share.shareWorkers,
        share.workerProcesses,
        share.currentShareWorkers,
    ], 0);

    const shareReserveGb = firstNumber([
        share.reserveGb,
        share.shareReserveGb,
    ], null);

    const sharePower = firstNumber([
        share.sharePower,
    ], null);

    const uniqueContracts = firstNumber([
        contracts.validUniqueContracts,
        contracts.uniqueContracts,
        contracts.discovered,
    ], 0);

    const contractRawFiles = number(contracts.rawContractFilesFound, 0);
    const contractDupesSuppressed = number(contracts.duplicateFilesSuppressed, 0);

    const contractTriageTotal = number(contractsTriage.total, number(contractsTriage.valid, 0));
    const contractLowTries = number(contractsTriage.lowTries, 0);

    const homeRam = getHomeRam(ns);

    const purchasedServers = safeCall(() => ns.getPurchasedServers(), []);
    const purchasedServerLimit = safeCall(() => ns.getPurchasedServerLimit(), 0);
    const purchasedServerMaxRam = safeCall(() => ns.getPurchasedServerMaxRam(), 0);

    const moneyPressure =
        lowMoneyTargets >= 20 ||
        (moneyPct !== null && moneyPct < 95);

    const securityPressure =
        securityBlockedTargets >= 10 ||
        securityExcess >= 100;

    const sharePressure =
        shareRamPct !== null
            ? shareRamPct >= 90
            : shareThreads > 1000000;

    const assignmentPressure =
        unmanagedTargets > 0;

    const deploymentPressure =
        restartRequired || payloadMissing > 0;

    const hackingLevelPressure =
        hackReadyTargets === 0 && preparedButUnhackableTargets > 0;

    const contractPressure =
        uniqueContracts > 0;

    return {
        totalServers,
        moneyServers,

        runtime: {
            managedTargets,
            unmanagedTargets,
            ramUsedPct,
            payloadMissing,
            restartRequired,
            weakenWorkers: number(runtime.weakenWorkers, 0),
            growWorkers: number(runtime.growWorkers, 0),
            hackWorkers: number(runtime.hackWorkers, 0),
            idleManagers: number(runtime.idleManagers, 0),
        },

        money: {
            moneyPct,
            lowMoneyTargets,
            readyTargets: number(money.readyTargets, 0),
            moneyTargets: number(money.moneyTargets, moneyServers),
        },

        security: {
            blockedTargets: securityBlockedTargets,
            totalExcess: securityExcess,
            worstServer: worstSecurityServer,
            readyTargets: number(security.readyTargets, 0),
        },

        payouts: {
            hackReadyTargets,
            preparedButUnhackableTargets,
            blockedBySecurityTargets,
            blockedByMoneyTargets,
            nextHackMoney: number(payouts.nextHackMoney, 0),
            bestTarget: stringOrNull(payouts.bestTarget),
        },

        share: {
            managerRunning: shareManagerRunning,
            shareRamPct,
            shareThreads,
            shareWorkers,
            shareReserveGb,
            sharePower,
        },

        contracts: {
            uniqueValid: uniqueContracts,
            rawFiles: contractRawFiles,
            duplicatesSuppressed: contractDupesSuppressed,
            triageTotal: contractTriageTotal,
            lowTries: contractLowTries,
        },

        home: homeRam,

        purchasedServers: {
            count: purchasedServers.length,
            limit: purchasedServerLimit,
            maxRam: purchasedServerMaxRam,
            canBuyMore: purchasedServers.length < purchasedServerLimit,
        },

        pressure: {
            moneyPressure,
            securityPressure,
            sharePressure,
            assignmentPressure,
            deploymentPressure,
            hackingLevelPressure,
            contractPressure,
        },
    };
}

function buildRecommendation(mode, obs, reports) {
    const reasoning = [];
    const warnings = [];
    const suggestedManualChecks = [];

    const config = {
        cleanManaged: true,
        cleanShare: true,
        uploadPayloads: true,

        buyServers: true,
        buyPct: 0.40,
        uploadAfterBuy: true,

        assignTargets: true,
        assignMinThreads: 1,
        assignReserveThreads: 2,

        startShare: true,
        sharePct: 50,
        shareReserveGb: 2048,
        shareHome: false,
        shareLoopMs: 10000,

        securityBuffer: 5,
        moneyTargetRatio: 0.85,
        hackTargetRatio: 0.10,

        refreshContracts: false,
        openManagerConsole: true,
        consoleView: "overview",
    };

    reasoning.push("Baseline config starts from conservative automation defaults.");
    reasoning.push("startup.js is expected to execute this config, not decide policy itself.");

    if (!reports.runtime) {
        warnings.push("runtime report missing; using fallback assignment and cleanup defaults.");
    }

    if (!reports.share) {
        warnings.push("share report missing; using conservative share cap.");
    }

    if (obs.pressure.deploymentPressure) {
        config.cleanManaged = true;
        config.cleanShare = true;
        config.uploadPayloads = true;
        config.uploadAfterBuy = true;
        reasoning.push("Deployment pressure detected: restart marker or missing payloads; clean and upload are enabled.");
    }

    if (obs.pressure.assignmentPressure) {
        config.assignTargets = true;
        config.cleanManaged = true;
        reasoning.push(`${obs.runtime.unmanagedTargets} unmanaged money target(s) detected; target assignment is mandatory.`);
    } else {
        reasoning.push("No unmanaged target pressure detected; assignment still enabled as a cheap consistency pass.");
    }

    if (obs.pressure.sharePressure) {
        config.cleanShare = true;
        config.sharePct = 25;
        config.shareReserveGb = 4096;
        reasoning.push("Share pressure detected; reducing share cap to 25% and reserving 4096GB per share host.");
    } else if (obs.pressure.securityPressure || obs.pressure.moneyPressure || obs.pressure.assignmentPressure) {
        config.sharePct = 50;
        config.shareReserveGb = 2048;
        reasoning.push("Money/security/assignment pressure detected; share allowed but capped at 50% with 2048GB reserve.");
    } else {
        config.sharePct = 70;
        config.shareReserveGb = 1024;
        reasoning.push("No strong money/security/assignment pressure; share cap relaxed to 70% with 1024GB reserve.");
    }

    if (obs.pressure.securityPressure) {
        config.securityBuffer = 5;
        config.moneyTargetRatio = 0.85;
        config.hackTargetRatio = 0.10;
        config.consoleView = "security";
        reasoning.push(`${obs.security.blockedTargets} security-blocked target(s), total excess ${round(obs.security.totalExcess, 2)}; preserving RAM for weaken/grow work.`);
        suggestedManualChecks.push("run manager-console.js security 25");
    }

    if (obs.pressure.moneyPressure) {
        config.moneyTargetRatio = 0.85;
        config.consoleView = config.consoleView === "security" ? "overview" : "money";
        reasoning.push(`${obs.money.lowMoneyTargets} low-money target(s), network money ${formatPct(obs.money.moneyPct)}; keeping money target ratio at 0.85 until backlog falls.`);
        suggestedManualChecks.push("run manager-console.js money 40");
    }

    if (obs.payouts.hackReadyTargets > 0) {
        config.hackTargetRatio = 0.10;
        config.consoleView = "payouts";
        reasoning.push(`${obs.payouts.hackReadyTargets} hack-ready target(s); hack ratio remains 10%.`);
        suggestedManualChecks.push("run manager-console.js payouts 25");
    }

    if (obs.pressure.hackingLevelPressure) {
        reasoning.push(`${obs.payouts.preparedButUnhackableTargets} prepared target(s) are unhackable at current hack analysis; this is likely hacking-level/formula pressure, not startup failure.`);
        suggestedManualChecks.push("run manager-console.js payouts 25");
    }

    if (obs.runtime.ramUsedPct !== null && obs.runtime.ramUsedPct > 95 && !obs.pressure.sharePressure) {
        config.sharePct = Math.min(config.sharePct, 50);
        config.shareReserveGb = Math.max(config.shareReserveGb, 2048);
        reasoning.push(`Overall RAM use is high (${formatPct(obs.runtime.ramUsedPct)}); share cap held to ${config.sharePct}%.`);
    }

    if (obs.home.maxRam > 0 && obs.home.usedPct > 80) {
        config.shareHome = false;
        reasoning.push("Home RAM use is high; share on home is disabled.");
    } else {
        config.shareHome = false;
        reasoning.push("Share on home remains disabled to preserve command/reporting capacity.");
    }

    if (obs.purchasedServers.canBuyMore) {
        config.buyServers = true;
        config.buyPct = 0.40;
        reasoning.push(`Purchased server count ${obs.purchasedServers.count}/${obs.purchasedServers.limit}; buying/upgrading remains enabled at 40% budget.`);
    } else {
        config.buyServers = true;
        config.buyPct = 0.40;
        reasoning.push("Purchased server limit reached or unknown; buy-servers.js should handle upgrade behaviour at 40% budget.");
    }

    if (obs.contracts.uniqueValid > 0) {
        config.refreshContracts = false;
        reasoning.push(`${obs.contracts.uniqueValid} unique valid contract(s) known; contract refresh disabled during normal startup to avoid slow/heavy startup runs.`);
        suggestedManualChecks.push("run info-contract-triage.js 50");
    }

    if (obs.contracts.lowTries > 0) {
        warnings.push(`${obs.contracts.lowTries} contract(s) appear to have low tries remaining; do not auto-solve without tested solvers.`);
    }

    if (mode === "money-first") {
        config.sharePct = Math.min(config.sharePct, 25);
        config.shareReserveGb = Math.max(config.shareReserveGb, 4096);
        config.cleanShare = true;
        config.assignTargets = true;
        config.consoleView = "overview";
        reasoning.push("Mode override money-first: share cap forced down and reserve increased.");
    }

    if (mode === "no-share") {
        config.startShare = false;
        config.sharePct = 0;
        config.cleanShare = true;
        reasoning.push("Mode override no-share: share manager disabled and existing share cleaned.");
    }

    if (mode === "no-buy") {
        config.buyServers = false;
        config.uploadAfterBuy = false;
        reasoning.push("Mode override no-buy: purchased server buying/upgrading skipped.");
    }

    if (mode === "reports") {
        config.cleanManaged = false;
        config.cleanShare = false;
        config.uploadPayloads = false;
        config.buyServers = false;
        config.uploadAfterBuy = false;
        config.assignTargets = false;
        config.startShare = false;
        config.refreshContracts = true;
        config.openManagerConsole = false;
        config.consoleView = "overview";
        reasoning.push("Mode override reports: no operational actions, report refresh only.");
    }

    if (config.sharePct <= 0) {
        config.startShare = false;
        reasoning.push("sharePct is zero; startShare disabled.");
    }

    if (config.startShare && config.sharePct > 0) {
        suggestedManualChecks.push("run manager-console.js share");
    }

    suggestedManualChecks.push("run manager-console.js runtime");
    suggestedManualChecks.push("run info-diagnostic.js");

    return {
        config,
        reasoning,
        warnings,
        suggestedManualChecks: unique(suggestedManualChecks),
    };
}

function printReport(ns, output) {
    const config = output.config;
    const obs = output.observations;

    ns.print("STARTUP CONFIG RECOMMENDATION");
    ns.print("=".repeat(118));
    ns.print(`Mode:                  ${output.mode}`);
    ns.print(`Generated:             ${output.generatedAtText}`);
    ns.print("");

    ns.print("OBSERVATIONS");
    ns.print("-".repeat(118));
    ns.print(`Money targets:          ${obs.runtime.managedTargets}/${obs.moneyServers} managed`);
    ns.print(`Unmanaged targets:      ${obs.runtime.unmanagedTargets}`);
    ns.print(`Security blocked:       ${obs.security.blockedTargets}`);
    ns.print(`Security excess:        ${round(obs.security.totalExcess, 2)}`);
    ns.print(`Low-money targets:      ${obs.money.lowMoneyTargets}`);
    ns.print(`Network money:          ${formatPct(obs.money.moneyPct)}`);
    ns.print(`Hack-ready targets:     ${obs.payouts.hackReadyTargets}`);
    ns.print(`Prepared unhackable:    ${obs.payouts.preparedButUnhackableTargets}`);
    ns.print(`Share RAM pct:          ${obs.share.shareRamPct === null ? "unknown" : formatPct(obs.share.shareRamPct)}`);
    ns.print(`Share threads:          ${Math.round(obs.share.shareThreads || 0).toLocaleString()}`);
    ns.print(`Contracts unique valid: ${obs.contracts.uniqueValid}`);
    ns.print("");

    ns.print("SELECTED CONFIG");
    ns.print("-".repeat(118));
    ns.print(`cleanManaged:           ${config.cleanManaged}`);
    ns.print(`cleanShare:             ${config.cleanShare}`);
    ns.print(`uploadPayloads:         ${config.uploadPayloads}`);
    ns.print(`buyServers:             ${config.buyServers}`);
    ns.print(`buyPct:                 ${(config.buyPct * 100).toFixed(1)}%`);
    ns.print(`assignTargets:          ${config.assignTargets}`);
    ns.print(`assign args:            ${config.assignMinThreads} ${config.assignReserveThreads}`);
    ns.print(`startShare:             ${config.startShare}`);
    ns.print(`sharePct:               ${config.sharePct}%`);
    ns.print(`shareReserveGb:         ${formatRam(config.shareReserveGb)}`);
    ns.print(`shareHome:              ${config.shareHome}`);
    ns.print(`consoleView:            ${config.consoleView}`);
    ns.print("");

    ns.print("REASONING");
    ns.print("-".repeat(118));
    for (const line of output.reasoning) {
        ns.print(`- ${line}`);
    }

    if ((output.warnings || []).length > 0) {
        ns.print("");
        ns.print("WARNINGS");
        ns.print("-".repeat(118));
        for (const warning of output.warnings) {
            ns.print(`- ${warning}`);
        }
    }

    ns.print("");
    ns.print("SUGGESTED CHECKS");
    ns.print("-".repeat(118));
    for (const command of output.suggestedManualChecks) {
        ns.print(command);
    }

    ns.print("");
    ns.print("Wrote:");
    ns.print("/data/manager/startup-config.json");
}

function getHomeRam(ns) {
    const maxRam = safeCall(() => ns.getServerMaxRam("home"), 0);
    const usedRam = safeCall(() => ns.getServerUsedRam("home"), 0);

    return {
        maxRam,
        usedRam,
        freeRam: Math.max(0, maxRam - usedRam),
        usedPct: maxRam > 0 ? usedRam / maxRam * 100 : 0,
    };
}

function readJson(ns, file, fallback) {
    try {
        if (!ns.fileExists(file, "home")) return fallback;

        const text = ns.read(file);
        if (!text || !text.trim()) return fallback;

        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function openConsole(ns, width = 1180, height = 720) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
        if (ns.ui && typeof ns.ui.moveTail === "function") ns.ui.moveTail(20, 20);
    } catch {
        // Tail display is useful but not required.
    }
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

function firstNumber(values, fallback) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }

    return fallback;
}

function number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function stringOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    return String(value);
}

function round(value, dp = 2) {
    const n = Number(value || 0);
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
}

function formatPct(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "unknown";
    return `${Number(value).toFixed(1)}%`;
}

function formatRam(gb) {
    gb = Number(gb || 0);

    if (gb >= 1024 * 1024) return `${(gb / 1024 / 1024).toFixed(2)}PB`;
    if (gb >= 1024) return `${(gb / 1024).toFixed(2)}TB`;

    return `${gb.toFixed(2)}GB`;
}

function unique(items) {
    return [...new Set(items)];
}