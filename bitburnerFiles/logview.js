/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    await openLargeTail(ns, "Log View");
    ns.clearLog();

    const server = ns.args[0] ?? ns.getHostname();
    const refreshMs = Number(ns.args[1] ?? 3000);
    const maxLinesPerScript = Number(ns.args[2] ?? 40);

    const C = colours();

    if (!ns.serverExists(server)) {
        ns.print(`${C.red}Server does not exist: ${server}${C.reset}`);
        return -1;
    }

    while (true) {
        ns.clearLog();

        const processes = ns.ps(server);

        ns.print(`${C.bold}${C.cyan}Aggregated logs for ${server}${C.reset}`);
        ns.print(`${C.grey}Refresh: ${refreshMs}ms | Max lines/script: ${maxLinesPerScript}${C.reset}`);
        ns.print(`${C.grey}Running scripts: ${processes.length}${C.reset}`);
        ns.print("");

        if (processes.length === 0) {
            ns.print(`${C.yellow}No running scripts on ${server}.${C.reset}`);
            await ns.sleep(refreshMs);
            continue;
        }

        for (const proc of processes) {
            const script = proc.filename;
            const args = proc.args ?? [];
            const argText = args.length > 0 ? args.join(" ") : "";

            ns.print(`${C.bold}${C.blue}PID ${proc.pid} | ${script} ${argText}${C.reset}`);

            let logs = [];

            try {
                logs = ns.getScriptLogs(script, server, ...args);
            } catch (err) {
                ns.print(`${C.red}Could not read logs for ${script}: ${err}${C.reset}`);
                ns.print("");
                continue;
            }

            if (logs.length === 0) {
                ns.print(`${C.grey}(no log output)${C.reset}`);
                ns.print("");
                continue;
            }

            for (const line of logs.slice(-maxLinesPerScript)) {
                ns.print(colourLine(C, line));
            }

            ns.print("");
        }

        await ns.sleep(refreshMs);
    }
}

function colourLine(C, line) {
    const text = String(line);

    if (
        text.includes("ERROR") ||
        text.includes("Error") ||
        text.includes("failed") ||
        text.includes("Failed") ||
        text.includes("FAIL") ||
        text.includes("No root access") ||
        text.includes("not enough RAM") ||
        text.includes("Not enough RAM")
    ) {
        return `${C.red}${text}${C.reset}`;
    }

    if (
        text.includes("WARN") ||
        text.includes("Skipping") ||
        text.includes("skipping") ||
        text.includes("Cannot") ||
        text.includes("cannot")
    ) {
        return `${C.yellow}${text}${C.reset}`;
    }

    if (
        text.includes("SUCCESS") ||
        text.includes("Started") ||
        text.includes("Copied") ||
        text.includes("Nuked") ||
        text.includes("Root access") ||
        text.includes("Downloaded")
    ) {
        return `${C.green}${text}${C.reset}`;
    }

    if (
        text.includes("Decision") ||
        text.includes("weaken") ||
        text.includes("Weaken") ||
        text.includes("grow") ||
        text.includes("Grow") ||
        text.includes("hack") ||
        text.includes("Hack")
    ) {
        return `${C.cyan}${text}${C.reset}`;
    }

    if (
        text.includes("RAM") ||
        text.includes("Threads") ||
        text.includes("Security") ||
        text.includes("Money")
    ) {
        return `${C.magenta}${text}${C.reset}`;
    }

    return `${C.grey}${text}${C.reset}`;
}

function colours() {
    return {
        reset: "\x1b[0m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        grey: "\x1b[90m",
        bold: "\x1b[1m"
    };
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