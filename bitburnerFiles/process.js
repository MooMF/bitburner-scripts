/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();
    const target = String(ns.args[0] ?? host);

    const securityBuffer = Number(ns.args[1] ?? 5);
    const moneyTargetRatio = Number(ns.args[2] ?? 0.85);
    const hackTargetRatio = Number(ns.args[3] ?? 0.10);
    const sleepMs = Number(ns.args[4] ?? 5000);

    /*
        Optional operational controls:
        arg5 reserveGb: RAM to leave free on this worker host.
        arg6 maxUsePct: upper use ceiling for this host, 1.0 = 100%.
    */
    const reserveGb = Number(ns.args[5] ?? 8);
    const maxUsePct = Number(ns.args[6] ?? 0.98);

    const processStateFile = `/data/process-${safeName(target)}.json`;
    const processErrorFile = `/data/process-error-${safeName(target)}.txt`;

    const workers = {
        weaken: "weaken.js",
        grow: "grow.js",
        hack: "hack.js"
    };

    try {
        if (host === "home") return 0;

        if (!ns.serverExists(target)) {
            await writeFatal(ns, processErrorFile, host, target, "target-does-not-exist");
            return -1;
        }

        if (!ns.hasRootAccess(target)) {
            await writeFatal(ns, processErrorFile, host, target, "no-root-access");
            return -2;
        }

        if (ns.getServerMaxRam(host) <= 0) {
            await writeFatal(ns, processErrorFile, host, target, "host-has-no-ram");
            return -3;
        }

        while (true) {
            try {
                if (safeGetMaxMoney(ns, target) > 0) {
                    await manageWorkers(
                        ns,
                        host,
                        target,
                        workers,
                        securityBuffer,
                        moneyTargetRatio,
                        hackTargetRatio,
                        reserveGb,
                        maxUsePct,
                        processStateFile
                    );
                } else {
                    await writeIdleState(ns, host, target, processStateFile, "no-money");
                }
            } catch (cycleError) {
                await writeFatal(
                    ns,
                    processErrorFile,
                    host,
                    target,
                    `cycle-error: ${String(cycleError)}`
                );

                await writeIdleState(
                    ns,
                    host,
                    target,
                    processStateFile,
                    "cycle-error"
                );
            }

            await ns.sleep(sleepMs);
        }
    } catch (fatal) {
        await writeFatal(ns, processErrorFile, host, target, `fatal: ${String(fatal)}`);
        return -99;
    }
}

async function manageWorkers(
    ns,
    host,
    target,
    workers,
    securityBuffer,
    moneyTargetRatio,
    hackTargetRatio,
    reserveGb,
    maxUsePct,
    processStateFile
) {
    const decision = chooseBestAction(
        ns,
        target,
        securityBuffer,
        moneyTargetRatio,
        hackTargetRatio
    );

    stopUnwantedWorkers(ns, host, target, workers, decision.action);

    const script = workers[decision.action];

    if (!script) {
        await writeIdleState(ns, host, target, processStateFile, "no-script");
        return;
    }

    if (!ns.fileExists(script, host)) {
        await writeIdleState(ns, host, target, processStateFile, `missing-${script}`);
        return;
    }

    if (!isWorkerRunningForTarget(ns, host, script, target)) {
        const threads = getRunnableThreads(ns, host, script, decision.wantedThreads, reserveGb, maxUsePct);

        decision.runnableThreads = threads;

        if (threads > 0) {
            const pid = ns.exec(script, host, threads, target);

            decision.startedPid = pid;
            decision.startedThreads = pid > 0 ? threads : 0;

            if (pid === 0) {
                decision.reason = `${decision.reason}; exec-failed`;
            }
        } else {
            decision.reason = `${decision.reason}; no-runnable-threads`;
        }
    }

    await writeProcessState(ns, host, target, decision, workers, processStateFile, reserveGb, maxUsePct);
}

function chooseBestAction(ns, target, securityBuffer, moneyTargetRatio, hackTargetRatio) {
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const currentSecurity = ns.getServerSecurityLevel(target);

    const maxMoney = ns.getServerMaxMoney(target);
    const currentMoney = ns.getServerMoneyAvailable(target);

    const securityLimit = minSecurity + securityBuffer;
    const moneyTarget = maxMoney * moneyTargetRatio;

    if (currentSecurity > securityLimit) {
        const securityToRemove = currentSecurity - minSecurity;
        const weakenPerThread = ns.weakenAnalyze(1);
        const wantedThreads = Math.ceil(securityToRemove / weakenPerThread);

        return {
            action: "weaken",
            wantedThreads: Math.max(1, wantedThreads),
            reason: "security-high",
            metrics: {
                minSecurity,
                currentSecurity,
                securityLimit,
                securityAboveMin: currentSecurity - minSecurity,
                maxMoney,
                currentMoney,
                moneyTarget,
                moneyPct: pct(currentMoney, maxMoney)
            }
        };
    }

    if (currentMoney < moneyTarget) {
        const safeMoney = Math.max(currentMoney, 1);
        const growthFactor = Math.max(1, maxMoney / safeMoney);
        const wantedThreads = Math.ceil(ns.growthAnalyze(target, growthFactor));

        return {
            action: "grow",
            wantedThreads: Math.max(1, wantedThreads),
            reason: "money-low",
            metrics: {
                minSecurity,
                currentSecurity,
                securityLimit,
                securityAboveMin: currentSecurity - minSecurity,
                maxMoney,
                currentMoney,
                moneyTarget,
                moneyPct: pct(currentMoney, maxMoney),
                growthFactor
            }
        };
    }

    const hackPerThread = ns.hackAnalyze(target);

    if (hackPerThread <= 0) {
        return {
            action: "weaken",
            wantedThreads: 1,
            reason: "hack-analysis-zero",
            metrics: {
                minSecurity,
                currentSecurity,
                securityLimit,
                securityAboveMin: currentSecurity - minSecurity,
                maxMoney,
                currentMoney,
                moneyTarget,
                moneyPct: pct(currentMoney, maxMoney),
                hackPerThread
            }
        };
    }

    const wantedThreads = Math.floor(hackTargetRatio / hackPerThread);

    return {
        action: "hack",
        wantedThreads: Math.max(1, wantedThreads),
        reason: "ready-to-hack",
        metrics: {
            minSecurity,
            currentSecurity,
            securityLimit,
            securityAboveMin: currentSecurity - minSecurity,
            maxMoney,
            currentMoney,
            moneyTarget,
            moneyPct: pct(currentMoney, maxMoney),
            hackPerThread,
            hackTargetRatio
        }
    };
}

function stopUnwantedWorkers(ns, host, target, workers, desiredAction) {
    for (const [action, script] of Object.entries(workers)) {
        if (action === desiredAction) continue;

        for (const proc of ns.ps(host)) {
            if (
                proc.filename === script &&
                proc.args.length > 0 &&
                String(proc.args[0]) === String(target)
            ) {
                ns.kill(proc.pid);
            }
        }
    }
}

function getRunnableThreads(ns, host, script, wantedThreads, reserveGb, maxUsePct) {
    const scriptRam = ns.getScriptRam(script, host);
    if (scriptRam <= 0) return 0;

    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = Math.max(0, maxRam - usedRam);

    const reserveLimitedRam = Math.max(0, freeRam - reserveGb);
    const pctLimitedRam = Math.max(0, (maxRam * maxUsePct) - usedRam);
    const usableRam = Math.min(reserveLimitedRam, pctLimitedRam);

    const maxThreads = Math.floor(usableRam / scriptRam);

    return Math.max(0, Math.min(wantedThreads, maxThreads));
}

function isWorkerRunningForTarget(ns, host, script, target) {
    return ns.ps(host).some(p =>
        p.filename === script &&
        p.args.length > 0 &&
        String(p.args[0]) === String(target)
    );
}

async function writeProcessState(ns, host, target, decision, workers, processStateFile, reserveGb, maxUsePct) {
    const script = workers[decision.action];

    const running = ns.ps(host)
        .filter(p =>
            p.filename === script &&
            p.args.length > 0 &&
            String(p.args[0]) === String(target)
        )
        .map(p => ({
            pid: p.pid,
            filename: p.filename,
            threads: p.threads,
            args: p.args,
            ram: ns.getScriptRam(p.filename, host) * p.threads
        }));

    const totalThreads = running.reduce((sum, p) => sum + p.threads, 0);
    const totalRam = running.reduce((sum, p) => sum + p.ram, 0);

    const hostMaxRam = ns.getServerMaxRam(host);
    const hostUsedRam = ns.getServerUsedRam(host);

    const state = {
        timestamp: Date.now(),
        host,
        target,
        remote: host !== target,

        cycle: decision.action,
        reason: decision.reason,

        wantedThreads: decision.wantedThreads,
        runnableThreads: decision.runnableThreads ?? null,
        runningThreads: totalThreads,
        runningRam: totalRam,

        startedPid: decision.startedPid ?? null,
        startedThreads: decision.startedThreads ?? null,

        script,
        running,

        hostRam: {
            max: hostMaxRam,
            used: hostUsedRam,
            free: Math.max(0, hostMaxRam - hostUsedRam),
            usedPct: pct(hostUsedRam, hostMaxRam),
            reserveGb,
            maxUsePct
        },

        metrics: decision.metrics
    };

    await ns.write(processStateFile, JSON.stringify(state, null, 2), "w");
}

async function writeIdleState(ns, host, target, processStateFile, reason) {
    const hostMaxRam = ns.getServerMaxRam(host);
    const hostUsedRam = ns.getServerUsedRam(host);

    const state = {
        timestamp: Date.now(),
        host,
        target,
        remote: host !== target,

        cycle: "idle",
        reason,

        wantedThreads: 0,
        runningThreads: 0,
        runningRam: 0,

        script: null,
        running: [],

        hostRam: {
            max: hostMaxRam,
            used: hostUsedRam,
            free: Math.max(0, hostMaxRam - hostUsedRam),
            usedPct: pct(hostUsedRam, hostMaxRam)
        },

        metrics: safeMetrics(ns, target)
    };

    await ns.write(processStateFile, JSON.stringify(state, null, 2), "w");
}

async function writeFatal(ns, file, host, target, message) {
    const text = [
        `timestamp=${Date.now()}`,
        `host=${host}`,
        `target=${target}`,
        `error=${message}`
    ].join("\n");

    await ns.write(file, text, "w");
}

function safeMetrics(ns, target) {
    try {
        const maxMoney = ns.getServerMaxMoney(target);
        const currentMoney = ns.getServerMoneyAvailable(target);
        const minSecurity = ns.getServerMinSecurityLevel(target);
        const currentSecurity = ns.getServerSecurityLevel(target);

        return {
            maxMoney,
            currentMoney,
            moneyPct: pct(currentMoney, maxMoney),
            minSecurity,
            currentSecurity,
            securityAboveMin: currentSecurity - minSecurity
        };
    } catch (err) {
        return {
            error: String(err)
        };
    }
}

function safeGetMaxMoney(ns, target) {
    try {
        return ns.getServerMaxMoney(target);
    } catch {
        return 0;
    }
}

function pct(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return (value / max) * 100;
}

function safeName(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}
