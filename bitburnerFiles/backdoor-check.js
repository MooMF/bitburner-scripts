/**
 * backdoor-check.js
 *
 * Scans the network for servers that can be backdoored.
 *
 * Behaviour:
 *   - Always scans fresh each run.
 *   - Finds rooted servers where hacking level is sufficient.
 *   - Skips servers already backdoored.
 *   - Detects AutoLink.exe and prints AutoLink-friendly targets/routes.
 *   - Prints manual route commands when Singularity is unavailable.
 *   - If Singularity is available, can automatically connect and install backdoors.
 *
 * Usage:
 *   run backdoor-check.js
 *   run backdoor-check.js status
 *   run backdoor-check.js routes
 *   run backdoor-check.js auto
 *   run backdoor-check.js auto --world
 *
 * Modes:
 *   status/routes/default  Report eligible targets and manual commands.
 *   auto                   Attempt automatic backdoors using Singularity API.
 *
 * Flags:
 *   --world                Include w0r1d_d43m0n. Excluded by default.
 *
 * Output:
 *   /data/manager/backdoor.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const mode = String(ns.args[0] ?? "status").toLowerCase();
    const includeWorldDaemon = ns.args.map(String).includes("--world");

    const reportFile = "/data/manager/backdoor.json";
    const singularity = hasSingularity(ns);
    const autoLink = ns.fileExists("AutoLink.exe", "home");
    const player = safe(() => ns.getPlayer(), null);
    const hacking = getHackingLevel(player);
    const purchased = new Set(safe(() => ns.getPurchasedServers(), []) ?? []);

    const graph = buildGraph(ns, "home");
    const servers = [...graph.keys()].sort();

    const targets = [];

    for (const server of servers) {
        if (shouldSkipServer(ns, server, purchased, includeWorldDaemon)) {
            continue;
        }

        const info = getServerInfo(ns, server, hacking, graph);
        targets.push(info);
    }

    const eligible = targets
        .filter(t => t.eligible)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.requiredHacking !== b.requiredHacking) return a.requiredHacking - b.requiredHacking;
            return a.server.localeCompare(b.server);
        });

    const report = {
        context: "Bitburner backdoor eligibility report",
        schemaVersion: 2,
        generatedAt: Date.now(),
        generatedAtText: new Date().toISOString(),
        mode,
        settings: {
            includeWorldDaemon,
            singularityAvailable: singularity,
            autoLinkAvailable: autoLink
        },
        summary: {
            totalScanned: servers.length,
            trackedTargets: targets.length,
            eligibleTargets: eligible.length,
            alreadyBackdoored: targets.filter(t => t.backdoorInstalled).length,
            noRoot: targets.filter(t => !t.root).length,
            hackingTooLow: targets.filter(t => t.root && !t.backdoorInstalled && !t.hackingReady).length,
            hacking
        },
        eligible,
        targets
    };

    ns.clearLog();

    let autoResults = [];

    if (mode === "auto") {
        if (!singularity) {
            ns.tprint("Singularity API unavailable. Printing manual backdoor routes instead.");
        } else {
            autoResults = await autoBackdoor(ns, eligible);
            report.autoResults = autoResults;
        }
    }

    await ns.write(reportFile, JSON.stringify(report, null, 2), "w");

    printDashboard(ns, report, autoResults);
    printTerminalSummary(ns, report);

    if (eligible.length > 0) {
        ns.tprint(`Backdoor check: ${eligible.length} eligible target(s). See tail or ${reportFile}.`);
    } else {
        ns.tprint(`Backdoor check: no eligible unbackdoored targets. Report written to ${reportFile}.`);
    }

    return eligible.length;
}

function printTerminalSummary(ns, report) {
    const eligible = report.eligible;
    const autoLink = report.settings.autoLinkAvailable;

    ns.tprint("");
    ns.tprint("BACKDOOR ELIGIBLE TARGETS");
    ns.tprint("=========================");

    if (autoLink) {
        ns.tprint("AutoLink.exe detected. Hostnames below are printed plainly for terminal linking where supported.");
    } else {
        ns.tprint("AutoLink.exe not detected. Commands are still copy/paste ready.");
    }

    if (eligible.length === 0) {
        ns.tprint("None currently eligible.");
        return;
    }

    for (const target of eligible) {
        ns.tprint("");
        ns.tprint(`${target.server} | ${target.category} | reqHack ${target.requiredHacking}`);
        ns.tprint(target.server);
        ns.tprint(target.manualCommand);
        printRawTarget(ns, target);
    }
}

function printRawTarget(ns, target) {
    if (typeof ns.tprintRaw !== "function") return;

    try {
        const React = eval("React");

        ns.tprintRaw(
            React.createElement(
                "div",
                {
                    style: {
                        margin: "2px 0 6px 0",
                        fontFamily: "monospace"
                    }
                },
                React.createElement(
                    "span",
                    {
                        style: {
                            color: "#8ab4f8",
                            textDecoration: "underline",
                            cursor: "pointer"
                        },
                        title: target.manualCommand,
                        onClick: async () => {
                            try {
                                await navigator.clipboard.writeText(target.manualCommand);
                            } catch (_) {}
                        }
                    },
                    `[copy route] ${target.server}`
                ),
                React.createElement(
                    "span",
                    {
                        style: {
                            color: "#aaaaaa"
                        }
                    },
                    `  ${target.manualCommand}`
                )
            )
        );
    } catch (_) {
    }
}

function hasSingularity(ns) {
    return Boolean(
        ns.singularity &&
        typeof ns.singularity.connect === "function" &&
        typeof ns.singularity.installBackdoor === "function"
    );
}

async function autoBackdoor(ns, eligible) {
    const results = [];

    for (const target of eligible) {
        const server = target.server;

        if (server === "w0r1d_d43m0n" && !target.includeWorldDaemon) {
            results.push({
                server,
                ok: false,
                reason: "world daemon excluded"
            });
            continue;
        }

        try {
            const connected = connectRoute(ns, target.route);

            if (!connected) {
                results.push({
                    server,
                    ok: false,
                    reason: "connect route failed",
                    route: target.route
                });

                safe(() => ns.singularity.connect("home"), false);
                continue;
            }

            await ns.singularity.installBackdoor();

            results.push({
                server,
                ok: true,
                reason: "backdoor installed",
                route: target.route
            });

            safe(() => ns.singularity.connect("home"), false);
            await ns.sleep(100);
        } catch (err) {
            results.push({
                server,
                ok: false,
                reason: String(err),
                route: target.route
            });

            safe(() => ns.singularity.connect("home"), false);
        }
    }

    return results;
}

function connectRoute(ns, route) {
    if (!Array.isArray(route) || route.length === 0) return false;

    if (!ns.singularity.connect("home")) return false;

    for (const server of route.slice(1)) {
        if (!ns.singularity.connect(server)) {
            return false;
        }
    }

    return true;
}

function getServerInfo(ns, server, hacking, graph) {
    const s = safe(() => ns.getServer(server), null);

    const root = safe(() => ns.hasRootAccess(server), false);
    const backdoorInstalled = Boolean(s && s.backdoorInstalled);
    const requiredHacking = Number(s?.requiredHackingSkill ?? ns.getServerRequiredHackingLevel(server) ?? 0);
    const hackingReady = hacking >= requiredHacking;

    const route = shortestRoute(graph, "home", server);
    const routeCommand = routeToCommand(route);

    const factionPriority = factionBackdoorPriority(server);

    const eligible = root &&
        !backdoorInstalled &&
        hackingReady &&
        Array.isArray(route) &&
        route.length > 0;

    return {
        server,
        root,
        backdoorInstalled,
        requiredHacking,
        hackingReady,
        playerHacking: hacking,
        portsRequired: Number(s?.numOpenPortsRequired ?? 0),
        maxMoney: Number(s?.moneyMax ?? 0),
        minSecurity: Number(s?.minDifficulty ?? 0),
        route,
        routeCommand,
        manualCommand: `${routeCommand}; backdoor`,
        eligible,
        priority: factionPriority,
        category: classifyServer(server, s)
    };
}

function shouldSkipServer(ns, server, purchased, includeWorldDaemon) {
    if (!server || server === "home") return true;
    if (server === "darkweb") return true;
    if (purchased.has(server)) return true;

    if (server.startsWith("pserv-")) return true;
    if (server.startsWith("MooMF")) return true;

    if (server === "w0r1d_d43m0n" && !includeWorldDaemon) return true;

    if (server === ".") return true;

    return false;
}

function factionBackdoorPriority(server) {
    const priority = {
        "CSEC": 0,
        "avmnite-02h": 1,
        "I.I.I.I": 2,
        "run4theh111z": 3,
        "The-Cave": 4,
        "w0r1d_d43m0n": 99
    };

    return priority[server] ?? 20;
}

function classifyServer(server, s) {
    if (server === "CSEC") return "faction";
    if (server === "avmnite-02h") return "faction";
    if (server === "I.I.I.I") return "faction";
    if (server === "run4theh111z") return "faction";
    if (server === "The-Cave") return "endgame-progression";
    if (server === "w0r1d_d43m0n") return "bitnode-transition";

    const maxMoney = Number(s?.moneyMax ?? 0);

    if (maxMoney > 0) return "money-target";
    return "utility";
}

function buildGraph(ns, start = "home") {
    const graph = new Map();
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();

        if (seen.has(server)) continue;
        seen.add(server);

        const neighbors = safe(() => ns.scan(server), []) ?? [];
        graph.set(server, neighbors);

        for (const next of neighbors) {
            if (!seen.has(next)) stack.push(next);
        }
    }

    return graph;
}

function shortestRoute(graph, start, target) {
    if (start === target) return [start];

    const queue = [[start]];
    const seen = new Set([start]);

    while (queue.length > 0) {
        const route = queue.shift();
        const last = route[route.length - 1];

        for (const next of graph.get(last) ?? []) {
            if (seen.has(next)) continue;

            const nextRoute = [...route, next];

            if (next === target) {
                return nextRoute;
            }

            seen.add(next);
            queue.push(nextRoute);
        }
    }

    return [];
}

function routeToCommand(route) {
    if (!Array.isArray(route) || route.length === 0) {
        return "";
    }

    return route.map(server => `connect ${server}`).join("; ");
}

function printDashboard(ns, report, autoResults) {
    const s = report.summary;

    ns.print("BACKDOOR CHECK");
    ns.print("==============");
    ns.print(`Updated:              ${report.generatedAtText}`);
    ns.print(`Mode:                 ${report.mode}`);
    ns.print(`Singularity:          ${report.settings.singularityAvailable}`);
    ns.print(`AutoLink.exe:         ${report.settings.autoLinkAvailable}`);
    ns.print(`Include WorldDaemon:  ${report.settings.includeWorldDaemon}`);
    ns.print(`Player hacking:       ${s.hacking}`);
    ns.print("");
    ns.print("Summary");
    ns.print("-------");
    ns.print(`Total scanned:        ${s.totalScanned}`);
    ns.print(`Tracked targets:      ${s.trackedTargets}`);
    ns.print(`Eligible:             ${s.eligibleTargets}`);
    ns.print(`Already backdoored:   ${s.alreadyBackdoored}`);
    ns.print(`No root:              ${s.noRoot}`);
    ns.print(`Hacking too low:      ${s.hackingTooLow}`);
    ns.print("");

    if (Array.isArray(autoResults) && autoResults.length > 0) {
        ns.print("Auto results");
        ns.print("------------");
        ns.print(table(
            ["Server", "OK", "Reason"],
            autoResults.map(r => [
                r.server,
                String(r.ok),
                truncate(r.reason, 80)
            ])
        ));
        ns.print("");
    }

    if (report.eligible.length > 0) {
        ns.print("Eligible targets");
        ns.print("----------------");
        ns.print(table(
            ["Server", "Category", "ReqHack", "Route"],
            report.eligible.map(t => [
                t.server,
                t.category,
                String(t.requiredHacking),
                truncate(t.manualCommand, 120)
            ])
        ));

        ns.print("");
        ns.print("Manual commands");
        ns.print("---------------");

        for (const target of report.eligible.slice(0, 20)) {
            ns.print(`${target.server}:`);
            ns.print(target.manualCommand);
            ns.print("");
        }

        if (report.eligible.length > 20) {
            ns.print(`... ${report.eligible.length - 20} more in /data/manager/backdoor.json`);
            ns.print("");
        }
    } else {
        ns.print("No eligible unbackdoored targets.");
        ns.print("");
    }

    ns.print("Commands");
    ns.print("--------");
    ns.print("run backdoor-check.js");
    ns.print("run backdoor-check.js auto");
    ns.print("run backdoor-check.js auto --world");
    ns.print("");
    ns.print("Written:");
    ns.print("/data/manager/backdoor.json");
}

function table(headers, rows) {
    const all = [headers, ...rows];

    const widths = headers.map((_, i) =>
        Math.min(120, Math.max(...all.map(row => String(row[i] ?? "").length)))
    );

    const line = row =>
        row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ");

    return [
        line(headers),
        widths.map(w => "-".repeat(w)).join("-|-"),
        ...rows.map(line)
    ].join("\n");
}

function truncate(value, maxLength) {
    const text = String(value ?? "");

    if (text.length <= maxLength) return text;
    return text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

function getHackingLevel(player) {
    const fromSkills = Number(player?.skills?.hacking);

    if (Number.isFinite(fromSkills)) return fromSkills;

    const legacy = Number(player?.hacking);

    if (Number.isFinite(legacy)) return legacy;

    return 0;
}

function safe(fn, fallback) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}
