/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.getHostname() !== "home") {
        ns.print("faction-control.js should be run from home.");
        return -1;
    }

    await openLargeTail(ns, "Faction Control / Spare Capacity");
    ns.clearLog();

    const workerScript = "rent-share.js";

    /*
        Args:
        0 reserveGb        RAM to leave free per host. Default 8.
        1 targetUsePct     Max RAM usage per host. Default 0.98.
        2 loopMs           Rebalance interval. Default 10000.
        3 minThreads       Minimum threads per launch. Default 1.
        4 includeHome      Whether to use home RAM. Default false.
        5 strategy         auto | share | faction | idle. Default auto.
        6 preferredFaction Optional faction name to prioritise.
        7 workType         hacking | field | security. Default hacking.
        8 focus            Whether faction work should focus. Default false.
    */

    const reserveGb = Number(ns.args[0] ?? 8);
    const targetUsePct = Number(ns.args[1] ?? 0.98);
    const loopMs = Number(ns.args[2] ?? 10000);
    const minThreads = Number(ns.args[3] ?? 1);
    const includeHome = parseBool(ns.args[4] ?? false);
    const strategy = String(ns.args[5] ?? "auto").toLowerCase();
    const preferredFaction = String(ns.args[6] ?? "").trim();
    const workType = normaliseWorkType(String(ns.args[7] ?? "hacking"));
    const focus = parseBool(ns.args[8] ?? false);

    if (!ns.fileExists(workerScript, "home")) {
        ns.print(`ERROR: Missing ${workerScript} on home.`);
        return -2;
    }

    while (true) {
        const servers = getAllServers(ns, "home");
        const hosts = getRentalHosts(ns, servers, includeHome);

        const factionState = getFactionState(ns, preferredFaction, workType);
        const decision = decideAction(strategy, factionState);

        let workResult = "not attempted";
        if (decision.useFactionWork) {
            workResult = tryStartFactionWork(ns, factionState.selectedFaction, workType, focus);
        }

        let launchedHosts = 0;
        let launchedThreads = 0;
        let totalRam = 0;
        let usedRamBefore = 0;
        let freeRamBefore = 0;
        const rows = [];

        for (const host of hosts) {
            const maxRam = ns.getServerMaxRam(host);
            const used = ns.getServerUsedRam(host);
            const free = Math.max(0, maxRam - used);

            totalRam += maxRam;
            usedRamBefore += used;
            freeRamBefore += free;

            if (!ns.fileExists(workerScript, host)) {
                await ns.scp(workerScript, host, "home");
                await ns.sleep(5);
            }

            // Rebalance only the worker we own.
            killScriptOnHost(ns, workerScript, host);

            if (!decision.useShareRam) {
                rows.push([
                    host,
                    decision.action,
                    decision.reason,
                    pct(used, maxRam),
                    formatRam(ns, free)
                ]);
                await ns.sleep(1);
                continue;
            }

            const workerRam = ns.getScriptRam(workerScript, host);
            if (workerRam <= 0) {
                rows.push([host, "skip", "script RAM unavailable", pct(used, maxRam), formatRam(ns, free)]);
                await ns.sleep(1);
                continue;
            }

            const postKillUsed = ns.getServerUsedRam(host);
            const postKillFree = Math.max(0, maxRam - postKillUsed);

            const freeAfterReserve = Math.max(0, postKillFree - reserveGb);
            const targetHeadroom = Math.max(0, (maxRam * targetUsePct) - postKillUsed);
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
                        pct(postKillUsed + threads * workerRam, maxRam),
                        formatRam(ns, postKillFree)
                    ]);
                } else {
                    rows.push([
                        host,
                        "fail",
                        `${threads}t exec returned 0`,
                        pct(postKillUsed, maxRam),
                        formatRam(ns, postKillFree)
                    ]);
                }
            } else {
                rows.push([
                    host,
                    "idle",
                    `free ${formatRam(ns, postKillFree)}; reserve/ceiling blocks launch`,
                    pct(postKillUsed, maxRam),
                    formatRam(ns, postKillFree)
                ]);
            }

            await ns.sleep(1);
        }

        ns.clearLog();

        ns.print("Faction control running.");
        ns.print(`Strategy: ${strategy}`);
        ns.print(`Decision: ${decision.action} - ${decision.reason}`);
        ns.print(`Faction: ${factionState.selectedFaction || "none"}`);
        ns.print(`Work type: ${workType}`);
        ns.print(`Faction work: ${workResult}`);
        ns.print(`Share workers: ${launchedThreads} threads on ${launchedHosts} hosts`);
        ns.print("");
        ns.print(`Hosts: ${hosts.length}`);
        ns.print(`Fleet RAM before rebalance: ${formatRam(ns, usedRamBefore)} / ${formatRam(ns, totalRam)} used (${pct(usedRamBefore, totalRam)})`);
        ns.print(`Fleet free before rebalance: ${formatRam(ns, freeRamBefore)}`);
        ns.print(`Reserve: ${reserveGb}GB/host; target use ${(targetUsePct * 100).toFixed(1)}%`);
        ns.print("");

        ns.print("Faction analysis:");
        ns.print(`- Player factions: ${factionState.playerFactions.length}`);
        ns.print(`- Singularity available: ${factionState.singularityAvailable ? "yes" : "no"}`);
        ns.print(`- Best augmentation target: ${factionState.bestAugmentation || "unknown"}`);
        ns.print(`- Current rep: ${formatNumber(factionState.selectedRep)}`);
        ns.print(`- Required rep: ${formatNumber(factionState.requiredRep)}`);
        ns.print(`- Rep gap: ${formatNumber(factionState.repGap)}`);
        ns.print("");

        ns.print(table(["Host", "Action", "Detail", "Projected use", "Free before"], rows.slice(0, 30)));

        if (rows.length > 30) {
            ns.print(`... ${rows.length - 30} more hosts omitted from display.`);
        }

        await ns.sleep(loopMs);
    }
}

function decideAction(strategy, factionState) {
    if (strategy === "idle") {
        return {
            action: "idle",
            useFactionWork: false,
            useShareRam: false,
            reason: "strategy forces idle"
        };
    }

    if (strategy === "share") {
        return {
            action: "share",
            useFactionWork: false,
            useShareRam: true,
            reason: "strategy forces ns.share()"
        };
    }

    if (strategy === "faction") {
        if (!factionState.selectedFaction) {
            return {
                action: "share",
                useFactionWork: false,
                useShareRam: true,
                reason: "no faction selected; falling back to share"
            };
        }

        return {
            action: "faction+share",
            useFactionWork: true,
            useShareRam: true,
            reason: "strategy forces faction work plus share"
        };
    }

    // auto
    if (factionState.selectedFaction && factionState.repGap > 0) {
        return {
            action: "faction+share",
            useFactionWork: true,
            useShareRam: true,
            reason: "selected faction has locked augmentation rep gap"
        };
    }

    if (factionState.selectedFaction) {
        return {
            action: "faction+share",
            useFactionWork: true,
            useShareRam: true,
            reason: "faction exists; continue reputation optimisation"
        };
    }

    return {
        action: "share",
        useFactionWork: false,
        useShareRam: true,
        reason: "no faction work available; use spare RAM for share"
    };
}

function getFactionState(ns, preferredFaction, workType) {
    const state = {
        singularityAvailable: false,
        playerFactions: [],
        selectedFaction: "",
        selectedRep: 0,
        requiredRep: 0,
        repGap: 0,
        bestAugmentation: ""
    };

    try {
        const player = ns.getPlayer();
        state.playerFactions = Array.isArray(player.factions) ? player.factions : [];
    } catch (_) {
        return state;
    }

    state.singularityAvailable = !!(
        ns.singularity &&
        typeof ns.singularity.getFactionRep === "function" &&
        typeof ns.singularity.getAugmentationsFromFaction === "function" &&
        typeof ns.singularity.getAugmentationRepReq === "function"
    );

    if (state.playerFactions.length === 0) return state;

    if (!state.singularityAvailable) {
        state.selectedFaction = preferredFaction && state.playerFactions.includes(preferredFaction)
            ? preferredFaction
            : state.playerFactions[0];
        return state;
    }

    const ownedAugs = getOwnedAugmentationsSafe(ns);
    const candidates = [];

    for (const faction of state.playerFactions) {
        if (preferredFaction && faction !== preferredFaction) continue;

        const rep = getFactionRepSafe(ns, faction);
        const augs = getAugmentationsFromFactionSafe(ns, faction);

        let bestAug = "";
        let bestReq = 0;
        let bestGap = 0;

        for (const aug of augs) {
            if (ownedAugs.has(aug)) continue;
            if (aug === "NeuroFlux Governor") continue;

            const req = getAugmentationRepReqSafe(ns, aug);
            const gap = Math.max(0, req - rep);

            if (!bestAug || gap < bestGap || bestGap === 0) {
                bestAug = aug;
                bestReq = req;
                bestGap = gap;
            }
        }

        candidates.push({
            faction,
            rep,
            augmentation: bestAug,
            requiredRep: bestReq,
            repGap: bestGap
        });
    }

    if (candidates.length === 0 && preferredFaction) {
        const rep = getFactionRepSafe(ns, preferredFaction);
        state.selectedFaction = preferredFaction;
        state.selectedRep = rep;
        return state;
    }

    candidates.sort((a, b) => {
        // Prefer factions where we have a real rep gap to close.
        const aHasGap = a.repGap > 0 ? 0 : 1;
        const bHasGap = b.repGap > 0 ? 0 : 1;
        if (aHasGap !== bHasGap) return aHasGap - bHasGap;

        // Then prefer the smallest reachable gap.
        if (a.repGap !== b.repGap) return a.repGap - b.repGap;

        return a.faction.localeCompare(b.faction);
    });

    const best = candidates[0];
    if (!best) return state;

    state.selectedFaction = best.faction;
    state.selectedRep = best.rep;
    state.requiredRep = best.requiredRep;
    state.repGap = best.repGap;
    state.bestAugmentation = best.augmentation;

    return state;
}

function tryStartFactionWork(ns, faction, workType, focus) {
    if (!faction) return "no faction selected";

    if (!ns.singularity || typeof ns.singularity.workForFaction !== "function") {
        return "singularity workForFaction unavailable";
    }

    const workTypesToTry = buildWorkTypeFallbacks(workType);

    for (const candidateWorkType of workTypesToTry) {
        try {
            const ok = ns.singularity.workForFaction(faction, candidateWorkType, focus);
            if (ok) return `started ${candidateWorkType} work for ${faction}`;
        } catch (err) {
            // Try next work type.
        }
    }

    return `failed to start faction work for ${faction}`;
}

function buildWorkTypeFallbacks(workType) {
    const primary = normaliseWorkType(workType);
    const all = ["hacking", "field", "security"];
    return [primary, ...all.filter(x => x !== primary)];
}

function normaliseWorkType(value) {
    const text = String(value).toLowerCase().trim();

    if (text === "hack" || text === "hacking" || text === "hackingcontracts" || text === "hacking contracts") {
        return "hacking";
    }

    if (text === "field" || text === "fieldwork" || text === "field work") {
        return "field";
    }

    if (text === "sec" || text === "security" || text === "securitywork" || text === "security work") {
        return "security";
    }

    return "hacking";
}

function getOwnedAugmentationsSafe(ns) {
    try {
        return new Set(ns.singularity.getOwnedAugmentations(true));
    } catch (_) {
        return new Set();
    }
}

function getFactionRepSafe(ns, faction) {
    try {
        return Number(ns.singularity.getFactionRep(faction) ?? 0);
    } catch (_) {
        return 0;
    }
}

function getAugmentationsFromFactionSafe(ns, faction) {
    try {
        const result = ns.singularity.getAugmentationsFromFaction(faction);
        return Array.isArray(result) ? result : [];
    } catch (_) {
        return [];
    }
}

function getAugmentationRepReqSafe(ns, augmentation) {
    try {
        return Number(ns.singularity.getAugmentationRepReq(augmentation) ?? 0);
    } catch (_) {
        return 0;
    }
}

function killScriptOnHost(ns, script, host) {
    try {
        const processes = ns.ps(host);
        for (const proc of processes) {
            if (proc.filename === script) {
                ns.kill(proc.pid);
            }
        }
    } catch (_) {}
}

async function openLargeTail(ns, title) {
    try {
        if (ns.ui?.openTail) {
            ns.ui.openTail();
        } else if (ns.tail) {
            ns.tail();
        }

        await ns.sleep(50);
    } catch (_) {}

    try {
        if (ns.ui?.resizeTail) {
            ns.ui.resizeTail(1100, 700);
        } else if (ns.resizeTail) {
            ns.resizeTail(1100, 700);
        }
    } catch (_) {}

    try {
        if (ns.ui?.moveTail) {
            ns.ui.moveTail(80, 80);
        } else if (ns.moveTail) {
            ns.moveTail(80, 80);
        }
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

    if (typeof ns.formatRam === "function") {
        return ns.formatRam(value);
    }

    return `${value.toFixed(1)}GB`;
}

function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";

    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;

    return n.toFixed(2);
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