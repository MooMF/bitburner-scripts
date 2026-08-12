/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const reportFile = String(ns.args[0] ?? "/data/manager/ai-diagnostic.json");
    const registryFile = "/data/purchased-servers.json";
    const securityBuffer = Number(ns.args[1] ?? 5);
    const moneyTargetRatio = Number(ns.args[2] ?? 0.85);
    const hackTargetRatio = Number(ns.args[3] ?? 0.10);

    const now = Date.now();
    const servers = getAllServers(ns, "home").sort();
    const owned = getOwnedServerDetails(ns, registryFile);
    const processes = allProcesses(ns, servers);
    const inventory = servers.map(server => inventoryRow(ns, server, owned.names));

    const runtime = buildRuntime(ns, inventory, processes);
    const money = buildMoney(ns, inventory, processes, moneyTargetRatio);
    const security = buildSecurity(ns, inventory, processes, securityBuffer);
    const payouts = buildPayouts(ns, inventory, processes, securityBuffer, moneyTargetRatio, hackTargetRatio);
    const share = buildShare(ns, inventory, processes, owned.names);
    const xpFarm = buildXpFarm(ns, processes);
    const player = buildPlayer(ns);
    const contracts = buildContracts(ns, servers);
    const purchasedServers = buildPurchasedSummary(ns, owned, registryFile);
    const network = buildNetworkSummary(inventory);
    const processSummary = buildProcessSummary(processes);

    const actionSuggestions = buildActionSuggestions({
        runtime,
        money,
        security,
        payouts,
        contracts,
        purchasedServers,
        player
    });

    const diagnostic = {
        context: "Bitburner manager-console AI diagnostic package",
        schemaVersion: 3,
        generatedAt: now,
        generatedAtText: new Date(now).toISOString(),
        operatingAssumptions: {
            bitburnerApi: "v3.x",
            reportDirectory: "/data/manager/",
            purchasedServerRegistry: registryFile,
            note: "Bought/cloud servers are detected by API first, registry second. No naming prefix is assumed."
        },
        howToUseThisPackage: {
            uploadInstruction: "Upload /data/manager/ai-diagnostic.json into ChatGPT and ask it to review current system state.",
            recommendedPrompt: "Review this Bitburner diagnostic JSON. Identify bottlenecks, broken assumptions, missing scripts, and the next safest code changes.",
            copyPasteCommand: "run info-diagnostic.js"
        },
        filesExpectedOnHome: expectedHomeFiles(),
        existingManagerReports: {
            runtime,
            money,
            security,
            payouts,
            share,
            player,
            xpFarm
        },
        summaries: {
            network,
            processes: processSummary,
            purchasedServers,
            contracts,
            stockMarket: buildStockMarket(ns),
            futureSystems: {
                contracts: contracts.solverImplemented ? "implemented" : "placeholder-present",
                stockMarket: "api-detected-or-stubbed",
                darkWeb: "placeholder-empty",
                factions: "placeholder-empty",
                augmentations: "placeholder-empty",
                corporations: "placeholder-empty",
                gangs: "placeholder-empty",
                sleeves: "placeholder-empty",
                bladeburner: "placeholder-empty",
                hacknet: "placeholder-empty"
            }
        },
        actionSuggestions,
        aiPrompts: buildAiPrompts({ network, processSummary, contracts, actionSuggestions }),
        serverInventory: inventory
    };

    await ns.write(reportFile, JSON.stringify(diagnostic, null, 2), "w");

    ns.tprint(`info-diagnostic.js: wrote ${reportFile}`);
    ns.tprint(`Servers: ${network.total}; rooted: ${network.rooted}; RAM used: ${network.ramUsedPct.toFixed(1)}%; bought/cloud servers: ${purchasedServers.count}`);
    ns.tprint(`High/medium action suggestions: ${actionSuggestions.filter(a => a.priority === "high" || a.priority === "medium").length}`);

    return 0;
}

function expectedHomeFiles() {
    return [
        "check-infection.js",
        "manager-console.js",
        "info-runtime.js",
        "info-money.js",
        "info-security.js",
        "info-payouts.js",
        "info-share.js",
        "info-player.js",
        "info-diagnostic.js",
        "startup.js",
        "upload.js",
        "assign-targets.js",
        "process.js",
        "weaken.js",
        "grow.js",
        "hack.js",
        "rent-capacity.js",
        "rent-share.js",
        "xp-farm.js",
        "buy-servers.js",
        "clean.js",
        "logview.js",
        "backdoor-check.js"
    ];
}

function getCloudApi(ns) {
    if (ns.cloud && typeof ns.cloud.getServerNames === "function") {
        return {
            available: true,
            mode: "ns.cloud",
            getNames: () => ns.cloud.getServerNames(),
            getLimit: () => ns.cloud.getServerLimit(),
            getRamLimit: () => ns.cloud.getRamLimit()
        };
    }

    if (typeof ns.getPurchasedServers === "function") {
        return {
            available: true,
            mode: "legacy purchased-server API",
            getNames: () => ns.getPurchasedServers(),
            getLimit: () => typeof ns.getPurchasedServerLimit === "function" ? ns.getPurchasedServerLimit() : null,
            getRamLimit: () => typeof ns.getPurchasedServerMaxRam === "function" ? ns.getPurchasedServerMaxRam() : null
        };
    }

    return {
        available: false,
        mode: "none",
        getNames: () => [],
        getLimit: () => null,
        getRamLimit: () => null
    };
}

function getOwnedServerDetails(ns, registryFile = "/data/purchased-servers.json") {
    const names = new Set();
    const sources = {};
    const cloud = getCloudApi(ns);
    const registry = readJson(ns, registryFile);

    // Primary: actual game API. This catches servers bought before this script existed.
    try {
        if (cloud.available) {
            for (const name of cloud.getNames()) {
                if (name && ns.serverExists(name)) {
                    names.add(name);
                    sources[name] = cloud.mode;
                }
            }
        }
    } catch {}

    // Secondary: persistent metadata registry.
    try {
        if (registry && Array.isArray(registry.servers)) {
            for (const item of registry.servers) {
                const name = typeof item === "string" ? item : item.name;
                if (name && ns.serverExists(name)) {
                    names.add(name);
                    if (!sources[name]) sources[name] = "registry";
                }
            }
        }
    } catch {}

    return {
        names,
        sources,
        registry,
        apiMode: cloud.mode,
        apiAvailable: cloud.available,
        apiLimit: safeCall(() => cloud.getLimit(), null),
        apiMaxRam: safeCall(() => cloud.getRamLimit(), null)
    };
}

function buildPurchasedSummary(ns, owned, registryFile) {
    const servers = [...owned.names]
        .filter(name => ns.serverExists(name))
        .sort()
        .map(name => {
            const maxRam = ns.getServerMaxRam(name);
            const usedRam = ns.getServerUsedRam(name);
            return {
                name,
                maxRam,
                usedRam,
                freeRam: Math.max(0, maxRam - usedRam),
                usedPct: pct(usedRam, maxRam),
                source: owned.sources[name] ?? "unknown"
            };
        });

    const totalRam = sum(servers.map(s => s.maxRam));
    const usedRam = sum(servers.map(s => s.usedRam));

    return {
        count: servers.length,
        limit: owned.apiLimit,
        maxServerRam: owned.apiMaxRam,
        totalRam,
        usedRam,
        freeRam: Math.max(0, totalRam - usedRam),
        usedPct: pct(usedRam, totalRam),
        restartRequired: safeCall(() => ns.fileExists("restart-required.txt", "home"), false),
        registryFile,
        registryPresent: !!owned.registry,
        apiMode: owned.apiMode,
        apiAvailable: owned.apiAvailable,
        detection: "API names union registry names; no naming-prefix assumption",
        servers
    };
}

function inventoryRow(ns, server, ownedNames) {
    const rooted = safeCall(() => ns.hasRootAccess(server), false);
    const maxRam = safeCall(() => ns.getServerMaxRam(server), 0);
    const usedRam = safeCall(() => ns.getServerUsedRam(server), 0);
    const maxMoney = safeCall(() => ns.getServerMaxMoney(server), 0);
    const currentMoney = safeCall(() => ns.getServerMoneyAvailable(server), 0);
    const currentSecurity = safeCall(() => ns.getServerSecurityLevel(server), 0);
    const minSecurity = safeCall(() => ns.getServerMinSecurityLevel(server), 0);
    const files = safeCall(() => ns.ls(server), []);

    return {
        server,
        rooted,
        purchased: ownedNames.has(server),
        hasMoney: maxMoney > 0,
        hacking: {
            requiredLevel: safeCall(() => ns.getServerRequiredHackingLevel(server), null),
            portsRequired: safeCall(() => ns.getServerNumPortsRequired(server), null)
        },
        ram: {
            max: maxRam,
            used: usedRam,
            free: Math.max(0, maxRam - usedRam),
            usedPct: pct(usedRam, maxRam)
        },
        money: {
            current: currentMoney,
            max: maxMoney,
            pct: pct(currentMoney, maxMoney)
        },
        security: {
            current: currentSecurity,
            min: minSecurity,
            aboveMin: Math.max(0, currentSecurity - minSecurity)
        },
        timings: {
            hackMs: maxMoney > 0 ? safeCall(() => ns.getHackTime(server), null) : null,
            growMs: maxMoney > 0 ? safeCall(() => ns.getGrowTime(server), null) : null,
            weakenMs: maxMoney > 0 ? safeCall(() => ns.getWeakenTime(server), null) : null
        },
        files: {
            count: files.length,
            contracts: files.filter(f => f.endsWith(".cct")),
            hasProcess: files.includes("process.js"),
            hasWeaken: files.includes("weaken.js"),
            hasGrow: files.includes("grow.js"),
            hasHack: files.includes("hack.js"),
            hasRentShare: files.includes("rent-share.js"),
            hasRentCapacity: files.includes("rent-capacity.js")
        }
    };
}

function buildRuntime(ns, inventory, processes) {
    const targets = inventory.map(item => {
        const manager = findManager(processes, item.server);
        const cycle = findCycle(processes, item.server);
        return {
            server: item.server,
            root: item.rooted ? "yes" : "no",
            purchased: item.purchased,
            ram: `${fmtRam(ns, item.ram.used)}/${fmtRam(ns, item.ram.max)} ${item.ram.usedPct.toFixed(1)}%`,
            manager: manager.kind,
            cycle: cycle.text,
            status: !item.rooted
                ? "noRoot"
                : item.hasMoney
                    ? manager.kind === "none" ? "unmanaged" : "managed"
                    : "nonMoney"
        };
    });

    const moneyTargets = targets.filter(t => inventory.find(i => i.server === t.server)?.hasMoney);

    return {
        timestamp: Date.now(),
        summary: {
            totalServers: inventory.length,
            rootedServers: inventory.filter(i => i.rooted).length,
            unrootedServers: inventory.filter(i => !i.rooted).length,
            moneyServers: inventory.filter(i => i.hasMoney).length,
            managedTargets: moneyTargets.filter(t => t.status === "managed").length,
            unmanagedTargets: moneyTargets.filter(t => t.status === "unmanaged").length,
            rootedUnmanagedMoneyTargets: moneyTargets.filter(t => t.status === "unmanaged" && inventory.find(i => i.server === t.server)?.rooted).length,
            payloadMissing: inventory.filter(i => i.rooted && !i.files.hasProcess && !i.purchased).length,
            totalRam: sum(inventory.map(i => i.ram.max)),
            usedRam: sum(inventory.map(i => i.ram.used)),
            ramUsedPct: pct(sum(inventory.map(i => i.ram.used)), sum(inventory.map(i => i.ram.max))),
            weakenWorkers: processes.filter(p => p.filename === "weaken.js").length,
            growWorkers: processes.filter(p => p.filename === "grow.js").length,
            hackWorkers: processes.filter(p => p.filename === "hack.js").length,
            processManagers: processes.filter(p => p.filename === "process.js").length,
            idleManagers: targets.filter(t => t.manager !== "none" && t.cycle === "idle").length,
            restartRequired: safeCall(() => ns.fileExists("restart-required.txt", "home"), false)
        },
        targets
    };
}

function buildMoney(ns, inventory, processes, moneyTargetRatio) {
    const targets = inventory
        .filter(i => i.hasMoney)
        .sort((a, b) => b.money.max - a.money.max)
        .map(i => {
            const manager = findManager(processes, i.server);
            const cycle = findCycle(processes, i.server);
            return {
                server: i.server,
                rooted: i.rooted,
                money: `${i.money.pct.toFixed(1)}% ${fmtMoney(ns, i.money.current)}`,
                pct: `${i.money.pct.toFixed(1)}%`,
                max: fmtMoney(ns, i.money.max),
                manager: manager.kind,
                cycle: cycle.text,
                currentMoney: i.money.current,
                maxMoney: i.money.max,
                moneyPct: i.money.pct,
                ready: i.money.current >= i.money.max * moneyTargetRatio
            };
        });

    const currentMoney = sum(targets.map(t => t.currentMoney));
    const maxMoney = sum(targets.map(t => t.maxMoney));

    return {
        timestamp: Date.now(),
        summary: {
            moneyTargets: targets.length,
            currentMoney,
            maxMoney,
            moneyPct: pct(currentMoney, maxMoney),
            readyTargets: targets.filter(t => t.ready).length,
            lowMoneyTargets: targets.filter(t => !t.ready).length,
            rootedLowMoneyTargets: targets.filter(t => t.rooted && !t.ready).length,
            moneyTargetRatio
        },
        targets
    };
}

function buildSecurity(ns, inventory, processes, securityBuffer) {
    const targets = inventory
        .filter(i => i.hasMoney)
        .map(i => {
            const allowed = i.security.min + securityBuffer;
            const excess = Math.max(0, i.security.current - allowed);
            const cycle = findCycle(processes, i.server);
            return {
                server: i.server,
                rooted: i.rooted,
                security: `${i.security.current.toFixed(2)}/${i.security.min.toFixed(2)}`,
                aboveMin: i.security.aboveMin.toFixed(2),
                buffer: securityBuffer.toFixed(2),
                allowed: allowed.toFixed(2),
                excess: excess.toFixed(2),
                cycle: cycle.text,
                currentSecurity: i.security.current,
                minSecurity: i.security.min,
                allowedSecurity: allowed,
                securityAboveMin: i.security.aboveMin,
                securityExcess: excess,
                securityEtaMs: excess > 0 ? i.timings.weakenMs : 0,
                securityEtaText: excess > 0 ? fmtDuration(i.timings.weakenMs) : "now",
                ready: excess <= 0
            };
        })
        .sort((a, b) => b.securityExcess - a.securityExcess);

    return {
        timestamp: Date.now(),
        summary: {
            moneyTargets: targets.length,
            readyTargets: targets.filter(t => t.ready).length,
            notReadyTargets: targets.filter(t => !t.ready).length,
            rootedNotReadyTargets: targets.filter(t => t.rooted && !t.ready).length,
            totalSecurityExcess: sum(targets.map(t => t.securityExcess)),
            worstServer: targets[0]?.server ?? null,
            worstExcess: targets[0]?.securityExcess ?? 0,
            securityBuffer
        },
        worst: targets.slice(0, 10),
        targets
    };
}

function buildPayouts(ns, inventory, processes, securityBuffer, moneyTargetRatio, hackTargetRatio) {
    const targets = inventory
        .filter(i => i.hasMoney)
        .map(i => {
            const securityExcess = Math.max(0, i.security.current - (i.security.min + securityBuffer));
            const moneyReady = i.money.current >= i.money.max * moneyTargetRatio;
            const securityReady = securityExcess <= 0;
            const hackFractionPerThread = safeCall(() => ns.hackAnalyze(i.server), 0);
            const hackThreads = hackFractionPerThread > 0 ? Math.ceil(hackTargetRatio / hackFractionPerThread) : 0;
            const hackable = i.rooted && hackThreads > 0;
            const hackReady = moneyReady && securityReady && hackable;
            const cycle = findCycle(processes, i.server);
            const estimatedHackMoney = hackReady ? i.money.current * hackTargetRatio : 0;

            return {
                server: i.server,
                money: `${i.money.pct.toFixed(1)}% ${fmtMoney(ns, i.money.current)}`,
                security: `${i.security.current.toFixed(2)}/${i.security.min.toFixed(2)}`,
                readiness: hackReady ? "hackReady" : !securityReady ? "blockedBySecurity" : !moneyReady ? "blockedByMoney" : !hackable ? "preparedButUnhackable" : "unknown",
                prepared: moneyReady && securityReady,
                hackable,
                hackReady,
                hackMoney: fmtMoney(ns, estimatedHackMoney),
                hackEta: hackReady ? fmtDuration(i.timings.hackMs) : "blocked",
                growEta: moneyReady ? "now" : fmtDuration(i.timings.growMs),
                weakenEta: securityReady ? "now" : fmtDuration(i.timings.weakenMs),
                cycle: cycle.text,
                currentMoney: i.money.current,
                maxMoney: i.money.max,
                moneyPct: i.money.pct,
                currentSecurity: i.security.current,
                minSecurity: i.security.min,
                securityExcess,
                moneyReady,
                securityReady,
                hackFractionPerThread,
                hackThreads,
                estimatedHackMoney,
                hackTimeMs: i.timings.hackMs,
                growTimeMs: i.timings.growMs,
                weakenTimeMs: i.timings.weakenMs
            };
        })
        .sort((a, b) => b.estimatedHackMoney - a.estimatedHackMoney || b.maxMoney - a.maxMoney);

    return {
        timestamp: Date.now(),
        timestampText: new Date(Date.now()).toISOString(),
        summary: {
            targets: targets.length,
            hackReadyTargets: targets.filter(t => t.hackReady).length,
            preparedButUnhackableTargets: targets.filter(t => t.readiness === "preparedButUnhackable").length,
            blockedBySecurityTargets: targets.filter(t => t.readiness === "blockedBySecurity").length,
            blockedByMoneyTargets: targets.filter(t => t.readiness === "blockedByMoney").length,
            nextHackMoney: sum(targets.filter(t => t.hackReady).map(t => t.estimatedHackMoney)),
            bestTarget: targets[0]?.server ?? null,
            bestHackMoney: targets[0]?.estimatedHackMoney ?? 0,
            securityBuffer,
            moneyTargetRatio,
            hackTargetRatio,
            note: "hackReady requires money ready, security ready, root, and hackAnalyze() > 0."
        },
        best: targets.filter(t => t.hackReady).slice(0, 10),
        preparedButUnhackable: targets.filter(t => t.readiness === "preparedButUnhackable"),
        targets
    };
}

function buildShare(ns, inventory, processes, ownedNames) {
    const shareManagers = processes.filter(p => p.filename === "rent-capacity.js");
    const shareWorkers = processes.filter(p => p.filename === "rent-share.js");
    const shareRam = sum(shareWorkers.map(p => safeCall(() => ns.getScriptRam(p.filename, p.host), 0) * p.threads));
    const capableHosts = inventory.filter(i => i.rooted && i.ram.max > 0 && !i.hasMoney && i.server !== "home");
    const capableRam = sum(capableHosts.map(h => h.ram.max));
    const capableUsed = sum(capableHosts.map(h => h.ram.used));

    return {
        timestamp: Date.now(),
        summary: {
            managerRunning: shareManagers.length > 0,
            managerCount: shareManagers.length,
            managerHosts: [...new Set(shareManagers.map(p => p.host))],
            sharePower: safeCall(() => ns.getSharePower(), null),
            shareCapableHosts: capableHosts.length,
            shareCapableRam: capableRam,
            shareCapableUsedRam: capableUsed,
            shareCapableFreeRam: Math.max(0, capableRam - capableUsed),
            shareCapableUsedPct: pct(capableUsed, capableRam),
            shareHosts: new Set(shareWorkers.map(p => p.host)).size,
            shareWorkers: shareWorkers.length,
            shareThreads: sum(shareWorkers.map(p => p.threads)),
            shareRam,
            shareRamPct: pct(shareRam, capableRam),
            boughtCloudCapableHosts: capableHosts.filter(h => ownedNames.has(h.server)).length
        },
        managers: shareManagers,
        workers: shareWorkers,
        hosts: capableHosts.map(h => ({
            host: h.server,
            bought: ownedNames.has(h.server),
            ram: `${fmtRam(ns, h.ram.used)}/${fmtRam(ns, h.ram.max)} ${h.ram.usedPct.toFixed(1)}%`,
            free: fmtRam(ns, h.ram.free),
            status: h.ram.free > 0 ? "available" : "full"
        }))
    };
}

function buildXpFarm(ns, processes) {
    const managers = processes.filter(p => p.filename === "xp-farm.js");
    const workers = processes.filter(p => p.filename === "weaken.js" && p.args.length > 0 && String(p.args[0]) === "joesguns");
    return {
        timestamp: Date.now(),
        summary: {
            managerRunning: managers.length > 0,
            managerCount: managers.length,
            workerCount: workers.length,
            workerThreads: sum(workers.map(w => w.threads)),
            note: "Heuristic: weaken.js joesguns workers may include XP farm or normal target work."
        },
        managers,
        workers
    };
}

function buildPlayer(ns) {
    const player = safeCall(() => ns.getPlayer(), null);
    const moneySources = safeCall(() => ns.getMoneySources(), null);
    if (!player) return { context: "Bitburner player state report", summary: { ok: false } };

    return {
        context: "Bitburner player state report",
        schemaVersion: 1,
        generatedAt: Date.now(),
        generatedAtText: new Date(Date.now()).toISOString(),
        summary: {
            ok: true,
            money: player.money,
            city: player.city,
            location: player.location,
            hacking: player.skills?.hacking ?? player.hacking ?? null,
            factions: player.factions ?? [],
            jobs: player.jobs ?? {},
            tor: safeCall(() => ns.scan("darkweb").length > 0, null),
            currentNode: safeCall(() => ns.getResetInfo().currentNode, null),
            lastAugReset: safeCall(() => ns.getResetInfo().lastAugReset, null),
            lastNodeReset: safeCall(() => ns.getResetInfo().lastNodeReset, null)
        },
        player,
        resetInfo: safeCall(() => ns.getResetInfo(), null),
        moneySources
    };
}

function buildContracts(ns, servers) {
    const raw = [];
    for (const server of servers) {
        const files = safeCall(() => ns.ls(server, ".cct"), []);
        for (const file of files) {
            const type = safeCall(() => ns.codingcontract.getContractType(file, server), "unknown");
            const triesRemaining = safeCall(() => ns.codingcontract.getNumTriesRemaining(file, server), null);
            const data = safeCall(() => ns.codingcontract.getData(file, server), null);
            raw.push({ server, file, type, triesRemaining, dataSignature: stableStringify(data).slice(0, 500) });
        }
    }

    const seen = new Set();
    const unique = [];
    for (const c of raw) {
        const key = `${c.file}|${c.type}|${c.dataSignature}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(c);
    }

    const byType = {};
    for (const c of unique) byType[c.type] = (byType[c.type] ?? 0) + 1;

    return {
        serversScanned: servers.length,
        rawContractFilesFound: raw.length,
        uniqueContracts: unique.length,
        duplicateFilesSuppressed: raw.length - unique.length,
        validUniqueContracts: unique.length,
        invalidUniqueContractFiles: 0,
        homePreferredContracts: unique.filter(c => c.server === "home").length,
        remotePreferredContracts: unique.filter(c => c.server !== "home").length,
        byType,
        implemented: "read-only inventory",
        solverImplemented: false,
        warning: "No solve attempts are made by this script.",
        dedupeRule: "fileName + contractType + dataSignature",
        preferenceRule: "home first, then valid, then higher tries remaining",
        nextScriptCandidate: "solve-contracts.js",
        contracts: unique
    };
}

function buildStockMarket(ns) {
    const symbols = safeCall(() => ns.stock.getSymbols(), []);
    let positions = 0;
    for (const sym of symbols) {
        const pos = safeCall(() => ns.stock.getPosition(sym), [0, 0, 0, 0]);
        if ((pos[0] ?? 0) > 0 || (pos[2] ?? 0) > 0) positions++;
    }

    return {
        available: symbols.length > 0,
        hasTixApi: symbols.length > 0,
        has4SData: safeCall(() => typeof ns.stock.has4SDataTIXAPI === "function" ? ns.stock.has4SDataTIXAPI() : null, null),
        symbols: symbols.length,
        positions,
        implemented: false
    };
}

function buildNetworkSummary(inventory) {
    const totalRam = sum(inventory.map(i => i.ram.max));
    const usedRam = sum(inventory.map(i => i.ram.used));
    const currentMoney = sum(inventory.map(i => i.money.current));
    const maxMoney = sum(inventory.map(i => i.money.max));

    return {
        total: inventory.length,
        rooted: inventory.filter(i => i.rooted).length,
        unrooted: inventory.filter(i => !i.rooted).length,
        moneyServers: inventory.filter(i => i.hasMoney).length,
        purchasedServers: inventory.filter(i => i.purchased).length,
        totalRam,
        usedRam,
        freeRam: Math.max(0, totalRam - usedRam),
        ramUsedPct: pct(usedRam, totalRam),
        currentMoney,
        maxMoney,
        moneyPct: pct(currentMoney, maxMoney),
        totalSecurityAboveMin: sum(inventory.map(i => i.security.aboveMin))
    };
}

function buildProcessSummary(processes) {
    const framework = new Set(["process.js", "weaken.js", "grow.js", "hack.js", "rent-capacity.js", "rent-share.js", "xp-farm.js", "info-diagnostic.js", "manager-console.js"]);
    const byFilename = {};
    const byHost = {};
    const unknownFiles = {};

    for (const p of processes) {
        byFilename[p.filename] = (byFilename[p.filename] ?? 0) + 1;
        byHost[p.host] = (byHost[p.host] ?? 0) + 1;
        if (!framework.has(p.filename)) unknownFiles[p.filename] = (unknownFiles[p.filename] ?? 0) + 1;
    }

    return {
        total: processes.length,
        knownFramework: processes.length - sum(Object.values(unknownFiles)),
        unknownOrExternal: sum(Object.values(unknownFiles)),
        processManagers: processes.filter(p => p.filename === "process.js").length,
        weakenWorkers: processes.filter(p => p.filename === "weaken.js").length,
        growWorkers: processes.filter(p => p.filename === "grow.js").length,
        hackWorkers: processes.filter(p => p.filename === "hack.js").length,
        shareManagers: processes.filter(p => p.filename === "rent-capacity.js").length,
        shareWorkers: processes.filter(p => p.filename === "rent-share.js").length,
        xpFarmManagers: processes.filter(p => p.filename === "xp-farm.js").length,
        byFilename,
        byHost,
        unknownFiles
    };
}

function buildActionSuggestions(ctx) {
    const suggestions = [];

    if ((ctx.runtime.summary.rootedUnmanagedMoneyTargets ?? 0) > 0) {
        suggestions.push({
            id: "unmanaged-rooted-money-targets",
            priority: "high",
            category: "target-management",
            observation: `${ctx.runtime.summary.rootedUnmanagedMoneyTargets} rooted money target(s) appear unmanaged.`,
            recommendedCommand: "run assign-targets.js 1 4 false true 128 8",
            aiPrompt: "Review assign-targets.js and process.js assumptions. Ensure rooted low-RAM money targets are remotely managed."
        });
    }

    if ((ctx.runtime.summary.unmanagedTargets ?? 0) > 0) {
        suggestions.push({
            id: "unmanaged-money-targets",
            priority: (ctx.runtime.summary.rootedUnmanagedMoneyTargets ?? 0) > 0 ? "high" : "medium",
            category: "target-management",
            observation: `${ctx.runtime.summary.unmanagedTargets} money target(s) appear unmanaged; ${ctx.runtime.summary.rootedUnmanagedMoneyTargets ?? 0} are rooted.`,
            recommendedCommand: "run upload.js; run assign-targets.js 1 4 false true 128 8",
            aiPrompt: "Separate unrooted from rooted-unmanaged targets before changing allocator logic."
        });
    }

    if ((ctx.security.summary.rootedNotReadyTargets ?? 0) > 0 || ctx.security.summary.totalSecurityExcess > 0) {
        suggestions.push({
            id: "security-pressure",
            priority: "high",
            category: "security",
            observation: `${ctx.security.summary.notReadyTargets} target(s) are above the configured security buffer. Total excess: ${ctx.security.summary.totalSecurityExcess.toFixed(2)}.`,
            recommendedCommand: "run manager-console.js security",
            aiPrompt: "Review process.js weakening logic, thread allocation, and whether securityBuffer is appropriate."
        });
    }

    if ((ctx.money.summary.lowMoneyTargets ?? 0) > 0) {
        suggestions.push({
            id: "money-low",
            priority: "medium",
            category: "money",
            observation: `${ctx.money.summary.lowMoneyTargets} target(s) are below the money threshold. Current network money is ${ctx.money.summary.moneyPct.toFixed(1)}% of max.`,
            recommendedCommand: "run manager-console.js money",
            aiPrompt: "Review grow backlog, moneyTargetRatio, and whether grow workers are being starved."
        });
    }

    const unrooted = ctx.runtime.summary.unrootedServers ?? 0;
    if (unrooted > 0) {
        suggestions.push({
            id: "unrooted-servers",
            priority: "medium",
            category: "rooting",
            observation: `${unrooted} discovered server(s) are not rooted.`,
            recommendedCommand: "run upload.js",
            aiPrompt: "Review rooting/deployment flow and whether more port programs are needed."
        });
    }

    if ((ctx.contracts.validUniqueContracts ?? 0) > 0) {
        suggestions.push({
            id: "contracts-discovered",
            priority: "medium",
            category: "contracts",
            observation: `${ctx.contracts.validUniqueContracts} unique valid coding contract(s) discovered.`,
            recommendedCommand: "run info-contracts.js",
            aiPrompt: "Design a safe solve-contracts.js architecture, but avoid failed attempts without solver confidence."
        });
    }

    if (ctx.purchasedServers.count === 0 && ctx.purchasedServers.apiAvailable) {
        suggestions.push({
            id: "purchased-server-registry-empty",
            priority: "low",
            category: "purchased-servers",
            observation: "Purchased/cloud server API is available, but no bought servers were detected.",
            recommendedCommand: "run buy-servers.js 0.01",
            aiPrompt: "Refresh the purchased-server registry and verify whether bought servers already exist."
        });
    }

    return suggestions;
}

function buildAiPrompts(ctx) {
    return {
        recommendedNextPrompt: "Review this Bitburner diagnostic JSON. Prioritise the actionSuggestions with priority high or medium. For each issue, explain likely cause, safest command, and whether a script change is recommended.",
        shortPrompt: "Review this Bitburner diagnostic JSON and tell me the next three operational or code changes to make, in priority order.",
        codeReviewPrompt: "Review this Bitburner diagnostic JSON as if maintaining the automation suite. Identify broken assumptions, process conflicts, missing script coverage, and scripts that should be rewritten.",
        tuningPrompt: "Review money, security, payout, runtime, and share sections. Recommend tuning values for securityBuffer, moneyTargetRatio, hackTargetRatio, remote assignment, and share/rent capacity.",
        architecturePrompt: "Suggest how to evolve the manager-console suite. Keep worker scripts minimal. Prefer independent info-* scripts over complex imports unless clearly beneficial.",
        immediateFocus: {
            highPriorityCount: ctx.actionSuggestions.filter(a => a.priority === "high").length,
            mediumPriorityCount: ctx.actionSuggestions.filter(a => a.priority === "medium").length,
            topIssues: ctx.actionSuggestions.filter(a => a.priority === "high" || a.priority === "medium").slice(0, 5)
        },
        environmentSummaryForPrompt: {
            servers: ctx.network.total,
            rooted: ctx.network.rooted,
            moneyServers: ctx.network.moneyServers,
            ramUsedPct: ctx.network.ramUsedPct,
            moneyPct: ctx.network.moneyPct,
            totalProcesses: ctx.processSummary.total,
            unknownProcesses: ctx.processSummary.unknownOrExternal,
            contractsUniqueValid: ctx.contracts.validUniqueContracts,
            contractsRawFiles: ctx.contracts.rawContractFilesFound,
            contractsDuplicatesSuppressed: ctx.contracts.duplicateFilesSuppressed
        }
    };
}

function findManager(processes, target) {
    const local = processes.find(p => p.host === target && p.filename === "process.js" && p.args.length > 0 && String(p.args[0]) === target);
    if (local) return { kind: "local", host: target, pid: local.pid };

    const remote = processes.find(p => p.host !== target && p.filename === "process.js" && p.args.length > 0 && String(p.args[0]) === target);
    if (remote) return { kind: `remote@${remote.host}`, host: remote.host, pid: remote.pid };

    return { kind: "none", host: null, pid: null };
}

function findCycle(processes, target) {
    for (const script of ["hack.js", "grow.js", "weaken.js"]) {
        const proc = processes.find(p => p.filename === script && p.args.length > 0 && String(p.args[0]) === target);
        if (proc) return { text: `${script.replace(".js", "")}@${proc.host} ${proc.threads}t`, host: proc.host, pid: proc.pid, script };
    }
    return { text: "idle", host: null, pid: null, script: null };
}

function allProcesses(ns, servers) {
    const rows = [];
    for (const host of servers) {
        for (const proc of safeCall(() => ns.ps(host), [])) {
            rows.push({
                host,
                pid: proc.pid,
                filename: proc.filename,
                threads: proc.threads,
                args: proc.args ?? []
            });
        }
    }
    return rows;
}

function getAllServers(ns, start) {
    const seen = new Set();
    const stack = [start];

    while (stack.length > 0) {
        const server = stack.pop();
        if (seen.has(server)) continue;
        seen.add(server);
        for (const next of safeCall(() => ns.scan(server), [])) {
            if (!seen.has(next)) stack.push(next);
        }
    }

    return [...seen];
}

function readJson(ns, file) {
    try {
        if (!ns.fileExists(file, "home")) return null;
        const text = ns.read(file);
        if (!text) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function safeCall(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

function sum(values) {
    return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function pct(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return (value / max) * 100;
}

function stableStringify(value) {
    try {
        return JSON.stringify(value, (_key, val) => typeof val === "bigint" ? val.toString() : val);
    } catch {
        return String(value);
    }
}

function fmtRam(ns, value, decimals = 2) {
    if (!Number.isFinite(value)) return "-";
    try {
        if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(value, decimals);
    } catch {}
    return `${Number(value).toFixed(decimals)}GB`;
}

function fmtMoney(ns, value) {
    if (!Number.isFinite(value)) return "-";
    try {
        if (ns.format && typeof ns.format.money === "function") return ns.format.money(value);
    } catch {}
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}t`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;
    return `$${Number(value).toFixed(0)}`;
}

function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "now";
    const seconds = Math.ceil(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}