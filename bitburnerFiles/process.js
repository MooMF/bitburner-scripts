/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();
    const target = ns.args[0] ?? host;

    const securityBuffer = Number(ns.args[1] ?? 5);
    const moneyTargetRatio = Number(ns.args[2] ?? 0.85);
    const hackTargetRatio = Number(ns.args[3] ?? 0.10);
    const sleepMs = Number(ns.args[4] ?? 5000);

    const processStateFile = "process-state.json";
    const processErrorFile = "process-error.txt";

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
        const threads = getRunnableThreads(ns, host, script, decision.wantedThreads);

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

    await writeProcessState(ns, host, target, decision, workers, processStateFile);
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
                maxMoney,
                currentMoney,
                moneyTarget
            }
        };
    }

    if (currentMoney < moneyTarget) {
        const safeMoney = Math.max(currentMoney, 1);
        const growthFactor = maxMoney / safeMoney;
        const wantedThreads = Math.ceil(ns.growthAnalyze(target, growthFactor));

        return {
            action: "grow",
            wantedThreads: Math.max(1, wantedThreads),
            reason: "money-low",
            metrics: {
                minSecurity,
                currentSecurity,
                securityLimit,
                maxMoney,
                currentMoney,
                moneyTarget,
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
                maxMoney,
                currentMoney,
                moneyTarget,
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
            maxMoney,
            currentMoney,
            moneyTarget,
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

function getRunnableThreads(ns, host, script, wantedThreads) {
    const scriptRam = ns.getScriptRam(script, host);
    if (scriptRam <= 0) return 0;

    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    const maxThreads = Math.floor(freeRam / scriptRam);

    return Math.max(0, Math.min(wantedThreads, maxThreads));
}

function isWorkerRunningForTarget(ns, host, script, target) {
    return ns.ps(host).some(p =>
        p.filename === script &&
        p.args.length > 0 &&
        String(p.args[0]) === String(target)
    );
}

async function writeProcessState(ns, host, target, decision, workers, processStateFile) {
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

    const state = {
        timestamp: Date.now(),
        host,
        target,
        remote: host !== target,

        cycle: decision.action,
        reason: decision.reason,

        wantedThreads: decision.wantedThreads,
        runningThreads: totalThreads,
        runningRam: totalRam,

        startedPid: decision.startedPid ?? null,
        startedThreads: decision.startedThreads ?? null,

        script,
        running,

        metrics: decision.metrics
    };

    await ns.write(processStateFile, JSON.stringify(state, null, 2), "w");
}

async function writeIdleState(ns, host, target, processStateFile, reason) {
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
        return {
            maxMoney: ns.getServerMaxMoney(target),
            currentMoney: ns.getServerMoneyAvailable(target),
            minSecurity: ns.getServerMinSecurityLevel(target),
            currentSecurity: ns.getServerSecurityLevel(target)
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