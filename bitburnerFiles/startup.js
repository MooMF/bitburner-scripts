/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("startup.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Startup");
    ns.clearLog();

    /*
        Existing arguments:

        run startup.js [clean] [buyServers] [buySpendRatio] [assignMinRam] [assignPerHost] [assignAllowMoneyHosts]

        New optional arguments:

        [startRent] [rentMaxSharePct] [rentReserveGb] [rentIncludeHome] [rentLoopMs]

        Recommended normal run:

        run startup.js true false

        This now also runs: clean.js share
        when clean=true, so the share/rent layer is reset cleanly.

        With explicit rent settings and inital buy:

        run startup.js true true 0.5 1 2 true true 80 0.98 5000 1 false
    */

    const doClean = parseBool(ns.args[0] ?? true);
    const doBuyServers = parseBool(ns.args[1] ?? false);

    const buySpendRatio = Number(ns.args[2] ?? 0.75);

    const assignMinRam = Number(ns.args[3] ?? 0.5);
    const assignPerHost = Number(ns.args[4] ?? 2);
    const assignAllowMoneyHosts = parseBool(ns.args[5] ?? true);

    // New rent-capacity layer.
    const startRent = parseBool(ns.args[6] ?? true);

    // rent-capacity.js argument order:
    // rent-capacity.js <maxSharePct> <reserveGb> <includeHome> <loopMs>
    const rentMaxSharePct = Number(ns.args[7] ?? 60);
    const rentReserveGb = Number(ns.args[8] ?? 0.5);
    const rentIncludeHome = parseBool(ns.args[9] ?? false);
    const rentLoopMs = Number(ns.args[10] ?? 10000);

    const restartMarker = "restart-required.txt";

    const requiredScripts = [
        "upload.js",
        "assign-targets.js",
        "check-infection.js"
    ];

    if (doClean) requiredScripts.push("clean.js");
    if (doBuyServers) requiredScripts.push("buy-servers.js");

    if (startRent) {
        requiredScripts.push("rent-capacity.js");
        requiredScripts.push("rent-share.js");
    }

    for (const script of requiredScripts) {
        if (!ns.fileExists(script, "home")) {
            ns.print(`ERROR: Missing required script on home: ${script}`);
            return -2;
        }
    }

    ns.print("Startup plan");
    ns.print("------------");
    ns.print(`Clean managed scripts:        ${doClean}`);
    ns.print(`Buy / upgrade servers:        ${doBuyServers}`);
    ns.print(`Buy spend ratio:              ${(buySpendRatio * 100).toFixed(1)}%`);
    ns.print(`Assign min worker RAM:        ${assignMinRam}GB`);
    ns.print(`Assign max remote targets:    ${assignPerHost}`);
    ns.print(`Assign allow money hosts:     ${assignAllowMoneyHosts}`);
    ns.print(`Start rent capacity:          ${startRent}`);
    ns.print(`Rent max share pct:           ${rentMaxSharePct}%`);
    ns.print(`Rent reserve per host:        ${rentReserveGb}GB`);
    ns.print(`Rent include home:            ${rentIncludeHome}`);
    ns.print(`Rent loop:                    ${rentLoopMs}ms`);
    ns.print(`Restart marker exists:        ${ns.fileExists(restartMarker, "home")}`);
    ns.print("");

    if (doClean) {
        await runAndWait(ns, "clean.js", "managed");
        await ns.sleep(500);

        // rent-capacity.js is a home-level manager and rent-share.js may run across the fleet.
        // This requires clean.js with explicit share/rent support.
        await runAndWait(ns, "clean.js", "share");
        await ns.sleep(500);
    }

    if (doBuyServers) {
        await runAndWait(ns, "buy-servers.js", buySpendRatio);
        await ns.sleep(500);
    }

    await runAndWait(ns, "upload.js");
    await ns.sleep(1000);

    await runAndWait(
        ns,
        "assign-targets.js",
        assignMinRam,
        assignPerHost,
        assignAllowMoneyHosts
    );

    await ns.sleep(1000);

    if (startRent) {
        restartRentCapacity(ns, {
            maxSharePct: rentMaxSharePct,
            reserveGb: rentReserveGb,
            includeHome: rentIncludeHome,
            loopMs: rentLoopMs
        });

        await ns.sleep(500);
    }

    // If startup has reached this point, deployment has been refreshed,
    // so the restart marker is no longer relevant.
    if (ns.fileExists(restartMarker, "home")) {
        ns.rm(restartMarker, "home");
        ns.print(`Cleared ${restartMarker}`);
    }

    const checkPid = ns.run("check-infection.js", 1);

    if (checkPid === 0) {
        ns.print("WARNING: Could not start check-infection.js.");
    } else {
        ns.print(`Started check-infection.js PID ${checkPid}`);
    }

    ns.print("");
    ns.print("Startup complete.");

    return 1;
}

function restartRentCapacity(ns, options) {
    const script = "rent-capacity.js";

    ns.print(`Preparing ${script}`);

    const running = ns.ps("home").filter(p => p.filename === script);

    for (const proc of running) {
        ns.print(`Killing old ${script} PID ${proc.pid}`);
        ns.kill(proc.pid);
    }

    const pid = ns.run(
        script,
        1,
        options.maxSharePct,
        options.reserveGb,
        options.includeHome,
        options.loopMs
    );

    if (pid === 0) {
        ns.print(`WARNING: Could not start ${script}.`);
        return 0;
    }

    ns.print(
        `Started ${script} PID ${pid} ` +
        `[maxShare=${options.maxSharePct}%, reserve=${options.reserveGb}GB, ` +
        `includeHome=${options.includeHome}, loop=${options.loopMs}ms]`
    );

    return pid;
}

async function runAndWait(ns, script, ...args) {
    ns.print(`Starting ${script} ${args.join(" ")}`);

    if (!ns.fileExists(script, "home")) {
        ns.print(`FAILED: ${script} missing on home.`);
        return 0;
    }

    const pid = ns.run(script, 1, ...args);

    if (pid === 0) {
        ns.print(`FAILED to start ${script}`);
        return 0;
    }

    while (ns.isRunning(pid, "home")) {
        await ns.sleep(500);
    }

    ns.print(`Finished ${script}`);
    return pid;
}

function parseBool(value) {
    if (value === true) return true;
    if (value === false) return false;

    const text = String(value).toLowerCase().trim();

    return text === "true" ||
        text === "1" ||
        text === "yes" ||
        text === "y";
}

async function openLargeTail(ns, title = null) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();

            try {
                if (title && ns.ui.setTailTitle) {
                    ns.ui.setTailTitle(title);
                }
            } catch (_) { }

            await ns.sleep(50);

            try {
                if (!ns.ui.windowSize || !ns.ui.resizeTail || !ns.ui.moveTail) return;

                const size = ns.ui.windowSize();
                const width = Array.isArray(size) ? size[0] : size.width;
                const height = Array.isArray(size) ? size[1] : size.height;

                if (!width || !height) return;

                ns.ui.moveTail(10, 10);
                ns.ui.resizeTail(Math.max(400, width - 30), Math.max(150, height - 60));
            } catch (_) { }

            return;
        }
    } catch (_) { }

    try {
        ns.tail();
        await ns.sleep(50);
        ns.resizeTail(1100, 700);
        ns.moveTail(10, 10);

        if (title && typeof ns.setTitle === "function") {
            ns.setTitle(title);
        }
    } catch (_) {
        // Leave default tail behaviour.
    }
}
