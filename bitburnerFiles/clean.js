/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("clean.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Cleanup");

    const mode = String(ns.args[0] ?? "strays");

    const strays = [
        "upload.js"
    ];

    const workers = [
        "weaken.js",
        "grow.js",
        "hack.js"
    ];

    const managed = [
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

    const all = [
        ...managed,
        "upload.js",
        "check-infection.js",
        "logview.js"
    ];

    let scripts;

    if (mode === "workers") scripts = workers;
    else if (mode === "managed") scripts = managed;
    else if (mode === "all") scripts = all;
    else scripts = strays;

    let killed = 0;

    for (const server of getAllServers(ns, "home")) {
        if (server === "home") continue;

        for (const script of scripts) {
            if (ns.scriptRunning(script, server)) {
                ns.scriptKill(script, server);
                ns.print(`Killed ${script} on ${server}`);
                killed++;
                await ns.sleep(5);
            }
        }
    }

    ns.print("");
    ns.print(`Cleanup complete. Mode: ${mode}. Scripts killed: ${killed}`);
    return killed;
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();

        if (seen.has(server)) continue;
        seen.add(server);

        for (const next of ns.scan(server)) {
            if (!seen.has(next)) stack.push(next);
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
        // Leave default tail size.
    }
}