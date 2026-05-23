/**
 * process.js
 *
 * Persistent per-target controller.
 *
 * Can run locally:
 *   run process.js target
 *
 * Or remotely:
 *   run process.js target
 *
 * Args:
 *   0 targetServer       default: current host
 *   1 securityBuffer     default: 5
 *   2 moneyTargetRatio   default: 0.85
 *   3 hackTargetRatio    default: 0.10
 *   4 sleepMs            default: 5000
 *
 * Behaviour:
 *   - If security is above min + buffer: weaken
 *   - Else if money is below threshold: grow
 *   - Else: hack
 *
 * This version aggressively kills stale workers for the same target on the same host
 * whenever the desired action changes.
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();
    const target = String(ns.args[0] || host);

    const securityBuffer = num(ns.args[1], 5);
    const moneyTargetRatio = clamp(num(ns.args[2], 0.85), 0.01, 1);
    const hackTargetRatio = clamp(num(ns.args[3], 0.10), 0.001, 0.95);
    const sleepMs = Math.max(1000, num(ns.args[4], 5000));

    const scripts = {
        weaken: "weaken.js",
        grow: "grow.js",
        hack: "hack.js",
    };

    if (!ns.serverExists(target)) {
        ns.print(`ERROR: target does not exist: ${target}`);
        return;
    }

    if (target === "home") {
        ns.print("ERROR: refusing to target home.");
        return;
    }

    for (const script of Object.values(scripts)) {
        if (!ns.fileExists(script, host)) {
            ns.print(`ERROR: missing ${script} on ${host}`);
            return;
        }
    }

    while (true) {
        try {
            await tick(ns, host, target, scripts, {
                securityBuffer,
                moneyTargetRatio,
                hackTargetRatio,
            });
        } catch (e) {
            ns.print(`ERROR: ${String(e)}`);
        }

        await ns.sleep(sleepMs);
    }
}

async function tick(ns, host, target, scripts, config) {
    const rooted = ns.hasRootAccess(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const currentMoney = ns.getServerMoneyAvailable(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const currentSecurity = ns.getServerSecurityLevel(target);

    const allowedSecurity = minSecurity + config.securityBuffer;
    const securityExcess = Math.max(0, currentSecurity - allowedSecurity);
    const moneyTarget = maxMoney * config.moneyTargetRatio;
    const moneyDeficit = Math.max(0, moneyTarget - currentMoney);

    let desiredAction = "idle";
    let desiredScript = null;
    let wantedThreads = 0;
    let reason = "";

    if (!rooted) {
        reason = "noRoot";
    } else if (maxMoney <= 0) {
        reason = "noMoney";
    } else if (securityExcess > 0.0001) {
        desiredAction = "weaken";
        desiredScript = scripts.weaken;
        wantedThreads = calcWeakenThreads(ns, securityExcess);
        reason = "security";
    } else if (currentMoney < moneyTarget) {
        desiredAction = "grow";
        desiredScript = scripts.grow;
        wantedThreads = calcGrowThreads(ns, target, currentMoney, moneyTarget);
        reason = "money";
    } else {
        desiredAction = "hack";
        desiredScript = scripts.hack;
        wantedThreads = calcHackThreads(ns, target, config.hackTargetRatio);
        reason = "payout";
    }

    const state = {
        timestamp: Date.now(),
        host,
        target,
        rooted,
        desiredAction,
        reason,
        currentMoney,
        maxMoney,
        moneyPct: maxMoney > 0 ? currentMoney / maxMoney * 100 : 0,
        moneyTarget,
        moneyDeficit,
        currentSecurity,
        minSecurity,
        allowedSecurity,
        securityExcess,
        wantedThreads,
        running: getTargetWorkers(ns, host, target),
    };

    if (!desiredScript || wantedThreads <= 0) {
        killTargetWorkers(ns, host, target);
        writeState(ns, host, target, { ...state, launched: false, runnableThreads: 0 });
        return;
    }

    const runningDesired = getTargetWorkers(ns, host, target)
        .filter(p => p.filename === desiredScript);

    const runningWrong = getTargetWorkers(ns, host, target)
        .filter(p => p.filename !== desiredScript);

    for (const proc of runningWrong) {
        ns.kill(proc.pid);
    }

    if (runningDesired.length > 0) {
        writeState(ns, host, target, {
            ...state,
            launched: false,
            launchReason: "desired worker already running",
            running: getTargetWorkers(ns, host, target),
        });
        return;
    }

    const runnableThreads = calcRunnableThreads(ns, host, desiredScript, wantedThreads);

    if (runnableThreads <= 0) {
        writeState(ns, host, target, {
            ...state,
            launched: false,
            runnableThreads,
            launchReason: "insufficient RAM",
        });
        return;
    }

    const pid = ns.exec(desiredScript, host, runnableThreads, target);

    writeState(ns, host, target, {
        ...state,
        launched: pid > 0,
        pid,
        runnableThreads,
        launchReason: pid > 0 ? "started worker" : "exec failed",
    });
}

function getTargetWorkers(ns, host, target) {
    const workerNames = new Set(["weaken.js", "grow.js", "hack.js"]);

    return ns.ps(host)
        .filter(p => workerNames.has(p.filename))
        .filter(p => String(p.args[0] || host) === target)
        .map(p => ({
            pid: p.pid,
            filename: p.filename,
            threads: p.threads,
            args: p.args.map(String),
        }));
}

function killTargetWorkers(ns, host, target) {
    for (const proc of getTargetWorkers(ns, host, target)) {
        ns.kill(proc.pid);
    }
}

function calcWeakenThreads(ns, securityExcess) {
    const perThread = ns.weakenAnalyze(1);
    if (!Number.isFinite(perThread) || perThread <= 0) return 1;
    return Math.max(1, Math.ceil(securityExcess / perThread));
}

function calcGrowThreads(ns, target, currentMoney, targetMoney) {
    if (targetMoney <= 0) return 0;

    const safeCurrent = Math.max(1, currentMoney);
    const growthFactor = Math.max(1.01, targetMoney / safeCurrent);

    let threads = 1;

    try {
        threads = Math.ceil(ns.growthAnalyze(target, growthFactor));
    } catch {
        threads = 1;
    }

    if (!Number.isFinite(threads) || threads <= 0) threads = 1;

    return Math.max(1, threads);
}

function calcHackThreads(ns, target, hackTargetRatio) {
    const perThread = ns.hackAnalyze(target);

    if (!Number.isFinite(perThread) || perThread <= 0) {
        return 0;
    }

    return Math.max(1, Math.ceil(hackTargetRatio / perThread));
}

function calcRunnableThreads(ns, host, script, wantedThreads) {
    const scriptRam = ns.getScriptRam(script, host);
    if (!Number.isFinite(scriptRam) || scriptRam <= 0) return 0;

    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = Math.max(0, maxRam - usedRam);

    const maxThreads = Math.floor(freeRam / scriptRam);

    return Math.max(0, Math.min(wantedThreads, maxThreads));
}

function writeState(ns, host, target, state) {
    const safeTarget = target.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const file = `/data/process-state-${safeTarget}.json`;

    try {
        ns.write(file, JSON.stringify(sanitizeForJson(state), null, 2), "w");
    } catch {
        // State output is useful but not required.
    }

    if (host === target) {
        try {
            ns.write("process-state.json", JSON.stringify(sanitizeForJson(state), null, 2), "w");
        } catch {
            // Legacy local state output is useful but not required.
        }
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

    if (Array.isArray(value)) {
        return value.map(sanitizeForJson);
    }

    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = sanitizeForJson(value[key]);
    }

    return output;
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}