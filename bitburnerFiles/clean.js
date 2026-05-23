/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("clean.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Cleanup");
    ns.clearLog();

    const mode = String(ns.args[0] ?? "strays").toLowerCase().trim();

    const SCRIPT_GROUPS = {
        strays: [
            "upload.js"
        ],

        workers: [
            "weaken.js",
            "grow.js",
            "hack.js"
        ],

        share: [
            "rent-capacity.js",
            "rent-share.js"
        ],

        managed: [
            "infect.js",
            "infect-root.js",
            "infect-deploy.js",
            "infect-start.js",
            "process.js",
            "iteration.js",
            "weaken.js",
            "grow.js",
            "hack.js",
            "rent-share.js"
        ],

        all: [
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
            "upload.js",
            "check-infection.js",
            "logview.js",
            "start-processes.js"
        ]
    };

    const normalisedMode = normaliseMode(mode);

    if (!SCRIPT_GROUPS[normalisedMode]) {
        ns.print(`ERROR: Unknown cleanup mode '${mode}'.`);
        ns.print("");
        ns.print("Valid modes:");
        ns.print("  strays   - kill stray deployment scripts only");
        ns.print("  workers  - kill weaken/grow/hack workers only");
        ns.print("  share    - kill rent-capacity.js and rent-share.js");
        ns.print("  rent     - alias for share");
        ns.print("  managed  - kill managed framework scripts, excluding home rent manager");
        ns.print("  all      - kill all framework scripts");
        return -2;
    }

    const scripts = SCRIPT_GROUPS[normalisedMode];
    const servers = getAllServers(ns, "home");

    let killed = 0;
    const rows = [];

    ns.print("Cleanup plan");
    ns.print("------------");
    ns.print(`Requested mode: ${mode}`);
    ns.print(`Resolved mode:  ${normalisedMode}`);
    ns.print(`Scripts:        ${scripts.join(", ")}`);
    ns.print("");

    for (const server of servers) {
        const includeHome = shouldIncludeHome(normalisedMode, server);
        if (server === "home" && !includeHome) continue;

        for (const script of scripts) {
            const killedHere = killScriptInstances(ns, server, script);

            if (killedHere > 0) {
                killed += killedHere;
                rows.push([server, script, killedHere]);
                await ns.sleep(5);
            }
        }
    }

    if (rows.length > 0) {
        ns.print(table(["Host", "Script", "Killed"], rows));
    } else {
        ns.print("No matching scripts were running.");
    }

    ns.print("");
    ns.print(`Cleanup complete. Mode: ${normalisedMode}. Processes killed: ${killed}`);

    return killed;
}

function normaliseMode(mode) {
    if (mode === "rent" || mode === "rental" || mode === "sharing") return "share";
    if (mode === "worker") return "workers";
    if (mode === "managed-scripts") return "managed";
    if (mode === "everything") return "all";
    if (mode === "default") return "strays";

    return mode;
}

function shouldIncludeHome(mode, server) {
    if (server !== "home") return true;

    // rent-capacity.js is a home-level manager, so share/all must include home.
    if (mode === "share") return true;
    if (mode === "all") return true;

    // managed mode intentionally leaves home managers alone.
    // startup.js restarts rent-capacity.js explicitly after deploy.
    return false;
}

function killScriptInstances(ns, server, script) {
    let killed = 0;

    let processes = [];

    try {
        processes = ns.ps(server).filter(p => p.filename === script);
    } catch (_) {
        processes = [];
    }

    for (const proc of processes) {
        try {
            if (ns.kill(proc.pid)) {
                ns.print(`Killed ${script} PID ${proc.pid} on ${server}`);
                killed++;
            }
        } catch (_) {
            // Fallback for older/weird cases.
        }
    }

    // Fallback if ns.ps/ns.kill(pid) missed anything.
    try {
        if (killed === 0 && ns.scriptRunning(script, server)) {
            ns.scriptKill(script, server);
            ns.print(`Killed ${script} on ${server}`);
            killed++;
        }
    } catch (_) {
        // Ignore scriptKill failures.
    }

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

    return [...seen].sort((a, b) => a.localeCompare(b));
}

function table(headers, rows) {
    const widths = headers.map((h, i) => Math.max(
        String(h).length,
        ...rows.map(r => String(r[i] ?? "").length)
    ));

    const line = values => values
        .map((v, i) => String(v ?? "").padEnd(widths[i]))
        .join(" | ");

    const sep = widths.map(w => "-".repeat(w)).join("-|-");

    return [line(headers), sep, ...rows.map(line)].join("\n");
}

async function openLargeTail(ns, title = null) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();

            try {
                if (title && ns.ui.setTailTitle) {
                    ns.ui.setTailTitle(title);
                }
            } catch (_) {}

            await ns.sleep(50);

            try {
                if (!ns.ui.windowSize || !ns.ui.resizeTail || !ns.ui.moveTail) return;

                const size = ns.ui.windowSize();
                const width = Array.isArray(size) ? size[0] : size.width;
                const height = Array.isArray(size) ? size[1] : size.height;

                if (!width || !height) return;

                ns.ui.moveTail(10, 10);
                ns.ui.resizeTail(Math.max(500, width - 30), Math.max(350, height - 60));
            } catch (_) {}

            return;
        }
    } catch (_) {}

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