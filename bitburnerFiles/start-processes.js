/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("start-processes.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Start Processes");
    ns.clearLog();

    const processScript = "process.js";
    const waitMs = Number(ns.args[0] ?? 1000);

    const servers = getAllServers(ns, "home")
        .filter(s => s !== "home")
        .sort((a, b) => a.localeCompare(b));

    let attempted = 0;
    let started = 0;
    let stillRunning = 0;
    let noMoney = 0;
    let noRoot = 0;
    let noFile = 0;
    let noRam = 0;
    let execFailed = 0;
    let died = 0;

    ns.print("Starting process.js on money servers...");
    ns.print("");

    for (const server of servers) {
        await ns.sleep(20);

        if (!ns.hasRootAccess(server)) {
            noRoot++;
            ns.print(`${server}: SKIP no root`);
            continue;
        }

        if (ns.getServerMaxMoney(server) <= 0) {
            noMoney++;
            continue;
        }

        attempted++;

        if (!ns.fileExists(processScript, server)) {
            noFile++;
            ns.print(`${server}: FAIL missing process.js`);
            continue;
        }

        if (ns.ps(server).some(p => p.filename === processScript)) {
            stillRunning++;
            ns.print(`${server}: already running`);
            continue;
        }

        const ram = ns.getScriptRam(processScript, server);
        const free = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);

        if (ram <= 0) {
            execFailed++;
            ns.print(`${server}: FAIL process.js RAM reported as ${ram}`);
            continue;
        }

        if (free < ram) {
            noRam++;
            ns.print(`${server}: FAIL not enough RAM. Free ${free.toFixed(2)}GB, need ${ram.toFixed(2)}GB`);
            continue;
        }

        const pid = ns.exec(processScript, server, 1, server);

        if (pid === 0) {
            execFailed++;
            ns.print(`${server}: FAIL ns.exec returned 0`);
            continue;
        }

        started++;
        ns.print(`${server}: started process.js PID ${pid}`);
    }

    ns.print("");
    ns.print(`Waiting ${waitMs}ms to see whether process.js survives...`);
    await ns.sleep(waitMs);
    ns.print("");

    for (const server of servers) {
        if (ns.getServerMaxMoney(server) <= 0) continue;
        if (!ns.hasRootAccess(server)) continue;
        if (!ns.fileExists(processScript, server)) continue;

        const running = ns.ps(server).some(p => p.filename === processScript);

        if (running) {
            stillRunning++;
        } else {
            const ram = ns.getScriptRam(processScript, server);
            const free = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);

            if (free >= ram) {
                died++;
                ns.print(`${server}: process.js is NOT running after start attempt; likely crashed or exited.`);
            }
        }
    }

    ns.print("");
    ns.print("Summary");
    ns.print("-------");
    ns.print(`Money servers attempted: ${attempted}`);
    ns.print(`Started this run:        ${started}`);
    ns.print(`Still/already running:   ${stillRunning}`);
    ns.print(`No root:                 ${noRoot}`);
    ns.print(`No money:                ${noMoney}`);
    ns.print(`Missing process.js:      ${noFile}`);
    ns.print(`No RAM:                  ${noRam}`);
    ns.print(`Exec failed:             ${execFailed}`);
    ns.print(`Started then died:       ${died}`);

    ns.print("");
    ns.print("Next:");
    ns.print("run check-infection.js");

    return 1;
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
        // Leave default size.
    }
}