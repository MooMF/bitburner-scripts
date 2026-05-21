/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: startup.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Startup");

    /*
        Args:
        0  clean                  true/false. Default true.
        1  buyServers             true/false. Default false.
        2  buySpendRatio          e.g. 0.4. Default 0.4.
        3  assignMinRam           Default 1.
        4  assignPerHost          Default 2.
        5  assignAllowMoneyHosts  true/false. Default true.

        6  capacityMode           faction | share | legacy | off. Default faction.
                                  faction = run faction-control.js auto
                                  share   = run faction-control.js share-only
                                  legacy  = run rent-capacity.js
                                  off     = run neither

        7  reserveGb              RAM reserve per purchased/cloud host. Default 8.
        8  targetUsePct           Target RAM use percentage. Default 0.98.
        9  capacityLoopMs         Rebalance interval. Default 10000.
        10 includeHome            true/false. Default false.
        11 preferredFaction       Optional faction name. Default "".
        12 workType               hacking | field | security. Default hacking.
        13 focus                  true/false. Default false.
    */

    const doClean = parseBool(ns.args[0] ?? true);
    const doBuyServers = parseBool(ns.args[1] ?? false);
    const buySpendRatio = Number(ns.args[2] ?? 0.4);

    const assignMinRam = Number(ns.args[3] ?? 1);
    const assignPerHost = Number(ns.args[4] ?? 2);
    const assignAllowMoneyHosts = parseBool(ns.args[5] ?? true);

    const capacityMode = String(ns.args[6] ?? "faction").toLowerCase();
    const reserveGb = Number(ns.args[7] ?? 8);
    const targetUsePct = Number(ns.args[8] ?? 0.98);
    const capacityLoopMs = Number(ns.args[9] ?? 10000);
    const includeHome = parseBool(ns.args[10] ?? false);
    const preferredFaction = String(ns.args[11] ?? "");
    const workType = String(ns.args[12] ?? "hacking");
    const focus = parseBool(ns.args[13] ?? false);

    ns.clearLog();
    ns.print("Startup sequence beginning.");
    ns.print("");
    ns.print(`Clean:                  ${doClean}`);
    ns.print(`Buy/upgrade servers:    ${doBuyServers}`);
    ns.print(`Buy spend ratio:        ${buySpendRatio}`);
    ns.print(`Assign min RAM:         ${assignMinRam}`);
    ns.print(`Assign per host:        ${assignPerHost}`);
    ns.print(`Allow money hosts:      ${assignAllowMoneyHosts}`);
    ns.print(`Capacity mode:          ${capacityMode}`);
    ns.print("");

    const requiredScripts = [
        "upload.js",
        "assign-targets.js",
        "check-infection.js"
    ];

    if (doClean) requiredScripts.push("clean.js");
    if (doBuyServers) requiredScripts.push("buy-servers.js");

    if (capacityMode === "faction" || capacityMode === "share") {
        requiredScripts.push("faction-control.js");
        requiredScripts.push("rent-share.js");
    } else if (capacityMode === "legacy") {
        requiredScripts.push("rent-capacity.js");
        requiredScripts.push("rent-share.js");
    } else if (capacityMode !== "off" && capacityMode !== "none" && capacityMode !== "false") {
        ns.print(`WARN: Unknown capacityMode '${capacityMode}'. Treating as 'off'.`);
    }

    const missing = requiredScripts.filter(s => !ns.fileExists(s, "home"));
    if (missing.length > 0) {
        ns.tprint(`ERROR: Missing required startup files on home: ${missing.join(", ")}`);
        ns.print(`ERROR: Missing required startup files on home: ${missing.join(", ")}`);
        return -2;
    }

    if (doClean) {
        await runAndWait(ns, "clean.js", ["managed"], "Clean managed scripts");
    }

    // Always prevent duplicate spare-capacity controllers.
    // This avoids running faction-control.js and rent-capacity.js at the same time.
    stopCapacityControllers(ns);

    if (doBuyServers) {
        await runAndWait(ns, "buy-servers.js", [buySpendRatio], "Buy/upgrade purchased servers");
    }

    await runAndWait(ns, "upload.js", [], "Deploy payload");
    await runAndWait(
        ns,
        "assign-targets.js",
        [assignMinRam, assignPerHost, assignAllowMoneyHosts],
        "Assign remote targets"
    );

    clearRestartMarker(ns);

    startCapacityController(
        ns,
        capacityMode,
        reserveGb,
        targetUsePct,
        capacityLoopMs,
        includeHome,
        preferredFaction,
        workType,
        focus
    );

    startDashboard(ns);

    ns.print("");
    ns.print("Startup sequence complete.");
    return 0;
}

function startCapacityController(
    ns,
    capacityMode,
    reserveGb,
    targetUsePct,
    capacityLoopMs,
    includeHome,
    preferredFaction,
    workType,
    focus
) {
    const mode = String(capacityMode).toLowerCase();

    if (mode === "off" || mode === "none" || mode === "false") {
        ns.print("Capacity controller: off.");
        return;
    }

    if (mode === "legacy") {
        const args = [
            reserveGb,
            targetUsePct,
            capacityLoopMs,
            1,
            includeHome,
            "rep"
        ];

        const pid = ns.run("rent-capacity.js", 1, ...args);

        if (pid > 0) {
            ns.print(`Started legacy rent-capacity.js PID ${pid}`);
        } else {
            ns.print("WARN: Failed to start rent-capacity.js.");
        }

        return;
    }

    if (mode === "share") {
        const args = [
            reserveGb,
            targetUsePct,
            capacityLoopMs,
            1,
            includeHome,
            "share",
            preferredFaction,
            workType,
            focus
        ];

        const pid = ns.run("faction-control.js", 1, ...args);

        if (pid > 0) {
            ns.print(`Started faction-control.js in share-only mode PID ${pid}`);
        } else {
            ns.print("WARN: Failed to start faction-control.js share mode.");
        }

        return;
    }

    if (mode === "faction" || mode === "auto") {
        const args = [
            reserveGb,
            targetUsePct,
            capacityLoopMs,
            1,
            includeHome,
            "auto",
            preferredFaction,
            workType,
            focus
        ];

        const pid = ns.run("faction-control.js", 1, ...args);

        if (pid > 0) {
            ns.print(`Started faction-control.js auto mode PID ${pid}`);
        } else {
            ns.print("WARN: Failed to start faction-control.js.");
        }

        return;
    }

    ns.print(`Capacity controller: unknown mode '${capacityMode}', not started.`);
}

function stopCapacityControllers(ns) {
    const scripts = [
        "faction-control.js",
        "rent-capacity.js"
    ];

    for (const script of scripts) {
        try {
            const procs = ns.ps("home").filter(p => p.filename === script);
            for (const proc of procs) {
                ns.kill(proc.pid);
                ns.print(`Stopped old ${script} PID ${proc.pid}`);
            }
        } catch (err) {
            ns.print(`WARN: Could not stop ${script}: ${String(err)}`);
        }
    }
}

function startDashboard(ns) {
    try {
        const existing = ns.ps("home").filter(p => p.filename === "check-infection.js");
        for (const proc of existing) {
            ns.kill(proc.pid);
            ns.print(`Stopped old check-infection.js PID ${proc.pid}`);
        }
    } catch (_) {}

    const pid = ns.run("check-infection.js", 1);

    if (pid > 0) {
        ns.print(`Started check-infection.js PID ${pid}`);
    } else {
        ns.print("WARN: Failed to start check-infection.js.");
    }
}

async function runAndWait(ns, script, args, label) {
    ns.print("");
    ns.print(`${label}: ${script} ${args.map(String).join(" ")}`);

    const pid = ns.run(script, 1, ...args);

    if (pid <= 0) {
        ns.tprint(`ERROR: Failed to start ${script}.`);
        ns.print(`ERROR: Failed to start ${script}.`);
        return false;
    }

    while (isPidRunning(ns, pid)) {
        await ns.sleep(250);
    }

    ns.print(`${label}: complete.`);
    return true;
}

function isPidRunning(ns, pid) {
    try {
        return ns.ps("home").some(p => p.pid === pid);
    } catch (_) {
        return false;
    }
}

function clearRestartMarker(ns) {
    try {
        if (ns.fileExists("restart-required.txt", "home")) {
            ns.rm("restart-required.txt", "home");
            ns.print("Cleared restart-required.txt after redeploy.");
        }
    } catch (err) {
        ns.print(`WARN: Could not clear restart-required.txt: ${String(err)}`);
    }
}

async function openLargeTail(ns, title) {
    try {
        ns.tail();
        await ns.sleep(50);
        ns.resizeTail(1000, 650);
        ns.moveTail(60, 60);
    } catch (_) {}

    try {
        ns.setTitle(title);
    } catch (_) {}
}

function parseBool(value) {
    if (typeof value === "boolean") return value;

    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}