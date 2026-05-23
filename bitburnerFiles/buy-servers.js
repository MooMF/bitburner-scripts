/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const CFG = {
        spendRatio: clampNumber(Number(ns.args[0] ?? 0.5), 0.01, 1.0),
        prefix: String(ns.args[1] ?? "pserv-"),
        dryRun: parseBool(ns.args[2] ?? false),
        tail: parseBool(ns.args[3] ?? true),
        minRam: 8,
        markerFile: "restart-required.txt"
    };

    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: buy-servers.js must be run from home.");
        return -1;
    }

    const cloud = getCloudApi(ns);

    if (!cloud.available) {
        ns.tprint("ERROR: No purchased/cloud server API is available.");
        ns.tprint("Bitburner v3 expects ns.cloud.* functions.");
        return -2;
    }

    if (CFG.tail) {
        await openTail(ns, "Buy / Upgrade Cloud Servers");
    }

    ns.clearLog();

    // Remove stale marker at the start. It will only be recreated if capacity actually changes.
    if (ns.fileExists(CFG.markerFile, "home")) {
        ns.rm(CFG.markerFile, "home");
    }

    const startMoney = ns.getServerMoneyAvailable("home");
    const budget = Math.floor(startMoney * CFG.spendRatio);
    let remainingBudget = budget;
    let spent = 0;
    let bought = 0;
    let upgraded = 0;
    let skipped = 0;
    const actions = [];

    const limit = cloud.getLimit();
    const maxRam = cloud.getRamLimit();

    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(maxRam) || maxRam <= 0) {
        ns.tprint(`ERROR: Invalid cloud limits. limit=${limit}, maxRam=${maxRam}`);
        return -3;
    }

    const existing = cloud.getNames().sort(sortServerNames(CFG.prefix));

    logHeader(ns, CFG, startMoney, budget, limit, maxRam, existing, cloud.mode);

    // Phase 1: fill empty slots.
    const existingSet = new Set(existing);

    for (let i = 0; i < limit; i++) {
        const name = `${CFG.prefix}${i}`;

        if (existingSet.has(name) || ns.serverExists(name)) {
            continue;
        }

        const ram = largestAffordableRam(cloud, remainingBudget, maxRam, CFG.minRam);

        if (ram < CFG.minRam) {
            skipped++;
            actions.push({
                action: "skip-buy",
                server: name,
                reason: "insufficient budget for minimum RAM",
                remainingBudget
            });
            break;
        }

        const cost = cloud.getCost(ram);

        if (CFG.dryRun) {
            bought++;
            spent += cost;
            remainingBudget -= cost;
            actions.push({
                action: "dry-buy",
                server: name,
                ram,
                cost
            });
            continue;
        }

        const purchasedName = cloud.purchase(name, ram);

        if (purchasedName) {
            bought++;
            spent += cost;
            remainingBudget -= cost;
            existingSet.add(purchasedName);
            actions.push({
                action: "buy",
                server: purchasedName,
                ram,
                cost
            });
        } else {
            skipped++;
            actions.push({
                action: "failed-buy",
                server: name,
                ram,
                cost
            });
        }

        await ns.sleep(10);
    }

    // Phase 2: upgrade smallest servers first once fleet is full.
    while (true) {
        const fleet = cloud.getNames()
            .map(name => ({
                name,
                ram: ns.getServerMaxRam(name)
            }))
            .sort((a, b) => a.ram - b.ram || a.name.localeCompare(b.name));

        if (fleet.length < limit) {
            break;
        }

        const candidate = findBestUpgrade(cloud, fleet, remainingBudget, maxRam);

        if (!candidate) {
            skipped++;
            actions.push({
                action: "skip-upgrade",
                server: "-",
                reason: "no affordable useful upgrade",
                remainingBudget
            });
            break;
        }

        if (CFG.dryRun) {
            upgraded++;
            spent += candidate.cost;
            remainingBudget -= candidate.cost;
            actions.push({
                action: "dry-upgrade",
                server: candidate.name,
                fromRam: candidate.oldRam,
                toRam: candidate.newRam,
                cost: candidate.cost
            });
            continue;
        }

        ns.killall(candidate.name, true);
        await ns.sleep(50);

        const ok = cloud.upgrade(candidate.name, candidate.newRam);

        if (ok) {
            upgraded++;
            spent += candidate.cost;
            remainingBudget -= candidate.cost;
            actions.push({
                action: "upgrade",
                server: candidate.name,
                fromRam: candidate.oldRam,
                toRam: candidate.newRam,
                cost: candidate.cost
            });
        } else {
            skipped++;
            actions.push({
                action: "failed-upgrade",
                server: candidate.name,
                fromRam: candidate.oldRam,
                toRam: candidate.newRam,
                cost: candidate.cost
            });
            break;
        }

        await ns.sleep(10);
    }

    const changedCapacity = bought > 0 || upgraded > 0;

    if (changedCapacity && !CFG.dryRun) {
        const marker = {
            timestamp: Date.now(),
            script: "buy-servers.js",
            api: cloud.mode,
            bought,
            upgraded,
            skipped,
            spendRatio: CFG.spendRatio,
            budget,
            spent,
            remainingBudget,
            message: "Server capacity changed. Run startup.js true false to clean, redeploy, assign targets, and restart the share/rent layer."
        };

        await ns.write(CFG.markerFile, JSON.stringify(marker, null, 2), "w");
    } else {
        // Critical fix: no marker if no actual buy/upgrade occurred.
        if (ns.fileExists(CFG.markerFile, "home")) {
            ns.rm(CFG.markerFile, "home");
        }
    }

    printSummary(ns, {
        CFG,
        cloud,
        limit,
        maxRam,
        startMoney,
        budget,
        remainingBudget,
        spent,
        bought,
        upgraded,
        skipped,
        changedCapacity,
        actions
    });

    if (changedCapacity && !CFG.dryRun) {
        ns.tprint(`buy-servers.js: capacity changed — bought ${bought}, upgraded ${upgraded}. Run: startup.js true false`);
    } else if (CFG.dryRun) {
        ns.tprint(`buy-servers.js dry run: would buy ${bought}, upgrade ${upgraded}, spend ${fmtMoney(ns, spent)}.`);
    } else {
        ns.tprint("buy-servers.js: no capacity changed; restart marker not written.");
    }

    return changedCapacity ? 1 : 0;
}

/* ==============================
   Cloud / purchased-server API adapter
   ============================== */

function getCloudApi(ns) {
    // Bitburner v3 API.
    if (ns.cloud) {
        return {
            available: true,
            mode: "ns.cloud",
            getLimit: () => ns.cloud.getServerLimit(),
            getRamLimit: () => ns.cloud.getRamLimit(),
            getNames: () => ns.cloud.getServerNames(),
            getCost: ram => ns.cloud.getServerCost(ram),
            getUpgradeCost: (name, ram) => ns.cloud.getServerUpgradeCost(name, ram),
            purchase: (name, ram) => ns.cloud.purchaseServer(name, ram),
            upgrade: (name, ram) => ns.cloud.upgradeServer(name, ram)
        };
    }

    // Older API fallback.
    if (
        typeof ns.getPurchasedServerLimit === "function" &&
        typeof ns.getPurchasedServerMaxRam === "function" &&
        typeof ns.getPurchasedServers === "function" &&
        typeof ns.getPurchasedServerCost === "function" &&
        typeof ns.purchaseServer === "function"
    ) {
        return {
            available: true,
            mode: "legacy purchased-server API",
            getLimit: () => ns.getPurchasedServerLimit(),
            getRamLimit: () => ns.getPurchasedServerMaxRam(),
            getNames: () => ns.getPurchasedServers(),
            getCost: ram => ns.getPurchasedServerCost(ram),
            getUpgradeCost: (name, ram) => {
                if (typeof ns.getPurchasedServerUpgradeCost === "function") {
                    return ns.getPurchasedServerUpgradeCost(name, ram);
                }

                const current = ns.getServerMaxRam(name);
                return Math.max(0, ns.getPurchasedServerCost(ram) - ns.getPurchasedServerCost(current));
            },
            purchase: (name, ram) => ns.purchaseServer(name, ram),
            upgrade: (name, ram) => {
                if (typeof ns.upgradePurchasedServer === "function") {
                    return ns.upgradePurchasedServer(name, ram);
                }

                if (typeof ns.deleteServer === "function") {
                    ns.killall(name, true);
                    const deleted = ns.deleteServer(name);
                    if (!deleted) return false;
                    return ns.purchaseServer(name, ram) === name;
                }

                return false;
            }
        };
    }

    return {
        available: false,
        mode: "none"
    };
}

/* ==============================
   Buying / upgrading
   ============================== */

function largestAffordableRam(cloud, budget, maxRam, minRam) {
    let ram = minRam;

    if (cloud.getCost(ram) > budget) return 0;

    while (ram * 2 <= maxRam) {
        const next = ram * 2;
        const cost = cloud.getCost(next);

        if (!Number.isFinite(cost) || cost > budget) break;
        ram = next;
    }

    return ram;
}

function findBestUpgrade(cloud, fleet, budget, maxRam) {
    for (const server of fleet) {
        if (server.ram >= maxRam) continue;

        let targetRam = server.ram * 2;
        let best = null;

        while (targetRam <= maxRam) {
            const cost = cloud.getUpgradeCost(server.name, targetRam);

            if (Number.isFinite(cost) && cost <= budget) {
                best = {
                    name: server.name,
                    oldRam: server.ram,
                    newRam: targetRam,
                    cost
                };

                targetRam *= 2;
                continue;
            }

            break;
        }

        if (best) return best;
    }

    return null;
}

/* ==============================
   Output
   ============================== */

function logHeader(ns, CFG, startMoney, budget, limit, maxRam, existing, apiMode) {
    ns.print("Cloud server buyer");
    ns.print(`API: ${apiMode}`);
    ns.print(`Spend ratio: ${CFG.spendRatio}`);
    ns.print(`Home money: ${fmtMoney(ns, startMoney)}`);
    ns.print(`Budget: ${fmtMoney(ns, budget)}`);
    ns.print(`Limit: ${limit}`);
    ns.print(`Max RAM/server: ${fmtRam(ns, maxRam)}`);
    ns.print(`Existing: ${existing.length}/${limit}`);
    ns.print(`Dry run: ${CFG.dryRun}`);
    ns.print("");
}

function printSummary(ns, result) {
    const rows = [
        ["API", result.cloud.mode],
        ["Bought", String(result.bought)],
        ["Upgraded", String(result.upgraded)],
        ["Skipped", String(result.skipped)],
        ["Spent", fmtMoney(ns, result.spent)],
        ["Remaining budget", fmtMoney(ns, result.remainingBudget)],
        ["Capacity changed", result.changedCapacity ? "yes" : "no"],
        ["Restart marker", result.changedCapacity && !result.CFG.dryRun ? "written" : "not written"]
    ];

    ns.print("");
    ns.print("Summary");
    ns.print(table(["Metric", "Value"], rows));

    if (result.actions.length) {
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

/* ==============================
   Helpers
   ============================== */

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function parseBool(value) {
    if (typeof value === "boolean") return value;

    const text = String(value).toLowerCase().trim();
    return text === "true" || text === "1" || text === "yes" || text === "y";
}

function sortServerNames(prefix) {
    return (a, b) => {
        const ai = Number(String(a).replace(prefix, ""));
        const bi = Number(String(b).replace(prefix, ""));

        if (Number.isFinite(ai) && Number.isFinite(bi)) {
            return ai - bi;
        }

        return String(a).localeCompare(String(b));
    };
}

function fmtMoney(ns, value) {
    try {
        if (ns.format && typeof ns.format.money === "function") {
            return ns.format.money(value);
        }
    } catch (_) {}

    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}t`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;

    return `$${Number(value).toFixed(0)}`;
}

function fmtRam(ns, value) {
    try {
        if (ns.format && typeof ns.format.ram === "function") {
            return ns.format.ram(value);
        }
    } catch (_) {}

    try {
        if (typeof ns.formatRam === "function") {
            return ns.formatRam(value);
        }
    } catch (_) {}

    return `${Number(value).toFixed(1)}GB`;
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

async function openTail(ns, titleText) {
    try {
        if (ns.ui && typeof ns.ui.openTail === "function") {
            ns.ui.openTail();
            await ns.sleep(50);
            ns.ui.resizeTail(900, 620);
            ns.ui.moveTail(120, 90);
            ns.ui.setTailTitle(titleText);
            return;
        }
    } catch (_) {}

    try {
        ns.tail();
        await ns.sleep(50);
        ns.resizeTail(900, 620);
        ns.moveTail(120, 90);
        ns.setTitle(titleText);
    } catch (_) {}
}