/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();

    if (host !== "home") {
        ns.print("upload.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Upload / Deploy");
    ns.clearLog();

    const runWorm = parseBool(ns.args[0] ?? false);

    const scripts = [
        "infect.js",
        "infect-root.js",
        "infect-deploy.js",
        "infect-start.js",
        "process.js",
        "iteration.js",
        "weaken.js",
        "grow.js",
        "hack.js",
        "rent-capacity.js",
        "rent-share.js",
    ];

    for (const script of scripts) {
        if (!ns.fileExists(script, "home")) {
            ns.print(`ERROR: Missing required script on home: ${script}`);
            return -2;
        }
    }

    const servers = getAllServers(ns, "home")
        .filter(s => s !== "home")
        .sort((a, b) => a.localeCompare(b));

    let rooted = 0;
    let deployed = 0;
    let processStarted = 0;
    let processFailed = 0;
    let iterationStarted = 0;
    let wormStarted = 0;
    let skippedNoRoot = 0;

    ns.print("Deployment started.");
    ns.print(`Servers discovered: ${servers.length}`);
    ns.print(`Run worm: ${runWorm}`);
    ns.print("");

    for (const server of servers) {
        await ns.sleep(25);

        const hasRoot = await tryRoot(ns, server);

        if (!hasRoot) {
            skippedNoRoot++;
            ns.print(`SKIP ${server}: no root.`);
            continue;
        }

        rooted++;

        ns.print(`Deploying to ${server}`);

        stopManagedScripts(ns, server, scripts);
        removeManagedFiles(ns, server, scripts);

        try {
            await ns.scp(scripts, server, "home");
            deployed++;
        } catch (err) {
            ns.print(`  ERROR: Failed to copy payload: ${err}`);
            continue;
        }

        if (ns.getServerMaxMoney(server) > 0) {
            const result = startWithReason(ns, server, "process.js", 1, server);

            if (result.pid > 0) {
                processStarted++;
                ns.print(`  OK process.js PID ${result.pid}`);
            } else {
                processFailed++;
                ns.print(`  FAIL process.js: ${result.reason}`);
            }
        } else {
            ns.print("  skip process.js: no money on server.");
        }

        const iterResult = startWithReason(ns, server, "iteration.js", 1);

        if (iterResult.pid > 0) {
            iterationStarted++;
            ns.print(`  OK iteration.js PID ${iterResult.pid}`);
        }

        if (runWorm) {
            const wormResult = startWithReason(ns, server, "infect.js", 1, "home");

            if (wormResult.pid > 0) {
                wormStarted++;
                ns.print(`  OK infect.js PID ${wormResult.pid}`);
            } else {
                ns.print(`  skip infect.js: ${wormResult.reason}`);
            }
        }
    }

    ns.print("");
    ns.print("Deployment complete.");
    ns.print(`Rooted / accessible: ${rooted}/${servers.length}`);
    ns.print(`Payload deployed:    ${deployed}/${servers.length}`);
    ns.print(`process.js started:  ${processStarted}`);
    ns.print(`process.js failed:   ${processFailed}`);
    ns.print(`iteration.js started:${iterationStarted}`);
    ns.print(`infect.js started:   ${wormStarted}`);
    ns.print(`No root skipped:     ${skippedNoRoot}`);

    ns.print("");
    ns.print("Next command:");
    ns.print("run check-infection.js");

    return 1;
}

async function tryRoot(ns, server) {
    if (ns.hasRootAccess(server)) return true;

    const portPrograms = [
        { name: "BruteSSH.exe", run: target => ns.brutessh(target) },
        { name: "FTPCrack.exe", run: target => ns.ftpcrack(target) },
        { name: "relaySMTP.exe", run: target => ns.relaysmtp(target) },
        { name: "HTTPWorm.exe", run: target => ns.httpworm(target) },
        { name: "SQLInject.exe", run: target => ns.sqlinject(target) }
    ];

    let opened = 0;

    for (const p of portPrograms) {
        if (!ns.fileExists(p.name, "home")) continue;

        try {
            p.run(server);
            opened++;
        } catch {
            // Ignore failed opener.
        }
    }

    const required = ns.getServerNumPortsRequired(server);

    if (opened >= required) {
        try {
            ns.nuke(server);
        } catch {
            return false;
        }
    }

    return ns.hasRootAccess(server);
}

function stopManagedScripts(ns, server, scripts) {
    for (const script of scripts) {
        if (ns.scriptRunning(script, server)) {
            ns.scriptKill(script, server);
        }
    }
}

function removeManagedFiles(ns, server, scripts) {
    for (const script of scripts) {
        if (ns.fileExists(script, server)) {
            ns.rm(script, server);
        }
    }
}

function startWithReason(ns, server, script, threads, ...args) {
    if (!ns.serverExists(server)) {
        return {
            pid: 0,
            reason: "server does not exist"
        };
    }

    if (!ns.hasRootAccess(server)) {
        return {
            pid: 0,
            reason: "no root access"
        };
    }

    if (!ns.fileExists(script, server)) {
        return {
            pid: 0,
            reason: `${script} missing on ${server}`
        };
    }

    const scriptRam = ns.getScriptRam(script, server);

    if (scriptRam <= 0) {
        return {
            pid: 0,
            reason: `${script} RAM is ${scriptRam}`
        };
    }

    const maxRam = ns.getServerMaxRam(server);
    const usedRam = ns.getServerUsedRam(server);
    const freeRam = maxRam - usedRam;
    const requiredRam = scriptRam * threads;

    if (freeRam < requiredRam) {
        return {
            pid: 0,
            reason: `not enough RAM; free ${freeRam.toFixed(2)}GB, need ${requiredRam.toFixed(2)}GB`
        };
    }

    const alreadyRunning = ns.ps(server)
        .some(p => p.filename === script && sameArgs(p.args, args));

    if (alreadyRunning) {
        return {
            pid: 0,
            reason: "already running with same args"
        };
    }

    const pid = ns.exec(script, server, threads, ...args);

    if (pid === 0) {
        return {
            pid: 0,
            reason: `ns.exec returned 0; free ${freeRam.toFixed(2)}GB, script RAM ${scriptRam.toFixed(2)}GB`
        };
    }

    return {
        pid,
        reason: "started"
    };
}

function sameArgs(a, b) {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
        if (String(a[i]) !== String(b[i])) return false;
    }

    return true;
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();

        if (seen.has(server)) continue;
        seen.add(server);

        for (const next of ns.scan(server)) {
            if (!seen.has(next)) {
                stack.push(next);
            }
        }
    }

    return [...seen];
}

function parseBool(value) {
    if (value === true) return true;
    if (value === false) return false;

    const text = String(value).toLowerCase();

    return text === "true" ||
        text === "1" ||
        text === "yes" ||
        text === "y";
}

async function openLargeTail(ns, title = null) {
    ns.ui.openTail();

    try {
        if (title && ns.ui.setTailTitle) {
            ns.ui.setTailTitle(title);
        }
    } catch {
        // Ignore title failures.
    }

    await ns.sleep(50);

    try {
        if (!ns.ui.windowSize || !ns.ui.resizeTail || !ns.ui.moveTail) return;

        const size = ns.ui.windowSize();
        const width = Array.isArray(size) ? size[0] : size.width;
        const height = Array.isArray(size) ? size[1] : size.height;

        if (!width || !height) return;

        ns.ui.moveTail(10, 10);
        ns.ui.resizeTail(Math.max(500, width - 30), Math.max(350, height - 60));
    } catch {
        // Leave default tail size.
    }
}