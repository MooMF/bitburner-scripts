/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const host = ns.getHostname();
    const mode = ns.args[0] ?? "request";

    if (host === "home" && mode !== "report") {
        await runHomeRequester(ns);
        return 1;
    }

    await runRemoteReporter(ns);
    return 1;
}

async function runHomeRequester(ns) {
    ns.ui.openTail();
    ns.clearLog();

    const refreshMs = Number(ns.args[0] ?? 1000);
    const timeoutMs = Number(ns.args[1] ?? 60000);

    const C = colours();

    const requestId = String(Date.now());
    const requestFile = "telemreq.txt";
    const telemetryFolder = "/telemetry/";

    // Delete previous drops.
    for (const file of ns.ls("home", telemetryFolder)) {
        ns.rm(file, "home");
    }

    // Remove old local request.
    if (ns.fileExists(requestFile, "home")) {
        ns.rm(requestFile, "home");
    }

    const servers = getAllServers(ns, "home")
        .filter(s => s !== "home")
        .sort((a, b) => a.localeCompare(b));

    const expected = servers
        .filter(s => ns.hasRootAccess(s))
        .filter(s => ns.ps(s).some(p => p.filename === "process.js"));

    const request = {
        type: "telemetry",
        requestId,
        timestamp: Date.now()
    };

    await ns.write(requestFile, JSON.stringify(request, null, 2), "w");

    // Drop request on every rooted visible server.
    for (const server of servers) {
        if (!ns.hasRootAccess(server)) continue;

        try {
            await ns.scp(requestFile, server, "home");
        } catch {
            // Ignore copy failure.
        }
    }

    const start = Date.now();

    while (true) {
        ns.clearLog();

        const reports = ns.ls("home", telemetryFolder)
            .filter(f => f.endsWith(".json"))
            .map(f => readJson(ns, f))
            .filter(r => r && r.requestId === requestId)
            .sort((a, b) => a.server.localeCompare(b.server));

        const received = new Set(reports.map(r => r.server));
        const missing = expected.filter(s => !received.has(s));

        printDashboard(ns, C, {
            requestId,
            start,
            refreshMs,
            timeoutMs,
            expected,
            reports,
            missing
        });

        if (missing.length === 0) {
            ns.print("");
            ns.print(`${C.green}All expected reports received.${C.reset}`);
            return 1;
        }

        if (Date.now() - start >= timeoutMs) {
            ns.print("");
            ns.print(`${C.red}Timed out waiting for reports.${C.reset}`);
            return -1;
        }

        await ns.sleep(refreshMs);
    }
}

async function runRemoteReporter(ns) {
    const host = ns.getHostname();
    const requestId = ns.args[1] ?? String(Date.now());

    if (host === "home") return 0;

    const reportFile = `/telemetry/${host}.json`;

    const processes = ns.ps(host).map(p => ({
        pid: p.pid,
        filename: p.filename,
        threads: p.threads,
        args: p.args,
        ram: ns.getScriptRam(p.filename, host) * p.threads
    }));

    const processState = readJsonFile(ns, "process-state.json", host);

    const activeWorkers = processes
        .filter(p =>
            p.filename === "weaken.js" ||
            p.filename === "grow.js" ||
            p.filename === "hack.js"
        )
        .map(p => ({
            filename: p.filename,
            threads: p.threads,
            ram: p.ram,
            args: p.args
        }));

    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = maxRam - usedRam;

    const maxMoney = ns.getServerMaxMoney(host);
    const money = ns.getServerMoneyAvailable(host);

    const security = ns.getServerSecurityLevel(host);
    const minSecurity = ns.getServerMinSecurityLevel(host);

    const report = {
        requestId,
        server: host,
        timestamp: Date.now(),
        ok: true,

        root: ns.hasRootAccess(host),

        process: {
            running: processes.some(p => p.filename === "process.js"),
            state: processState
        },

        ram: {
            max: maxRam,
            used: usedRam,
            free: freeRam,
            usedPercent: maxRam > 0 ? usedRam / maxRam : 0
        },

        money: {
            available: money,
            max: maxMoney,
            percent: maxMoney > 0 ? money / maxMoney : 0
        },

        security: {
            current: security,
            min: minSecurity,
            delta: security - minSecurity
        },

        processes,
        activeWorkers
    };

    await ns.write(reportFile, JSON.stringify(report, null, 2), "w");
    await ns.scp(reportFile, "home", host);

    return 1;
}

function printDashboard(ns, C, state) {
    const { requestId, start, refreshMs, timeoutMs, expected, reports, missing } = state;
    const elapsed = Date.now() - start;

    ns.print(`${C.bold}${C.cyan}Telemetry request ${requestId}${C.reset}`);
    ns.print(`${C.grey}Refresh: ${refreshMs}ms | Timeout: ${timeoutMs}ms | Elapsed: ${elapsed}ms${C.reset}`);
    ns.print(`${C.grey}Expected: ${expected.length} | Received: ${reports.length} | Missing: ${missing.length}${C.reset}`);
    ns.print("");

    if (reports.length === 0) {
        ns.print(`${C.yellow}No reports received yet.${C.reset}`);
    } else {
        ns.print(table([
            "Server",
            "Age",
            "Cycle",
            "RAM",
            "Free",
            "Money",
            "Money %",
            "Security",
            "Status"
        ], reports.map(r => reportToRow(ns, C, r))));
    }

    ns.print("");
    ns.print(`${C.bold}${C.cyan}Waiting for:${C.reset}`);

    if (missing.length === 0) {
        ns.print(`${C.green}- none${C.reset}`);
    } else {
        ns.print(missing.map(s => `${C.yellow}${s}${C.reset}`).join(", "));
    }
}

function reportToRow(ns, C, r) {
    if (!r.ok) {
        return [
            colour(C, "red", r.server ?? "?"),
            "-",
            "-",
            "-",
            "-",
            "-",
            "-",
            "-",
            colour(C, "red", r.error ?? "ERROR")
        ];
    }

    const state = r.process?.state;

    const cycle = state?.cycle ?? "-";
    const runningThreads = state?.runningThreads ?? 0;
    const wantedThreads = state?.wantedThreads ?? 0;

    const cycleText = cycle === "-"
        ? "-"
        : `${cycle}:${runningThreads}/${wantedThreads}`;

    const ageMs = Date.now() - r.timestamp;
    const moneyPct = r.money.percent * 100;
    const securityDelta = r.security.delta;
    const freeRam = r.ram.free;

    return [
        colour(C, "cyan", r.server),
        age(ageMs),
        colourCycle(C, cycleText, cycle),
        `${r.ram.used.toFixed(1)}/${r.ram.max.toFixed(1)}GB`,
        colourByNumber(C, freeRam, 4, 1, `${freeRam.toFixed(1)}GB`),
        money(ns, r.money.available),
        colourByNumber(C, moneyPct, 75, 25, `${moneyPct.toFixed(1)}%`),
        colourByInverse(C, securityDelta, 5, 15, `${r.security.current.toFixed(2)} / ${r.security.min.toFixed(2)}`),
        colour(C, "green", "OK")
    ];
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();

        if (seen.has(server)) continue;
        seen.add(server);

        for (const neighbour of ns.scan(server)) {
            if (!seen.has(neighbour)) {
                stack.push(neighbour);
            }
        }
    }

    return [...seen];
}

function readJson(ns, file) {
    try {
        return JSON.parse(ns.read(file));
    } catch {
        return null;
    }
}

function readJsonFile(ns, file, server) {
    try {
        if (!ns.fileExists(file, server)) return null;
        return JSON.parse(ns.read(file));
    } catch {
        return null;
    }
}

function table(headers, rows) {
    const all = [headers, ...rows];

    const widths = headers.map((_, i) =>
        Math.max(...all.map(row => stripAnsi(String(row[i] ?? "")).length))
    );

    const fmt = row =>
        row.map((cell, i) => padAnsi(String(cell ?? ""), widths[i])).join(" | ");

    return [
        fmt(headers),
        widths.map(w => "-".repeat(w)).join("-|-"),
        ...rows.map(fmt)
    ].join("\n");
}

function padAnsi(value, width) {
    const visible = stripAnsi(value).length;
    return value + " ".repeat(Math.max(0, width - visible));
}

function stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function colours() {
    return {
        reset: "\x1b[0m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        cyan: "\x1b[36m",
        magenta: "\x1b[35m",
        grey: "\x1b[90m",
        bold: "\x1b[1m"
    };
}

function colour(C, name, text) {
    return `${C[name]}${text}${C.reset}`;
}

function colourCycle(C, text, cycle) {
    if (cycle === "weaken") return colour(C, "cyan", text);
    if (cycle === "grow") return colour(C, "green", text);
    if (cycle === "hack") return colour(C, "magenta", text);
    if (cycle === "telemetry") return colour(C, "yellow", text);
    return colour(C, "grey", text);
}

function colourByNumber(C, value, good, warning, text) {
    if (value >= good) return colour(C, "green", text);
    if (value >= warning) return colour(C, "yellow", text);
    return colour(C, "red", text);
}

function colourByInverse(C, value, goodLimit, warningLimit, text) {
    if (value <= goodLimit) return colour(C, "green", text);
    if (value <= warningLimit) return colour(C, "yellow", text);
    return colour(C, "red", text);
}

function money(ns, value) {
    if (!value || value <= 0) return "$0";
    return "$" + ns.format.number(value, 2);
}

function age(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m`;
}