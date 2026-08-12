/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const CFG = {
        spendRatio: clampNumber(Number(ns.args[0] ?? 0.5), 0.01, 1.0),
        prefix: String(ns.args[1] ?? "pserv-"),
        dryRun: parseBool(ns.args[2] ?? false),
        tail: parseBool(ns.args[3] ?? true),
        minRam: Math.max(2, Number(ns.args[4] ?? 8)),
        markerFile: "restart-required.txt",
        registryFile: "/data/purchased-servers.json"
    };

    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: buy-servers.js must be run from home.");
        return -1;
    }

    const cloud = getCloudApi(ns);

    if (!cloud.available) {
        ns.tprint("ERROR: No purchased/cloud server API is available in this Bitburner context.");
        return -2;
    }

    if (CFG.tail) await openTail(ns, "Buy / Upgrade Servers");
    ns.clearLog();

    await writePurchasedRegistry(ns, CFG, cloud, [], false);

    if (ns.fileExists(CFG.markerFile, "home")) ns.rm(CFG.markerFile, "home");

    const startMoney = ns.getServerMoneyAvailable("home");
    const budget = Math.floor(startMoney * CFG.spendRatio);
    let remainingBudget = budget;

    const limit = Number(cloud.getLimit());
    const maxRam = Number(cloud.getRamLimit());

    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(maxRam) || maxRam <= 0) {
        ns.tprint(`ERROR: Invalid purchased/cloud limits. limit=${limit}, maxRam=${maxRam}`);
        return -3;
    }

    let bought = 0;
    let upgraded = 0;
    let skipped = 0;
    let spent = 0;
    const actions = [];

    ns.print("Purchased/cloud server buyer");
    ns.print(`API mode:          ${cloud.mode}`);
    ns.print(`Spend ratio:       ${CFG.spendRatio}`);
    ns.print(`Prefix for new:    ${CFG.prefix}`);
    ns.print(`Dry run:           ${CFG.dryRun}`);
    ns.print(`Budget:            ${fmtMoney(ns, budget)}`);
    ns.print(`Limit:             ${limit}`);
    ns.print(`Max RAM/server:    ${fmtRam(ns, maxRam)}`);
    ns.print(`Registry:          ${CFG.registryFile}`);
    ns.print("");

    let existing = safeNames(ns, cloud);
    let nextIndex = nextGeneratedIndex(existing, CFG.prefix);

    while (existing.length < limit) {
        const name = nextAvailableGeneratedName(ns, CFG.prefix, nextIndex);
        nextIndex++;

        const ram = largestAffordableRam(cloud, remainingBudget, maxRam, CFG.minRam);
        if (ram < CFG.minRam) {
            skipped++;
            actions.push({ action: "skip-buy", server: name, reason: "insufficient budget for minimum RAM", remainingBudget });
            break;
        }

        const cost = Number(cloud.getCost(ram));

        if (CFG.dryRun) {
            bought++;
            spent += cost;
            remainingBudget -= cost;
            existing.push(name);
            actions.push({ action: "dry-buy", server: name, ram, cost });
            continue;
        }

        const result = cloud.purchase(name, ram);
        const purchasedName = normalisePurchaseResult(result, name);

        if (purchasedName && ns.serverExists(purchasedName)) {
            bought++;
            spent += cost;
            remainingBudget -= cost;
            existing = safeNames(ns, cloud);
            actions.push({ action: "buy", server: purchasedName, ram, cost });
        } else {
            skipped++;
            actions.push({ action: "failed-buy", server: name, ram, cost, result: String(result) });
            break;
        }

        await ns.sleep(20);
    }

    while (true) {
        const fleet = safeNames(ns, cloud)
            .filter(name => ns.serverExists(name))
            .map(name => ({ name, ram: ns.getServerMaxRam(name) }))
            .sort((a, b) => a.ram - b.ram || a.name.localeCompare(b.name));

        if (fleet.length < limit) break;

        const upgrade = findBestUpgrade(cloud, fleet, remainingBudget, maxRam);
        if (!upgrade) {
            skipped++;
            actions.push({ action: "skip-upgrade", server: "-", reason: "no affordable useful upgrade", remainingBudget });
            break;
        }

        if (CFG.dryRun) {
            upgraded++;
            spent += upgrade.cost;
            remainingBudget -= upgrade.cost;
            actions.push({ action: "dry-upgrade", server: upgrade.name, fromRam: upgrade.oldRam, toRam: upgrade.newRam, cost: upgrade.cost });
            continue;
        }

        ns.killall(upgrade.name, true);
        await ns.sleep(50);

        const ok = cloud.upgrade(upgrade.name, upgrade.newRam);

        if (ok) {
            upgraded++;
            spent += upgrade.cost;
            remainingBudget -= upgrade.cost;
            actions.push({ action: "upgrade", server: upgrade.name, fromRam: upgrade.oldRam, toRam: upgrade.newRam, cost: upgrade.cost });
        } else {
            skipped++;
            actions.push({ action: "failed-upgrade", server: upgrade.name, fromRam: upgrade.oldRam, toRam: upgrade.newRam, cost: upgrade.cost });
            break;
        }

        await ns.sleep(20);
    }

    const changedCapacity = bought > 0 || upgraded > 0;

    if (!CFG.dryRun) {
        await writePurchasedRegistry(ns, CFG, cloud, actions, changedCapacity);
    }

    if (changedCapacity && !CFG.dryRun) {
        const marker = {
            timestamp: Date.now(),
            timestampText: new Date(Date.now()).toISOString(),
            script: "buy-servers.js",
            apiMode: cloud.mode,
            bought,
            upgraded,
            skipped,
            spendRatio: CFG.spendRatio,
            newServerPrefix: CFG.prefix,
            budget,
            spent,
            remainingBudget,
            registryFile: CFG.registryFile,
            message: "Purchased/cloud server capacity changed. Redeploy with startup.js true false or upload.js + assign-targets.js."
        };

        await ns.write(CFG.markerFile, JSON.stringify(marker, null, 2), "w");
    }

    printSummary(ns, { CFG, cloud, bought, upgraded, skipped, spent, remainingBudget, changedCapacity, actions });

    if (changedCapacity && !CFG.dryRun) {
        ns.tprint(`buy-servers.js: capacity changed — bought ${bought}, upgraded ${upgraded}. Run: startup.js true false`);
    } else if (CFG.dryRun) {
        ns.tprint(`buy-servers.js dry run: would buy ${bought}, upgrade ${upgraded}, spend ${fmtMoney(ns, spent)}.`);
    } else {
        ns.tprint("buy-servers.js: registry refreshed; no capacity changed.");
    }

    return changedCapacity ? 1 : 0;
}

function getCloudApi(ns) {
    if (ns.cloud && typeof ns.cloud.getServerNames === "function") {
        return {
            available: true,
            mode: "ns.cloud",
            getNames: () => ns.cloud.getServerNames(),
            getLimit: () => ns.cloud.getServerLimit(),
            getRamLimit: () => ns.cloud.getRamLimit(),
            getCost: ram => ns.cloud.getServerCost(ram),
            getUpgradeCost: (host, ram) => ns.cloud.getServerUpgradeCost(host, ram),
            purchase: (name, ram) => ns.cloud.purchaseServer(name, ram),
            upgrade: (host, ram) => ns.cloud.upgradeServer(host, ram)
        };
    }

    const legacyAvailable =
        typeof ns.getPurchasedServers === "function" &&
        typeof ns.getPurchasedServerLimit === "function" &&
        typeof ns.getPurchasedServerMaxRam === "function" &&
        typeof ns.getPurchasedServerCost === "function" &&
        typeof ns.purchaseServer === "function";

    if (legacyAvailable) {
        return {
            available: true,
            mode: "legacy purchased-server API",
            getNames: () => ns.getPurchasedServers(),
            getLimit: () => ns.getPurchasedServerLimit(),
            getRamLimit: () => ns.getPurchasedServerMaxRam(),
            getCost: ram => ns.getPurchasedServerCost(ram),
            getUpgradeCost: (host, ram) => {
                if (typeof ns.getPurchasedServerUpgradeCost === "function") {
                    return ns.getPurchasedServerUpgradeCost(host, ram);
                }

                const currentRam = ns.getServerMaxRam(host);
                return Math.max(0, ns.getPurchasedServerCost(ram) - ns.getPurchasedServerCost(currentRam));
            },
            purchase: (name, ram) => ns.purchaseServer(name, ram),
            upgrade: (host, ram) => {
                if (typeof ns.upgradePurchasedServer === "function") {
                    return ns.upgradePurchasedServer(host, ram);
                }
                return false;
            }
        };
    }

    return {
        available: false,
        mode: "none",
        getNames: () => [],
        getLimit: () => null,
        getRamLimit: () => null,
        getCost: () => Infinity,
        getUpgradeCost: () => Infinity,
        purchase: () => "",
        upgrade: () => false
    };
}

async function writePurchasedRegistry(ns, CFG, cloud, actions = [], changedCapacity = false) {
    const now = Date.now();
    const names = new Set();

    try {
        if (cloud.available) {
            for (const name of cloud.getNames()) {
                if (name && ns.serverExists(name)) names.add(name);
            }
        }
    } catch {}

    try {
        if (ns.fileExists(CFG.registryFile, "home")) {
            const oldRegistry = JSON.parse(ns.read(CFG.registryFile));
            for (const item of oldRegistry.servers ?? []) {
                const name = typeof item === "string" ? item : item.name;
                if (name && ns.serverExists(name)) names.add(name);
            }
        }
    } catch {}

    const servers = [...names]
        .sort()
        .map(name => {
            const maxRam = ns.getServerMaxRam(name);
            const usedRam = ns.getServerUsedRam(name);
            return {
                name,
                maxRam,
                usedRam,
                freeRam: Math.max(0, maxRam - usedRam),
                source: "api-or-registry",
                exists: true
            };
        });

    const registry = {
        schemaVersion: 1,
        updatedAt: now,
        updatedAtText: new Date(now).toISOString(),
        writer: "buy-servers.js",
        apiMode: cloud.mode,
        newServerNamingPrefix: CFG.prefix,
        dryRun: CFG.dryRun,
        changedCapacity,
        serverCount: servers.length,
        totalRam: sum(servers.map(s => s.maxRam)),
        usedRam: sum(servers.map(s => s.usedRam)),
        freeRam: sum(servers.map(s => s.freeRam)),
        servers,
        recentActions: actions.slice(-50),
        note: "Ownership is detected from the Bitburner API first, then merged with this registry. No naming prefix is assumed."
    };

    await ns.write(CFG.registryFile, JSON.stringify(registry, null, 2), "w");
}

function safeNames(ns, cloud) {
    try {
        if (!cloud.available) return [];
        return cloud.getNames().filter(name => name && ns.serverExists(name)).sort();
    } catch {
        return [];
    }
}

function normalisePurchaseResult(result, requestedName) {
    if (typeof result === "string") return result || "";
    if (result === true) return requestedName;
    return "";
}

function nextGeneratedIndex(existingNames, prefix) {
    let max = -1;
    for (const name of existingNames) {
        if (!String(name).startsWith(prefix)) continue;
        const suffix = String(name).slice(prefix.length);
        if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
    }
    return max + 1;
}

function nextAvailableGeneratedName(ns, prefix, startIndex) {
    let i = startIndex;
    while (ns.serverExists(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
}

function largestAffordableRam(cloud, budget, maxRam, minRam) {
    let ram = normalisePowerOfTwo(minRam);
    if (cloud.getCost(ram) > budget) return 0;

    while (ram * 2 <= maxRam) {
        const next = ram * 2;
        const cost = Number(cloud.getCost(next));
        if (!Number.isFinite(cost) || cost > budget) break;
        ram = next;
    }

    return ram;
}

function findBestUpgrade(cloud, fleet, budget, maxRam) {
    for (const server of fleet) {
        if (server.ram >= maxRam) continue;

        let targetRam = Math.max(2, normalisePowerOfTwo(server.ram * 2));
        let best = null;

        while (targetRam <= maxRam) {
            const cost = Number(cloud.getUpgradeCost(server.name, targetRam));
            if (Number.isFinite(cost) && cost <= budget) {
                best = { name: server.name, oldRam: server.ram, newRam: targetRam, cost };
                targetRam *= 2;
            } else {
                break;
            }
        }

        if (best) return best;
    }

    return null;
}

function normalisePowerOfTwo(value) {
    let ram = 1;
    while (ram < value) ram *= 2;
    return ram;
}

function printSummary(ns, result) {
    ns.print("");
    ns.print("Summary");
    ns.print(table(
        ["Metric", "Value"],
        [
            ["API", result.cloud.mode],
            ["Bought", String(result.bought)],
            ["Upgraded", String(result.upgraded)],
            ["Skipped", String(result.skipped)],
            ["Spent", fmtMoney(ns, result.spent)],
            ["Remaining budget", fmtMoney(ns, result.remainingBudget)],
            ["Changed capacity", result.changedCapacity ? "yes" : "no"],
            ["Registry", result.CFG.registryFile]
        ]
    ));

    if (result.actions.length > 0) {
        ns.print("");
        ns.print("Actions");
        ns.print(table(
            ["Action", "Server", "RAM", "Cost / reason"],
            result.actions.map(a => [
                a.action,
                a.server ?? "-",
                a.toRam ? `${fmtRam(ns, a.fromRam)} -> ${fmtRam(ns, a.toRam)}` : a.ram ? fmtRam(ns, a.ram) : "-",
                a.cost ? fmtMoney(ns, a.cost) : a.reason ?? "-"
            ])
        ));
    }
}

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function parseBool(value) {
    if (typeof value === "boolean") return value;
    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function sum(values) {
    return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
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

function fmtRam(ns, value, decimals = 2) {
    if (!Number.isFinite(value)) return "-";
    try {
        if (ns.format && typeof ns.format.ram === "function") return ns.format.ram(value, decimals);
    } catch {}
    return `${Number(value).toFixed(decimals)}GB`;
}

function table(headers, rows) {
    if (!rows || rows.length === 0) return "(none)";
    const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(r[i] ?? "").length)));
    const line = row => row.map((v, i) => String(v ?? "").padEnd(widths[i])).join(" | ");
    return [line(headers), widths.map(w => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

async function openTail(ns, titleText) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();
            await ns.sleep(50);
            if (typeof ns.ui.resizeTail === "function") ns.ui.resizeTail(900, 620);
            if (typeof ns.ui.moveTail === "function") ns.ui.moveTail(120, 90);
            if (typeof ns.ui.setTailTitle === "function") ns.ui.setTailTitle(titleText);
            return;
        }
    } catch {}
}
