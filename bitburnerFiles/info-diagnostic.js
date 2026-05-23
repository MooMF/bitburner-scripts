/**
 * info-diagnostic.js
 *
 * Consolidated AI diagnostic handoff for the Bitburner manager-console suite.
 *
 * Purpose:
 *   Build one JSON package containing:
 *   - existing manager reports;
 *   - full server inventory;
 *   - all running processes, including unrelated/unknown scripts;
 *   - purchased server state;
 *   - discovered coding contracts;
 *   - stock-market placeholder/snapshot;
 *   - future subsystem placeholders;
 *   - AI-ready prompts and action suggestions based on current runtime state.
 *
 * Usage:
 *   run info-diagnostic.js
 *   run info-diagnostic.js silent
 *
 * Output:
 *   /data/manager/ai-diagnostic.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const silent = String(ns.args[0] || "").toLowerCase() === "silent";
    const outputFile = "/data/manager/ai-diagnostic.json";

    if (!silent) {
        ns.clearLog();
        openConsole(ns, 1180, 720);
    }

    await refreshKnownReports(ns);

    const timestamp = Date.now();
    const servers = scanAll(ns);

    const managerReports = {
        runtime: readJson(ns, "/data/manager/runtime.json", null),
        money: readJson(ns, "/data/manager/money.json", null),
        security: readJson(ns, "/data/manager/security.json", null),
        payouts: readJson(ns, "/data/manager/payouts.json", null),
        share: readJson(ns, "/data/manager/share.json", null),
    };

    const serverInventory = buildServerInventory(ns, servers);
    const processInventory = buildProcessInventory(ns, servers);
    const processSummary = summarizeProcesses(processInventory);
    const purchasedServerState = buildPurchasedServerState(ns);
    const contracts = buildContractSnapshot(ns);
    const stockMarket = buildStockMarketSnapshot(ns);
    const futureSystems = buildFutureSystemsSnapshot(ns);

    const summaries = {
        network: summarizeNetwork(serverInventory),
        processes: processSummary,
        purchasedServers: purchasedServerState.summary,
        contracts: contracts.summary,
        stockMarket: stockMarket.summary,
        futureSystems: futureSystems.summary,
    };

    const actionSuggestions = buildActionSuggestions({
        ns,
        managerReports,
        summaries,
        serverInventory,
        processInventory,
        purchasedServerState,
        contracts,
        stockMarket,
        futureSystems,
    });

    const aiPrompts = buildAiPrompts({
        actionSuggestions,
        summaries,
        managerReports,
        contracts,
        stockMarket,
        processSummary,
    });

    const diagnostic = {
        context: "Bitburner manager-console AI diagnostic package",
        schemaVersion: 2,
        generatedAt: timestamp,
        generatedAtText: new Date(timestamp).toISOString(),

        operatingAssumptions: {
            bitburnerApi: "v3.x",
            primaryEntryPoint: "check-infection.js",
            managerEntryPoint: "manager-console.js",
            reportDirectory: "/data/manager/",
            note: "Upload this JSON into a prompt when asking for tuning, bug-fixing, refactoring, or new process design.",
        },

        howToUseThisPackage: {
            uploadInstruction: "Upload /data/manager/ai-diagnostic.json into ChatGPT and ask it to review current system state.",
            recommendedPrompt: "Review this Bitburner diagnostic JSON. Identify bottlenecks, broken assumptions, missing scripts, and the next safest code changes. Prioritise fixes that improve automation reliability.",
            copyPasteCommand: "run info-diagnostic.js",
        },

        filesExpectedOnHome: [
            "check-infection.js",
            "manager-console.js",
            "info-runtime.js",
            "info-money.js",
            "info-security.js",
            "info-payouts.js",
            "info-share.js",
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
            "buy-servers.js",
            "clean.js",
            "logview.js",
        ],

        existingManagerReports: managerReports,

        summaries,

        actionSuggestions,
        aiPrompts,

        serverInventory,
        processInventory,
        purchasedServerState,
        contracts,
        stockMarket,
        futureSystems,
    };

    const safeJson = JSON.stringify(sanitizeForJson(diagnostic), null, 2);
    ns.write(outputFile, safeJson, "w");

    if (!silent) {
        printSummary(ns, diagnostic, outputFile, safeJson.length);
    }
}

/**
 * Refresh child reports before building the AI package.
 * Missing child scripts are ignored, so this script remains useful even during partial installs.
 */
async function refreshKnownReports(ns) {
    const childScripts = [
        "info-runtime.js",
        "info-money.js",
        "info-security.js",
        "info-payouts.js",
        "info-share.js",
        "info-contracts.js",
    ];

    const stamp = Date.now();
    const pids = [];

    for (const script of childScripts) {
        if (!ns.fileExists(script, "home")) continue;

        const pid = ns.run(script, 1, "silent", stamp);
        if (pid) pids.push(pid);
    }

    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
        const stillRunning = pids.some(pid => ns.isRunning(pid));
        if (!stillRunning) return;
        await ns.sleep(200);
    }
}

function buildServerInventory(ns, servers) {
    const purchasedServers = safeCall(() => ns.getPurchasedServers(), []);

    const rows = [];

    for (const server of servers) {
        const rooted = safeCall(() => ns.hasRootAccess(server), false);
        const requiredHackLevel = safeCall(() => ns.getServerRequiredHackingLevel(server), null);
        const portsRequired = safeCall(() => ns.getServerNumPortsRequired(server), null);

        const maxRam = safeCall(() => ns.getServerMaxRam(server), 0);
        const usedRam = safeCall(() => ns.getServerUsedRam(server), 0);
        const freeRam = Math.max(0, maxRam - usedRam);

        const maxMoney = safeCall(() => ns.getServerMaxMoney(server), 0);
        const money = safeCall(() => ns.getServerMoneyAvailable(server), 0);

        const minSecurity = safeCall(() => ns.getServerMinSecurityLevel(server), 0);
        const security = safeCall(() => ns.getServerSecurityLevel(server), 0);

        const files = safeCall(() => ns.ls(server), []);
        const contracts = files.filter(f => String(f).endsWith(".cct"));

        rows.push({
            server,
            rooted,
            purchased: server !== "home" && purchasedServers.includes(server),
            hasMoney: maxMoney > 0,

            hacking: {
                requiredLevel: requiredHackLevel,
                portsRequired,
            },

            ram: {
                max: maxRam,
                used: usedRam,
                free: freeRam,
                usedPct: maxRam > 0 ? usedRam / maxRam * 100 : 0,
            },

            money: {
                current: money,
                max: maxMoney,
                pct: maxMoney > 0 ? money / maxMoney * 100 : 0,
            },

            security: {
                current: security,
                min: minSecurity,
                aboveMin: Math.max(0, security - minSecurity),
            },

            timings: {
                hackMs: maxMoney > 0 ? safeCall(() => ns.getHackTime(server), null) : null,
                growMs: maxMoney > 0 ? safeCall(() => ns.getGrowTime(server), null) : null,
                weakenMs: maxMoney > 0 ? safeCall(() => ns.getWeakenTime(server), null) : null,
            },

            files: {
                count: files.length,
                contracts,
                hasProcess: files.includes("process.js"),
                hasWeaken: files.includes("weaken.js"),
                hasGrow: files.includes("grow.js"),
                hasHack: files.includes("hack.js"),
                hasRentShare: files.includes("rent-share.js"),
                hasRentCapacity: files.includes("rent-capacity.js"),
            },
        });
    }

    return rows.sort((a, b) => a.server.localeCompare(b.server));
}

function buildProcessInventory(ns, servers) {
    const rows = [];

    for (const host of servers) {
        const processes = safeCall(() => ns.ps(host), []);

        for (const proc of processes) {
            const filename = String(proc.filename || "");
            const args = Array.isArray(proc.args) ? proc.args.map(a => String(a)) : [];
            const targetGuess = args.length > 0 ? args[0] : host;

            rows.push({
                host,
                pid: proc.pid,
                filename,
                args,
                threads: proc.threads || 0,

                classification: classifyProcess(filename, args, host),

                targetGuess,

                framework: {
                    isKnownFrameworkScript: isKnownFrameworkScript(filename),
                    isWorker: ["weaken.js", "grow.js", "hack.js"].includes(filename),
                    isManager: filename === "process.js",
                    isShareWorker: filename === "rent-share.js",
                    isShareManager: filename === "rent-capacity.js",
                    isConsole: filename === "manager-console.js" || filename.startsWith("info-"),
                },
            });
        }
    }

    return rows.sort((a, b) =>
        a.host.localeCompare(b.host) ||
        String(a.filename).localeCompare(String(b.filename)) ||
        Number(a.pid || 0) - Number(b.pid || 0)
    );
}

function summarizeProcesses(processes) {
    const summary = {
        total: processes.length,

        knownFramework: 0,
        unknownOrExternal: 0,

        processManagers: 0,
        weakenWorkers: 0,
        growWorkers: 0,
        hackWorkers: 0,
        shareManagers: 0,
        shareWorkers: 0,
        consoleScripts: 0,

        byFilename: {},
        byHost: {},
        unknownFiles: {},
    };

    for (const p of processes) {
        if (p.framework.isKnownFrameworkScript) {
            summary.knownFramework++;
        } else {
            summary.unknownOrExternal++;
            summary.unknownFiles[p.filename] = (summary.unknownFiles[p.filename] || 0) + 1;
        }

        if (p.filename === "process.js") summary.processManagers++;
        if (p.filename === "weaken.js") summary.weakenWorkers++;
        if (p.filename === "grow.js") summary.growWorkers++;
        if (p.filename === "hack.js") summary.hackWorkers++;
        if (p.filename === "rent-capacity.js") summary.shareManagers++;
        if (p.filename === "rent-share.js") summary.shareWorkers++;
        if (p.framework.isConsole) summary.consoleScripts++;

        summary.byFilename[p.filename] = (summary.byFilename[p.filename] || 0) + 1;
        summary.byHost[p.host] = (summary.byHost[p.host] || 0) + 1;
    }

    return summary;
}

function buildPurchasedServerState(ns) {
    const purchased = safeCall(() => ns.getPurchasedServers(), []);
    const rows = [];

    let totalRam = 0;
    let usedRam = 0;

    for (const server of purchased) {
        const max = safeCall(() => ns.getServerMaxRam(server), 0);
        const used = safeCall(() => ns.getServerUsedRam(server), 0);
        totalRam += max;
        usedRam += used;

        rows.push({
            server,
            ram: {
                max,
                used,
                free: Math.max(0, max - used),
                usedPct: max > 0 ? used / max * 100 : 0,
            },
            processes: safeCall(() => ns.ps(server), []).map(p => ({
                pid: p.pid,
                filename: p.filename,
                threads: p.threads,
                args: Array.isArray(p.args) ? p.args.map(String) : [],
            })),
        });
    }

    const limit = safeCall(() => ns.getPurchasedServerLimit(), null);
    const maxRam = safeCall(() => ns.getPurchasedServerMaxRam(), null);

    return {
        summary: {
            count: purchased.length,
            limit,
            maxServerRam: maxRam,
            totalRam,
            usedRam,
            freeRam: Math.max(0, totalRam - usedRam),
            usedPct: totalRam > 0 ? usedRam / totalRam * 100 : 0,
            restartRequired: safeCall(() => ns.fileExists("restart-required.txt", "home"), false),
        },
        servers: rows.sort((a, b) => a.server.localeCompare(b.server)),
    };
}

function buildContractSnapshot(ns) {
    const report = readJson(ns, "/data/manager/contracts.json", null);

    if (!report) {
        return {
            summary: {
                serversScanned: 0,
                rawContractFilesFound: 0,
                uniqueContracts: 0,
                duplicateFilesSuppressed: 0,
                validUniqueContracts: 0,
                invalidUniqueContractFiles: 0,
                homePreferredContracts: 0,
                remotePreferredContracts: 0,
                byType: {},
                implemented: "read-only inventory unavailable",
                solverImplemented: false,
                warning: "info-contracts.js has not generated /data/manager/contracts.json yet.",
                nextScriptCandidate: "info-contracts.js",
            },
            contracts: [],
            duplicates: [],
            rawContracts: [],
        };
    }

    const summary = report.summary || {};

    return {
        summary: {
            serversScanned: summary.serversScanned || 0,

            rawContractFilesFound: summary.rawContractFilesFound || 0,
            uniqueContracts: summary.uniqueContracts || 0,
            duplicateFilesSuppressed: summary.duplicateFilesSuppressed || 0,

            validUniqueContracts: summary.validUniqueContracts || 0,
            invalidUniqueContractFiles: summary.invalidUniqueContractFiles || 0,

            homePreferredContracts: summary.homePreferredContracts || 0,
            remotePreferredContracts: summary.remotePreferredContracts || 0,

            byType: summary.byType || {},

            implemented: summary.implemented || "read-only inventory",
            solverImplemented: Boolean(summary.solverImplemented),
            warning: summary.warning || "No solve attempts are made by the contract inventory.",
            dedupeRule: summary.dedupeRule || "fileName + fileSize",
            preferenceRule: summary.preferenceRule || "home first, then valid, then higher tries remaining",

            nextScriptCandidate: "solve-contracts.js",
        },

        contracts: report.contracts || [],
        duplicates: report.duplicates || [],
        rawContracts: report.rawContracts || [],
    };
}

function buildStockMarketSnapshot(ns) {
    const result = {
        summary: {
            available: false,
            hasTixApi: false,
            has4SData: false,
            symbols: 0,
            positions: 0,
            implemented: false,
        },
        symbols: [],
        positions: [],
        note: "Stock trading process is not yet implemented. This section is present so the AI package schema does not need to change later.",
    };

    if (!ns.stock) return result;

    result.summary.available = true;

    const symbols = safeCall(() => ns.stock.getSymbols(), []);

    result.symbols = symbols.map(sym => {
        const position = safeCall(() => ns.stock.getPosition(sym), null);
        const price = safeCall(() => ns.stock.getPrice(sym), null);
        const forecast = safeCall(() => ns.stock.getForecast(sym), null);
        const volatility = safeCall(() => ns.stock.getVolatility(sym), null);

        const longShares = Array.isArray(position) ? position[0] : 0;
        const longAvg = Array.isArray(position) ? position[1] : 0;
        const shortShares = Array.isArray(position) ? position[2] : 0;
        const shortAvg = Array.isArray(position) ? position[3] : 0;

        if (longShares > 0 || shortShares > 0) {
            result.summary.positions++;
            result.positions.push({
                symbol: sym,
                longShares,
                longAvg,
                shortShares,
                shortAvg,
                price,
                forecast,
                volatility,
            });
        }

        return {
            symbol: sym,
            price,
            forecast,
            volatility,
            hasPosition: longShares > 0 || shortShares > 0,
        };
    });

    result.summary.symbols = result.symbols.length;
    result.summary.hasTixApi = result.summary.symbols > 0;
    result.summary.has4SData = result.symbols.some(s => s.forecast !== null || s.volatility !== null);

    return result;
}

function buildFutureSystemsSnapshot(ns) {
    return {
        summary: {
            contracts: "placeholder-present",
            stockMarket: ns.stock ? "api-detected-or-stubbed" : "not-detected",
            darkWeb: "placeholder-empty",
            factions: "placeholder-empty",
            augmentations: "placeholder-empty",
            corporations: "placeholder-empty",
            gangs: "placeholder-empty",
            sleeves: "placeholder-empty",
            bladeburner: "placeholder-empty",
            hacknet: "placeholder-empty",
        },

        darkWeb: {
            implemented: false,
            programsOwned: detectPrograms(ns),
            missingPrograms: detectMissingPrograms(ns),
            note: "Can later become info-darkweb.js or buy-programs.js.",
        },

        factions: {
            implemented: false,
            joined: [],
            invitations: [],
            note: "Singularity-dependent faction automation intentionally not implemented yet.",
        },

        augmentations: {
            implemented: false,
            owned: [],
            available: [],
            note: "Singularity-dependent augmentation planning intentionally not implemented yet.",
        },

        corporations: {
            implemented: false,
            state: null,
            note: "Corporation automation not yet implemented.",
        },

        gangs: {
            implemented: false,
            state: null,
            note: "Gang automation not yet implemented.",
        },

        sleeves: {
            implemented: false,
            state: null,
            note: "Sleeve automation not yet implemented.",
        },

        bladeburner: {
            implemented: false,
            state: null,
            note: "Bladeburner automation not yet implemented.",
        },

        hacknet: {
            implemented: false,
            state: null,
            note: "Hacknet automation not yet implemented.",
        },
    };
}

function buildActionSuggestions(context) {
    const {
        managerReports,
        summaries,
        processInventory,
        purchasedServerState,
        contracts,
        stockMarket,
        futureSystems,
    } = context;

    const suggestions = [];

    const runtime = managerReports.runtime && managerReports.runtime.summary;
    const money = managerReports.money && managerReports.money.summary;
    const security = managerReports.security && managerReports.security.summary;
    const payouts = managerReports.payouts && managerReports.payouts.summary;
    const share = managerReports.share && managerReports.share.summary;
    const network = summaries.network;
    const processes = summaries.processes;

    // Compatibility layer for old/new info-share.js schemas.
    // Current info-share.js fields:
    //   shareWorkers, shareThreads, idleShareCapableRam, possibleExtraThreads
    // Older diagnostic assumptions:
    //   workerProcesses, workerThreads, spareShareRam
    const shareManagerRunning = Boolean(share && share.managerRunning);

    const shareWorkers = share
        ? firstNumber([share.shareWorkers, share.workerProcesses], 0)
        : 0;

    const shareThreads = share
        ? firstNumber([share.shareThreads, share.workerThreads], 0)
        : 0;

    const spareShareRam = share
        ? firstNumber([share.idleShareCapableRam, share.spareShareRam, share.shareCapableFreeRam], 0)
        : 0;

    const possibleExtraThreads = share
        ? firstNumber([share.possibleExtraThreads], 0)
        : 0;

    addSuggestion(suggestions, {
        id: "deployment-restart-required",
        priority: "high",
        category: "deployment",
        condition: purchasedServerState.summary.restartRequired,
        observation: "restart-required.txt exists, which normally means purchased/cloud server capacity changed.",
        recommendedCommand: "run startup.js true false",
        aiPrompt: "The diagnostic shows restart-required.txt is present. Review whether startup.js, upload.js, and assign-targets.js will correctly redeploy after server purchases/upgrades. Suggest any safe changes.",
    });

    function firstNumber(values, fallback = 0) {
        for (const value of values) {
            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }

        return fallback;
    }

    addSuggestion(suggestions, {
        id: "unrooted-servers",
        priority: "medium",
        category: "rooting",
        condition: network.unrooted > 0,
        observation: `${network.unrooted} discovered server(s) are not rooted.`,
        recommendedCommand: "run upload.js",
        aiPrompt: "The diagnostic shows unrooted servers. Review the rooting/deployment flow and suggest whether upload.js or a dedicated root-all script should be improved.",
    });

    addSuggestion(suggestions, {
        id: "unmanaged-money-targets",
        priority: "high",
        category: "target-management",
        condition: runtime && runtime.unmanagedTargets > 0,
        observation: runtime ? `${runtime.unmanagedTargets} money target(s) appear unmanaged.` : "Runtime report missing; cannot verify managed targets.",
        recommendedCommand: "run assign-targets.js 1 2",
        aiPrompt: "The diagnostic shows unmanaged money targets. Review assign-targets.js and process.js assumptions. Suggest changes to ensure low-RAM money targets are remotely managed.",
    });

    addSuggestion(suggestions, {
        id: "payload-missing",
        priority: "high",
        category: "deployment",
        condition: runtime && runtime.payloadMissing > 0,
        observation: runtime ? `${runtime.payloadMissing} server(s) appear to be missing one or more payload scripts.` : "Runtime report missing; cannot verify payload deployment.",
        recommendedCommand: "run upload.js",
        aiPrompt: "The diagnostic shows payload gaps. Review upload.js file lists and deployment logic. Suggest changes to make script propagation reliable.",
    });

    addSuggestion(suggestions, {
        id: "security-pressure",
        priority: "high",
        category: "security",
        condition: security && security.notReadyTargets > 0,
        observation: security ? `${security.notReadyTargets} target(s) are above the configured security buffer. Total excess: ${round(security.totalSecurityExcess, 2)}.` : "Security report missing.",
        recommendedCommand: "run manager-console.js security",
        aiPrompt: "The diagnostic shows targets blocked by security. Review process.js weakening logic, thread allocation, and whether securityBuffer is appropriate. Suggest tuning changes.",
    });

    addSuggestion(suggestions, {
        id: "money-low",
        priority: "medium",
        category: "money",
        condition: money && money.lowMoneyTargets > 0,
        observation: money ? `${money.lowMoneyTargets} target(s) are below the money threshold. Current network money is ${round(money.moneyPct, 1)}% of max.` : "Money report missing.",
        recommendedCommand: "run manager-console.js money",
        aiPrompt: "The diagnostic shows a grow backlog. Review process.js grow logic, moneyTargetRatio, and remote worker capacity. Suggest tuning changes.",
    });

    addSuggestion(suggestions, {
        id: "low-hack-readiness",
        priority: "medium",
        category: "payouts",
        condition: payouts && payouts.hackReadyTargets === 0,
        observation: payouts ? "No targets currently appear hack-ready." : "Payout report missing.",
        recommendedCommand: "run manager-console.js payouts",
        aiPrompt: "The diagnostic shows no hack-ready targets. Determine whether the system is correctly preparing targets or whether process.js is stuck in weaken/grow cycles.",
    });

    addSuggestion(suggestions, {
        id: "unknown-processes",
        priority: "informational",
        category: "process-inventory",
        condition: processes.unknownOrExternal > 0,
        observation: `${processes.unknownOrExternal} running process(es) are outside the known framework scripts.`,
        recommendedCommand: "run info-diagnostic.js",
        aiPrompt: "The diagnostic includes unknown/external running processes. Review processInventory and classify whether these should be ignored, adopted into the framework, or killed by clean.js.",
    });

    addSuggestion(suggestions, {
        id: "share-manager-missing",
        priority: "medium",
        category: "share-rental",
        condition: share && !shareManagerRunning && spareShareRam > 0,
        observation: share
            ? `Share/rental capacity appears available but rent-capacity.js is not running. Spare share RAM: ${round(spareShareRam, 2)}GB; possible extra threads: ${possibleExtraThreads}.`
            : "Share report missing.",
        recommendedCommand: "run startup.js true false",
        aiPrompt: "The diagnostic suggests spare share/rental capacity is available but the share manager is not running. Review startup.js, rent-capacity.js, and info-share.js integration.",
    });

    addSuggestion(suggestions, {
        id: "share-active-review",
        priority: "low",
        category: "share-rental",
        condition: share && shareManagerRunning,
        observation: share
            ? `Share manager is running. Share workers: ${shareWorkers}; share threads: ${shareThreads}; spare share RAM: ${round(spareShareRam, 2)}GB; possible extra threads: ${possibleExtraThreads}.`
            : "Share report missing.",
        recommendedCommand: "run manager-console.js share",
        aiPrompt: "The diagnostic shows active share/rental workers. Review whether share RAM reservation is too aggressive or too conservative relative to money-making workers.",
    });

    addSuggestion(suggestions, {
        id: "contracts-discovered",
        priority: (contracts.summary.validUniqueContracts || 0) > 0 ? "medium" : "low",
        category: "contracts",
        condition: true,
        observation: (contracts.summary.validUniqueContracts || 0) > 0
            ? `${contracts.summary.validUniqueContracts} unique valid coding contract(s) discovered. Raw files: ${contracts.summary.rawContractFilesFound || 0}; duplicates suppressed: ${contracts.summary.duplicateFilesSuppressed || 0}.`
            : "No unique valid coding contracts discovered. Contract subsystem placeholder is present.",
        recommendedCommand: (contracts.summary.validUniqueContracts || 0) > 0 ? "run info-contracts.js" : null,
        aiPrompt: (contracts.summary.validUniqueContracts || 0) > 0
            ? "The diagnostic discovered de-duplicated coding contracts. Review /data/manager/contracts.json. Design a safe solve-contracts.js architecture, but do not risk failed attempts without solver confidence."
            : "No valid unique coding contracts are currently discovered. Keep contract support as a future subsystem placeholder.",
    });

    addSuggestion(suggestions, {
        id: "stock-market-placeholder",
        priority: stockMarket.summary.positions > 0 ? "medium" : "low",
        category: "stock-market",
        condition: true,
        observation: stockMarket.summary.positions > 0
            ? `${stockMarket.summary.positions} stock position(s) detected. Stock automation is not implemented.`
            : "Stock market automation is not implemented. Placeholder is present.",
        recommendedCommand: stockMarket.summary.positions > 0 ? "run info-diagnostic.js" : null,
        aiPrompt: stockMarket.summary.positions > 0
            ? "The diagnostic detected stock positions. Design info-stocks.js before any automated trading script. Prioritise observation and risk reporting first."
            : "Stock automation is not currently active. Propose a read-only info-stocks.js before any trading automation.",
    });

    addSuggestion(suggestions, {
        id: "darkweb-programs",
        priority: futureSystems.darkWeb.missingPrograms.length > 0 ? "low" : "informational",
        category: "dark-web",
        condition: true,
        observation: futureSystems.darkWeb.missingPrograms.length > 0
            ? `Missing dark-web/program files: ${futureSystems.darkWeb.missingPrograms.join(", ")}.`
            : "All tracked program files appear to exist on home.",
        recommendedCommand: null,
        aiPrompt: "Review the missing/owned program list and suggest whether a future dark-web helper should be created. Avoid Singularity dependency unless explicitly available.",
    });

    addSuggestion(suggestions, {
        id: "purchased-server-capacity",
        priority: purchasedServerState.summary.freeRam > 0 ? "low" : "informational",
        category: "purchased-servers",
        condition: true,
        observation: `Purchased servers: ${purchasedServerState.summary.count}/${purchasedServerState.summary.limit}. RAM used: ${round(purchasedServerState.summary.usedPct, 1)}%.`,
        recommendedCommand: purchasedServerState.summary.count < purchasedServerState.summary.limit ? "run buy-servers.js 0.4" : null,
        aiPrompt: "Review purchased server capacity. Suggest whether buy-servers.js should buy, upgrade, or hold based on current fleet and money-making state.",
    });

    return suggestions;
}

function addSuggestion(suggestions, item) {
    if (!item.condition) return;

    suggestions.push({
        id: item.id,
        priority: item.priority || "informational",
        category: item.category || "general",
        observation: item.observation || "",
        recommendedCommand: item.recommendedCommand || null,
        aiPrompt: item.aiPrompt || "",
    });
}

function buildAiPrompts(context) {
    const {
        actionSuggestions,
        summaries,
        contracts,
        stockMarket,
        processSummary,
    } = context;

    const highPriority = actionSuggestions.filter(s => s.priority === "high");
    const mediumPriority = actionSuggestions.filter(s => s.priority === "medium");

    const topSuggestions = [...highPriority, ...mediumPriority].slice(0, 5);

    const recommendedNextPrompt = topSuggestions.length > 0
        ? [
            "Review this Bitburner diagnostic JSON.",
            "Prioritise the actionSuggestions with priority high or medium.",
            "For each issue, explain the likely cause, the safest immediate command, and whether a script change is recommended.",
            "If script changes are recommended, rewrite the complete affected scripts for copy/paste.",
        ].join(" ")
        : [
            "Review this Bitburner diagnostic JSON.",
            "The system does not show obvious high-priority issues.",
            "Look for tuning opportunities, simplification opportunities, stale assumptions, and future subsystem candidates.",
        ].join(" ");

    return {
        recommendedNextPrompt,

        shortPrompt: "Review this Bitburner diagnostic JSON and tell me the next three operational or code changes to make, in priority order.",

        codeReviewPrompt: "Review this Bitburner diagnostic JSON as if you are maintaining the automation suite. Identify broken assumptions, process conflicts, missing script coverage, and any scripts that should be rewritten. Provide complete copy/paste scripts where needed.",

        tuningPrompt: "Review the money, security, payout, runtime, and share sections. Recommend tuning values for securityBuffer, moneyTargetRatio, hackTargetRatio, remote assignment, and share/rent capacity.",

        architecturePrompt: "Review this diagnostic JSON and suggest how to evolve the manager-console suite. Keep worker scripts minimal. Prefer independent info-* scripts over complex imports unless there is a clear benefit.",

        subsystemPrompt: "Review the placeholder subsystems: contracts, stock market, dark web, factions, augmentations, corporations, gangs, sleeves, bladeburner, and hacknet. Recommend the safest next read-only info-* script to add.",

        generatedActionPrompts: actionSuggestions.map(s => ({
            id: s.id,
            priority: s.priority,
            category: s.category,
            prompt: s.aiPrompt,
        })),

        immediateFocus: {
            highPriorityCount: highPriority.length,
            mediumPriorityCount: mediumPriority.length,
            topIssues: topSuggestions.map(s => ({
                id: s.id,
                priority: s.priority,
                observation: s.observation,
                recommendedCommand: s.recommendedCommand,
            })),
        },

        environmentSummaryForPrompt: {
            servers: summaries.network.total,
            rooted: summaries.network.rooted,
            moneyServers: summaries.network.moneyServers,
            ramUsedPct: summaries.network.ramUsedPct,
            moneyPct: summaries.network.moneyPct,
            totalProcesses: processSummary.total,
            unknownProcesses: processSummary.unknownOrExternal,
            contractsUniqueValid: contracts.summary.validUniqueContracts || 0,
            contractsRawFiles: contracts.summary.rawContractFilesFound || 0,
            contractsDuplicatesSuppressed: contracts.summary.duplicateFilesSuppressed || 0,
            stockSymbols: stockMarket.summary.symbols,
            stockPositions: stockMarket.summary.positions,
        },
    };
}

function summarizeNetwork(serverInventory) {
    const summary = {
        total: serverInventory.length,
        rooted: 0,
        unrooted: 0,
        moneyServers: 0,
        purchasedServers: 0,

        totalRam: 0,
        usedRam: 0,
        freeRam: 0,
        ramUsedPct: 0,

        currentMoney: 0,
        maxMoney: 0,
        moneyPct: 0,

        totalSecurityAboveMin: 0,
    };

    for (const s of serverInventory) {
        if (s.rooted) summary.rooted++;
        else summary.unrooted++;

        if (s.hasMoney) summary.moneyServers++;
        if (s.purchased) summary.purchasedServers++;

        summary.totalRam += s.ram.max || 0;
        summary.usedRam += s.ram.used || 0;
        summary.freeRam += s.ram.free || 0;

        summary.currentMoney += s.money.current || 0;
        summary.maxMoney += s.money.max || 0;

        summary.totalSecurityAboveMin += s.security.aboveMin || 0;
    }

    summary.ramUsedPct = summary.totalRam > 0 ? summary.usedRam / summary.totalRam * 100 : 0;
    summary.moneyPct = summary.maxMoney > 0 ? summary.currentMoney / summary.maxMoney * 100 : 0;

    return summary;
}

function classifyProcess(filename, args, host) {
    if (filename === "process.js") return "target-manager";
    if (filename === "weaken.js") return "worker-weaken";
    if (filename === "grow.js") return "worker-grow";
    if (filename === "hack.js") return "worker-hack";
    if (filename === "rent-capacity.js") return "share-capacity-manager";
    if (filename === "rent-share.js") return "share-worker";
    if (filename === "manager-console.js") return "manager-console";
    if (filename.startsWith("info-")) return "manager-info-script";
    if (filename === "startup.js") return "startup-orchestrator";
    if (filename === "upload.js") return "deployment";
    if (filename === "assign-targets.js") return "remote-assignment";
    if (filename === "buy-servers.js") return "purchased-server-manager";
    if (filename === "clean.js") return "cleanup";
    if (filename === "logview.js") return "diagnostic-logviewer";
    if (filename.startsWith("infect")) return "legacy-infection";
    if (filename === "iteration.js") return "file-discovery";
    return `unknown-or-external@${host}`;
}

function isKnownFrameworkScript(filename) {
    return [
        "check-infection.js",
        "manager-console.js",
        "info-runtime.js",
        "info-money.js",
        "info-security.js",
        "info-payouts.js",
        "info-share.js",
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
        "buy-servers.js",
        "clean.js",
        "logview.js",
        "iteration.js",
        "infect.js",
        "infect-root.js",
        "infect-deploy.js",
        "infect-start.js",
    ].includes(filename);
}

function detectPrograms(ns) {
    const programs = [
        "BruteSSH.exe",
        "FTPCrack.exe",
        "relaySMTP.exe",
        "HTTPWorm.exe",
        "SQLInject.exe",
        "ServerProfiler.exe",
        "DeepscanV1.exe",
        "DeepscanV2.exe",
        "AutoLink.exe",
        "Formulas.exe",
    ];

    return programs.filter(p => ns.fileExists(p, "home"));
}

function detectMissingPrograms(ns) {
    const programs = [
        "BruteSSH.exe",
        "FTPCrack.exe",
        "relaySMTP.exe",
        "HTTPWorm.exe",
        "SQLInject.exe",
        "ServerProfiler.exe",
        "DeepscanV1.exe",
        "DeepscanV2.exe",
        "AutoLink.exe",
        "Formulas.exe",
    ];

    return programs.filter(p => !ns.fileExists(p, "home"));
}

function scanAll(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    for (let i = 0; i < queue.length; i++) {
        const host = queue[i];

        for (const next of ns.scan(host)) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }

    return [...seen].sort();
}

function readJson(ns, file, fallback) {
    try {
        if (!ns.fileExists(file, "home")) return fallback;
        const text = ns.read(file);
        if (!text || !text.trim()) return fallback;
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function safeCall(fn, fallback = null) {
    try {
        const value = fn();
        if (value === undefined) return fallback;
        return value;
    } catch {
        return fallback;
    }
}

function sanitizeForJson(value) {
    if (typeof value === "bigint") {
        return value.toString();
    }

    if (value === undefined) {
        return null;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) return null;
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(v => sanitizeForJson(v));
    }

    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = sanitizeForJson(value[key]);
    }

    return output;
}

function printSummary(ns, diagnostic, outputFile, byteLength) {
    const network = diagnostic.summaries.network;
    const processes = diagnostic.summaries.processes;
    const contracts = diagnostic.summaries.contracts;
    const stocks = diagnostic.summaries.stockMarket;
    const suggestions = diagnostic.actionSuggestions || [];
    const high = suggestions.filter(s => s.priority === "high");
    const medium = suggestions.filter(s => s.priority === "medium");

    ns.print("AI DIAGNOSTIC JSON PACKAGE");
    ns.print("=".repeat(100));
    ns.print(`Output:        ${outputFile}`);
    ns.print(`Size:          ${formatBytes(byteLength)}`);
    ns.print(`Generated:     ${diagnostic.generatedAtText}`);
    ns.print("");

    ns.print("NETWORK");
    ns.print("-".repeat(100));
    ns.print(`Servers:       ${network.total}`);
    ns.print(`Rooted:        ${network.rooted}/${network.total}`);
    ns.print(`Money servers: ${network.moneyServers}`);
    ns.print(`RAM:           ${formatGb(network.usedRam)} / ${formatGb(network.totalRam)} (${formatPct(network.ramUsedPct)})`);
    ns.print(`Money:         ${formatMoney(network.currentMoney)} / ${formatMoney(network.maxMoney)} (${formatPct(network.moneyPct)})`);
    ns.print("");

    ns.print("PROCESSES");
    ns.print("-".repeat(100));
    ns.print(`Total:         ${processes.total}`);
    ns.print(`Known:         ${processes.knownFramework}`);
    ns.print(`Unknown/ext:   ${processes.unknownOrExternal}`);
    ns.print(`Managers:      ${processes.processManagers}`);
    ns.print(`Workers:       weaken ${processes.weakenWorkers}, grow ${processes.growWorkers}, hack ${processes.hackWorkers}`);
    ns.print(`Share:         managers ${processes.shareManagers}, workers ${processes.shareWorkers}`);
    ns.print("");

    ns.print("FUTURE / NON-CORE SYSTEMS");
    ns.print("-".repeat(100));
    ns.print(`Contracts:     ${contracts.validUniqueContracts || 0} unique valid | raw ${contracts.rawContractFilesFound || 0} | dupes ${contracts.duplicateFilesSuppressed || 0}`);
    ns.print(`Stock API:     ${stocks.available ? "detected" : "not detected"} | symbols ${stocks.symbols || 0} | positions ${stocks.positions || 0}`);
    ns.print("");

    ns.print("ACTION SUGGESTIONS");
    ns.print("-".repeat(100));
    ns.print(`High priority:   ${high.length}`);
    ns.print(`Medium priority: ${medium.length}`);
    ns.print("");

    const top = suggestions
        .filter(s => ["high", "medium"].includes(s.priority))
        .slice(0, 8);

    if (top.length === 0) {
        ns.print("No high/medium priority suggestions generated.");
    } else {
        for (const s of top) {
            ns.print(`[${s.priority}] ${s.category}: ${s.observation}`);
            if (s.recommendedCommand) ns.print(`  command: ${s.recommendedCommand}`);
        }
    }

    ns.print("");
    ns.print("RECOMMENDED AI PROMPT");
    ns.print("-".repeat(100));
    ns.print(diagnostic.aiPrompts.recommendedNextPrompt);
    ns.print("");

    ns.print("UPLOAD THIS FILE INTO CHATGPT WHEN ASKING FOR SYSTEM TUNING:");
    ns.print(outputFile);
}

function openConsole(ns, width = 1180, height = 720) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") ns.ui.openTail();
        if (ns.ui && typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(width, height);
    } catch {
        // Tail display is useful but not required.
    }
}

function formatGb(v) {
    return `${Number(v || 0).toFixed(2)}GB`;
}

function formatPct(v) {
    return `${Number(v || 0).toFixed(1)}%`;
}

function formatBytes(v) {
    v = Number(v || 0);
    if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)}MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(2)}KB`;
    return `${v}B`;
}

function formatMoney(value) {
    value = Number(value || 0);
    const abs = Math.abs(value);

    if (abs >= 1e15) return `$${(value / 1e15).toFixed(2)}q`;
    if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}t`;
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;

    return `$${value.toFixed(0)}`;
}

function round(value, dp = 2) {
    value = Number(value || 0);
    const factor = Math.pow(10, dp);
    return Math.round(value * factor) / factor;
}