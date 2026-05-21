/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("rent-capacity.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Rent Spare Capacity");
    ns.clearLog();

    const workerScript = "rent-share.js";

    const reserveGb = Number(ns.args[0] ?? 8);
    const targetUsePct = Number(ns.args[1] ?? 0.98);
    const loopMs = Number(ns.args[2] ?? 5000);
    const minThreads = Number(ns.args[3] ?? 1);
    const includeHome = parseBool(ns.args[4] ?? false);
    const mode = String(ns.args[5] ?? "rep").toLowerCase();

    if (!ns.fileExists(workerScript, "home")) {
        ns.print(`ERROR: Missing ${workerScript} on home.`);
        return -2;
    }

    if (mode !== "rep" && mode !== "reputation") {
        ns.print(`WARN: mode '${mode}' is not supported by ns.share(). Falling back to reputation sharing.`);
    }

    while (true) {
        const servers = getAllServers(ns, "home");
        const hosts = getRentalHosts(ns, servers, includeHome);

        let launchedHosts = 0;
        let launchedThreads = 0;
        let totalRam = 0;
        let usedRam = 0;
        let freeRam = 0;
        const rows = [];

        for (const host of hosts) {
            const maxRam = ns.getServerMaxRam(host);
            const used = ns.getServerUsedRam(host);
            const free = Math.max(0, maxRam - used);

            totalRam += maxRam;
            usedRam += used;
            freeRam += free;

            if (!ns.fileExists(workerScript, host)) {
                await ns.scp(workerScript, host, "home");
                await ns.sleep(5);
            }

            const workerRam = ns.getScriptRam(workerScript, host);
            if (workerRam <= 0) {
                rows.push([host, "skip", "script RAM unavailable", pct(used, maxRam), "0GB"]);
                continue;
            }

            const freeAfterReserve = Math.max(0, free - reserveGb);
            const targetHeadroom = Math.max(0, (maxRam * targetUsePct) - used);
            const allocatableRam = Math.min(freeAfterReserve, targetHeadroom);
            const threads = Math.floor(allocatableRam / workerRam);

            if (threads >= minThreads) {
                const nonce = `${Date.now()}-${host}-${Math.random()}`;
                const pid = ns.exec(workerScript, host, threads, nonce);

                if (pid > 0) {
                    launchedHosts++;
                    launchedThreads += threads;
                    rows.push([
                        host,
                        "share",
                        `${threads}t PID ${pid}`,
                        pct(used + threads * workerRam, maxRam),
                        formatRam(ns, free)
                    ]);
                } else {
                    rows.push([
                        host,
                        "fail",
                        `${threads}t exec returned 0`,
                        pct(used, maxRam),
                        formatRam(ns, free)
                    ]);
                }
            } else {
                rows.push([
                    host,
                    "idle",
                    `free ${formatRam(ns, free)}; reserve/ceiling blocks launch`,
                    pct(used, maxRam),
                    formatRam(ns, free)
                ]);
            }

            await ns.sleep(1);
        }

        ns.clearLog();
        ns.print("Spare-capacity rental running.");
        ns.print(`Hosts: ${hosts.length}`);
        ns.print(`Fleet RAM: ${formatRam(ns, usedRam)} / ${formatRam(ns, totalRam)} used (${pct(usedRam, totalRam)})`);
        ns.print(`Fleet free: ${formatRam(ns, freeRam)}`);
        ns.print(`Launched this pass: ${launchedThreads} share threads on ${launchedHosts} hosts`);
        ns.print(`Reserve: ${reserveGb}GB/host; target use ${(targetUsePct * 100).toFixed(1)}%`);
        ns.print("");
        ns.print(table(["Host", "Action", "Detail", "Projected use", "Free before"], rows.slice(0, 30)));

        if (rows.length > 30) {
            ns.print(`... ${rows.length - 30} more hosts omitted from display.`);
        }

        await ns.sleep(loopMs);
    }
}

async function openLargeTail(ns, title) {
    try {
        ns.tail();
        await ns.sleep(50);
        ns.resizeTail(1100, 700);
        ns.moveTail(80, 80);
    } catch (_) {}

    try {
        ns.setTitle(title);
    } catch (_) {}
}

function getRentalHosts(ns, servers, includeHome) {
    const hosts = [];

    for (const server of servers) {
        if (server === "home" && !includeHome) continue;
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerMaxRam(server) <= 0) continue;
        if (!isPlayerOwnedServer(ns, server, includeHome)) continue;

        hosts.push(server);
    }

    hosts.sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a) || a.localeCompare(b));
    return hosts;
}

function isPlayerOwnedServer(ns, server, includeHome) {
    if (server === "home") return includeHome;

    try {
        const info = ns.getServer(server);
        if (info && info.purchasedByPlayer) return true;
    } catch (_) {}

    if (server.startsWith("pserv-")) return true;
    if (server.startsWith("MooMF")) return true;

    return false;
}

function getAllServers(ns, start = "home") {
    const seen = new Set([start]);
    const stack = [start];

    while (stack.length > 0) {
        const host = stack.pop();

        for (const next of ns.scan(host)) {
            if (seen.has(next)) continue;
            seen.add(next);
            stack.push(next);
        }
    }

    return [...seen];
}

function parseBool(value) {
    if (typeof value === "boolean") return value;

    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function pct(value, total) {
    if (total <= 0) return "0.00%";
    return `${((value / total) * 100).toFixed(2)}%`;
}

function formatRam(ns, value) {
    if (ns.format && typeof ns.format.ram === "function") {
        return ns.format.ram(value);
    }

    // Fallback for older versions.
    if (typeof ns.formatRam === "function") {
        return ns.formatRam(value);
    }

    return `${value.toFixed(1)}GB`;
}

function table(headers, rows) {
    const widths = headers.map((h, i) => Math.max(
        String(h).length,
        ...rows.map(r => String(r[i] ?? "").length)
    ));

    const line = values => values.map((v, i) => String(v ?? "").padEnd(widths[i])).join(" | ");
    const sep = widths.map(w => "-".repeat(w)).join("-|-");

    return [line(headers), sep, ...rows.map(line)].join("\n");
}