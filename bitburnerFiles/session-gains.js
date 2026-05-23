/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const BASELINE_FILE = "/data/session-gains-baseline.json";
    const LAST_FILE = "/data/session-gains-last.json";

    const mode = String(ns.args[0] ?? "").toLowerCase();
    const watch = mode === "watch";
    const reset = mode === "reset" || mode === "clear";
    const refreshMs = Number(ns.args[1] ?? 10000);

    openTailSafe(ns, 1060, 720, 20, 20);

    if (reset) {
        const snap = await takeSnapshot(ns);
        writeJson(ns, BASELINE_FILE, snap);
        writeJson(ns, LAST_FILE, snap);

        ns.clearLog();
        ns.print("SESSION GAINS RESET");
        ns.print("===================");
        ns.print(`New baseline written at: ${new Date(snap.timestamp).toLocaleString()}`);
        ns.print("");
        ns.print(`Cash: ${fmtMoneyRaw(snap.money)}`);
        ns.print(`Hacking: ${snap.skills.hacking} | XP: ${fmtNum(snap.exp.hacking)}`);

        if (snap.moneySources.available) {
            ns.print("");
            ns.print("Money-source baseline captured.");
        } else {
            ns.print("");
            ns.print("Money-source API unavailable. Net cash and live rates will still work.");
        }

        ns.print("");
        ns.print("Run again with:");
        ns.print("  run session-gains.js");
        return;
    }

    while (true) {
        await report(ns, BASELINE_FILE, LAST_FILE);

        if (!watch) return;

        await ns.sleep(Math.max(1000, refreshMs));
    }
}

async function report(ns, baselineFile, lastFile) {
    const current = await takeSnapshot(ns);

    let baseline = readJson(ns, baselineFile);
    let last = readJson(ns, lastFile);

    let firstRun = false;

    if (!baseline) {
        baseline = current;
        firstRun = true;
        writeJson(ns, baselineFile, baseline);
    }

    if (!last) {
        last = baseline;
    }

    writeJson(ns, lastFile, current);

    ns.clearLog();

    ns.print("SESSION GAINS");
    ns.print("=============");
    ns.print(`Now:       ${new Date(current.timestamp).toLocaleString()}`);
    ns.print(`Baseline:  ${new Date(baseline.timestamp).toLocaleString()}`);
    ns.print(`Previous:  ${new Date(last.timestamp).toLocaleString()}`);
    ns.print("");

    if (firstRun) {
        ns.print(colour("First run detected. Baseline created.", "cyan"));
        ns.print("Run this script again later to see gains.");
        ns.print("");
    }

    printCash(ns, current, baseline, last);
    printIncomeSources(ns, current, baseline, last);
    printSkills(ns, current, baseline, last);
    printReputation(ns, current, baseline, last);
    printOther(ns, current, baseline, last);
    printCurrentRates(ns, current, last);

    ns.print("");
    ns.print("COMMANDS");
    ns.print("--------");
    ns.print("Reset baseline:");
    ns.print("  run session-gains.js reset");
    ns.print("");
    ns.print("Watch mode:");
    ns.print("  run session-gains.js watch 10000");
}

async function takeSnapshot(ns) {
    const player = ns.getPlayer();

    const factions = Array.isArray(player.factions) ? player.factions : [];
    const jobs =
        player.jobs && typeof player.jobs === "object"
            ? Object.keys(player.jobs)
            : [];

    const factionRep = {};
    for (const faction of factions) {
        const rep = safeCall(() => getFactionRep(ns, faction));
        if (rep !== null && Number.isFinite(rep)) {
            factionRep[faction] = rep;
        }
    }

    const companyRep = {};
    for (const company of jobs) {
        const rep = safeCall(() => getCompanyRep(ns, company));
        if (rep !== null && Number.isFinite(rep)) {
            companyRep[company] = rep;
        }
    }

    const scriptIncomeRaw = safeCall(() => ns.getTotalScriptIncome());
    const scriptExpRaw = safeCall(() => ns.getTotalScriptExpGain());

    const moneySourcesRaw = safeCall(() => ns.getMoneySources());
    const moneySources = normalizeMoneySources(moneySourcesRaw);

    const hacknet = getHacknetSnapshot(ns);

    return {
        version: 4,
        timestamp: Date.now(),

        money: Number(player.money ?? 0),

        skills: {
            hacking: Number(player.skills?.hacking ?? player.hacking ?? 0),
            strength: Number(player.skills?.strength ?? player.strength ?? 0),
            defense: Number(player.skills?.defense ?? player.defense ?? 0),
            dexterity: Number(player.skills?.dexterity ?? player.dexterity ?? 0),
            agility: Number(player.skills?.agility ?? player.agility ?? 0),
            charisma: Number(player.skills?.charisma ?? player.charisma ?? 0),
            intelligence: Number(player.skills?.intelligence ?? player.intelligence ?? 0),
        },

        exp: {
            hacking: Number(player.exp?.hacking ?? player.hacking_exp ?? 0),
            strength: Number(player.exp?.strength ?? player.strength_exp ?? 0),
            defense: Number(player.exp?.defense ?? player.defense_exp ?? 0),
            dexterity: Number(player.exp?.dexterity ?? player.dexterity_exp ?? 0),
            agility: Number(player.exp?.agility ?? player.agility_exp ?? 0),
            charisma: Number(player.exp?.charisma ?? player.charisma_exp ?? 0),
            intelligence: Number(player.exp?.intelligence ?? player.intelligence_exp ?? 0),
        },

        factions,
        jobs,
        factionRep,
        companyRep,

        karma: safeCall(() => ns.heart.break()),
        kills: Number(player.numPeopleKilled ?? 0),

        scriptIncomePerSecond: extractFirstNumber(scriptIncomeRaw),
        scriptExpPerSecond: extractFirstNumber(scriptExpRaw),

        hacknet,
        moneySources,
    };
}

function getFactionRep(ns, faction) {
    if (ns.singularity?.getFactionRep) {
        return ns.singularity.getFactionRep(faction);
    }

    if (ns.getFactionRep) {
        return ns.getFactionRep(faction);
    }

    return null;
}

function getCompanyRep(ns, company) {
    if (ns.singularity?.getCompanyRep) {
        return ns.singularity.getCompanyRep(company);
    }

    if (ns.getCompanyRep) {
        return ns.getCompanyRep(company);
    }

    return null;
}

function getHacknetSnapshot(ns) {
    const result = {
        available: false,
        nodes: 0,
        productionPerSecond: 0,
        hashes: null,
        capacity: null,
    };

    try {
        if (!ns.hacknet || !ns.hacknet.numNodes) return result;

        const nodes = Number(ns.hacknet.numNodes());
        result.available = true;
        result.nodes = Number.isFinite(nodes) ? nodes : 0;

        for (let i = 0; i < result.nodes; i++) {
            const stats = safeCall(() => ns.hacknet.getNodeStats(i));
            if (!stats) continue;

            const prod = Number(stats.production ?? 0);
            if (Number.isFinite(prod)) {
                result.productionPerSecond += prod;
            }
        }

        const hashes = safeCall(() => ns.hacknet.numHashes());
        if (Number.isFinite(hashes)) result.hashes = hashes;

        const capacity = safeCall(() => ns.hacknet.hashCapacity());
        if (Number.isFinite(capacity)) result.capacity = capacity;
    } catch {
        // Hacknet API unavailable or restricted.
    }

    return result;
}

function normalizeMoneySources(raw) {
    const result = {
        available: false,
        raw: null,
        activePeriod: null,
        totals: {},
    };

    if (!raw || typeof raw !== "object") return result;

    result.available = true;
    result.raw = raw;

    const period =
        raw.sinceInstall && typeof raw.sinceInstall === "object"
            ? "sinceInstall"
            : raw.sinceStart && typeof raw.sinceStart === "object"
                ? "sinceStart"
                : null;

    result.activePeriod = period;

    if (period) {
        result.totals = flattenNumericObject(raw[period]);
    } else {
        result.totals = flattenNumericObject(raw);
    }

    return result;
}

function flattenNumericObject(obj, prefix = "") {
    const output = {};

    if (!obj || typeof obj !== "object") return output;

    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (typeof value === "number" && Number.isFinite(value)) {
            output[path] = value;
            continue;
        }

        if (typeof value === "bigint") {
            const asNumber = Number(value);
            if (Number.isFinite(asNumber)) output[path] = asNumber;
            continue;
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.assign(output, flattenNumericObject(value, path));
        }
    }

    return output;
}

function printCash(ns, current, baseline, last) {
    ns.print("CASH");
    ns.print("----");

    const cashChanged = current.money !== last.money;
    const cashColour = current.money > last.money ? "green" : current.money < last.money ? "red" : "normal";

    ns.print(`Current cash:       ${changed(fmtMoneyRaw(current.money), cashChanged, cashColour)}`);
    ns.print(`Since baseline:     ${fmtDeltaMoney(current.money - baseline.money)}`);
    ns.print(`Since previous run: ${changed(fmtDeltaMoney(current.money - last.money), cashChanged, cashColour)}`);
    ns.print("");
}

function printIncomeSources(ns, current, baseline, last) {
    ns.print("INCOME SOURCES");
    ns.print("--------------");

    if (!current.moneySources?.available) {
        ns.print("Money-source API unavailable.");
        ns.print("Net cash and current script/hacknet rates are still shown elsewhere.");
        ns.print("");
        return;
    }

    const currentTotals = current.moneySources?.totals ?? {};
    const baselineTotals = baseline.moneySources?.totals ?? {};
    const lastTotals = last.moneySources?.totals ?? {};

    const keys = unionKeys(currentTotals, baselineTotals, lastTotals)
        .filter(key => isUsefulMoneySourceKey(key))
        .sort((a, b) => {
            const da = Math.abs((currentTotals[a] ?? 0) - (baselineTotals[a] ?? 0));
            const db = Math.abs((currentTotals[b] ?? 0) - (baselineTotals[b] ?? 0));
            return db - da;
        });

    if (keys.length === 0) {
        ns.print("Money-source data exists, but no numeric source fields were found.");
        ns.print("");
        return;
    }

    ns.print(`Source period: ${current.moneySources.activePeriod ?? "unknown"}`);
    ns.print("");

    let printed = 0;

    for (const key of keys) {
        const now = currentTotals[key] ?? 0;
        const base = baselineTotals[key] ?? 0;
        const prev = lastTotals[key] ?? 0;

        const sessionDelta = now - base;
        const lastDelta = now - prev;

        if (sessionDelta === 0 && lastDelta === 0 && now === 0) continue;

        const tickChanged = lastDelta !== 0;
        const tickColour = lastDelta > 0 ? "green" : lastDelta < 0 ? "red" : "normal";

        ns.print(
            `${padRight(labelSource(key), 24)} ` +
            `session ${fmtDeltaMoney(sessionDelta)} ` +
            `| last ${changed(fmtDeltaMoney(lastDelta), tickChanged, tickColour)}`
        );

        printed++;
    }

    if (printed === 0) {
        ns.print("No changed income-source totals since baseline.");
    }

    ns.print("");
}

function isUsefulMoneySourceKey(key) {
    const lower = String(key).toLowerCase();

    if (lower.includes("time")) return false;
    if (lower.includes("timestamp")) return false;

    return true;
}

function labelSource(key) {
    return String(key)
        .replace(/^moneySources\./, "")
        .replace(/^sinceInstall\./, "")
        .replace(/^sinceStart\./, "")
        .replace(/\./g, " / ");
}

function printSkills(ns, current, baseline, last) {
    ns.print("SKILLS / EXPERIENCE");
    ns.print("-------------------");

    const keys = Object.keys(current.skills);

    for (const key of keys) {
        const levelNow = current.skills[key] ?? 0;
        const levelBase = baseline.skills?.[key] ?? 0;
        const levelLast = last.skills?.[key] ?? 0;

        const expNow = current.exp[key] ?? 0;
        const expBase = baseline.exp?.[key] ?? 0;
        const expLast = last.exp?.[key] ?? 0;

        const levelDeltaBase = levelNow - levelBase;
        const levelDeltaLast = levelNow - levelLast;
        const expDeltaBase = expNow - expBase;
        const expDeltaLast = expNow - expLast;

        const show =
            key === "hacking" ||
            levelDeltaBase !== 0 ||
            levelDeltaLast !== 0 ||
            expDeltaBase !== 0 ||
            expDeltaLast !== 0;

        if (!show) continue;

        const levelChanged = levelDeltaLast !== 0;
        const expChanged = expDeltaLast !== 0;

        ns.print(
            `${padRight(key, 12)} ` +
            `lvl ${changed(fmtNum(levelNow), levelChanged, "green")} ` +
            `| session ${signed(levelDeltaBase)} lvl, ${signedNum(expDeltaBase)} xp ` +
            `| last ${changed(signed(levelDeltaLast), levelChanged, "green")} lvl, ` +
            `${changed(signedNum(expDeltaLast), expChanged, "green")} xp`
        );
    }

    ns.print("");
}

function printReputation(ns, current, baseline, last) {
    ns.print("REPUTATION");
    ns.print("----------");

    const factionKeys = unionKeys(
        current.factionRep,
        baseline.factionRep,
        last.factionRep
    );

    const companyKeys = unionKeys(
        current.companyRep,
        baseline.companyRep,
        last.companyRep
    );

    if (factionKeys.length === 0 && companyKeys.length === 0) {
        ns.print("Reputation unavailable or no joined factions/jobs detected.");
        ns.print("Faction/company reputation generally requires Singularity API access.");
        ns.print("");
        return;
    }

    if (factionKeys.length > 0) {
        ns.print("Factions:");

        for (const name of factionKeys.sort()) {
            const now = current.factionRep?.[name] ?? 0;
            const base = baseline.factionRep?.[name] ?? 0;
            const prev = last.factionRep?.[name] ?? 0;

            const sessionDelta = now - base;
            const lastDelta = now - prev;
            const tickChanged = lastDelta !== 0;
            const tickColour = lastDelta > 0 ? "green" : lastDelta < 0 ? "red" : "normal";

            if (now !== 0 || sessionDelta !== 0 || lastDelta !== 0) {
                ns.print(
                    `  ${padRight(name, 24)} ` +
                    `${changed(fmtNum(now), tickChanged, tickColour)} ` +
                    `| session ${signedNum(sessionDelta)} ` +
                    `| last ${changed(signedNum(lastDelta), tickChanged, tickColour)}`
                );
            }
        }
    }

    if (companyKeys.length > 0) {
        ns.print("");
        ns.print("Companies:");

        for (const name of companyKeys.sort()) {
            const now = current.companyRep?.[name] ?? 0;
            const base = baseline.companyRep?.[name] ?? 0;
            const prev = last.companyRep?.[name] ?? 0;

            const sessionDelta = now - base;
            const lastDelta = now - prev;
            const tickChanged = lastDelta !== 0;
            const tickColour = lastDelta > 0 ? "green" : lastDelta < 0 ? "red" : "normal";

            if (now !== 0 || sessionDelta !== 0 || lastDelta !== 0) {
                ns.print(
                    `  ${padRight(name, 24)} ` +
                    `${changed(fmtNum(now), tickChanged, tickColour)} ` +
                    `| session ${signedNum(sessionDelta)} ` +
                    `| last ${changed(signedNum(lastDelta), tickChanged, tickColour)}`
                );
            }
        }
    }

    ns.print("");
}

function printOther(ns, current, baseline, last) {
    ns.print("OTHER");
    ns.print("-----");

    if (
        current.karma !== null &&
        baseline.karma !== null &&
        last.karma !== null &&
        Number.isFinite(current.karma) &&
        Number.isFinite(baseline.karma) &&
        Number.isFinite(last.karma)
    ) {
        const karmaDeltaLast = current.karma - last.karma;
        const karmaChanged = karmaDeltaLast !== 0;

        // Karma usually goes down when useful crime progress is made, so negative change is coloured green.
        const karmaColour = karmaDeltaLast < 0 ? "green" : karmaDeltaLast > 0 ? "red" : "normal";

        ns.print(
            `Karma:              ${changed(fmtNum(current.karma), karmaChanged, karmaColour)} ` +
            `| session ${signedNum(current.karma - baseline.karma)} ` +
            `| last ${changed(signedNum(karmaDeltaLast), karmaChanged, karmaColour)}`
        );
    } else {
        ns.print("Karma:              unavailable");
    }

    const killsDeltaLast = current.kills - last.kills;
    const killsChanged = killsDeltaLast !== 0;

    ns.print(
        `People killed:      ${changed(fmtNum(current.kills), killsChanged, "cyan")} ` +
        `| session ${signed(current.kills - baseline.kills)} ` +
        `| last ${changed(signed(killsDeltaLast), killsChanged, "cyan")}`
    );

    ns.print("");
}

function printCurrentRates(ns, current, last) {
    ns.print("CURRENT RATES");
    ns.print("-------------");

    if (Number.isFinite(current.scriptIncomePerSecond)) {
        const scriptRateChanged = current.scriptIncomePerSecond !== last.scriptIncomePerSecond;
        const scriptRateColour =
            current.scriptIncomePerSecond > last.scriptIncomePerSecond
                ? "green"
                : current.scriptIncomePerSecond < last.scriptIncomePerSecond
                    ? "red"
                    : "normal";

        ns.print(`Script income/sec:      ${changed(fmtMoneyRaw(current.scriptIncomePerSecond), scriptRateChanged, scriptRateColour)}/s`);
        ns.print(`Script income/min:      ${changed(fmtMoneyRaw(current.scriptIncomePerSecond * 60), scriptRateChanged, scriptRateColour)}/min`);
        ns.print(`Script income/hour:     ${changed(fmtMoneyRaw(current.scriptIncomePerSecond * 3600), scriptRateChanged, scriptRateColour)}/hr`);
    } else {
        ns.print("Script income rate:     unavailable");
    }

    if (Number.isFinite(current.scriptExpPerSecond)) {
        const scriptXpChanged = current.scriptExpPerSecond !== last.scriptExpPerSecond;
        const scriptXpColour =
            current.scriptExpPerSecond > last.scriptExpPerSecond
                ? "green"
                : current.scriptExpPerSecond < last.scriptExpPerSecond
                    ? "red"
                    : "normal";

        ns.print(`Script hack XP/sec:     ${changed(fmtNum(current.scriptExpPerSecond), scriptXpChanged, scriptXpColour)}/s`);
    } else {
        ns.print("Script hack XP/sec:     unavailable");
    }

    if (current.hacknet?.available) {
        ns.print("");

        const nodesChanged = current.hacknet.nodes !== last.hacknet?.nodes;
        ns.print(`Hacknet nodes:          ${changed(fmtNum(current.hacknet.nodes), nodesChanged, "cyan")}`);

        if (Number.isFinite(current.hacknet.productionPerSecond)) {
            const hacknetRateLast = Number(last.hacknet?.productionPerSecond ?? 0);
            const hacknetRateChanged = current.hacknet.productionPerSecond !== hacknetRateLast;
            const hacknetRateColour =
                current.hacknet.productionPerSecond > hacknetRateLast
                    ? "green"
                    : current.hacknet.productionPerSecond < hacknetRateLast
                        ? "red"
                        : "normal";

            ns.print(`Hacknet production/sec: ${changed(fmtMoneyRaw(current.hacknet.productionPerSecond), hacknetRateChanged, hacknetRateColour)}/s`);
            ns.print(`Hacknet production/min: ${changed(fmtMoneyRaw(current.hacknet.productionPerSecond * 60), hacknetRateChanged, hacknetRateColour)}/min`);
            ns.print(`Hacknet production/hr:  ${changed(fmtMoneyRaw(current.hacknet.productionPerSecond * 3600), hacknetRateChanged, hacknetRateColour)}/hr`);
        }

        if (
            Number.isFinite(current.hacknet.hashes) &&
            Number.isFinite(current.hacknet.capacity)
        ) {
            const hashesLast = Number(last.hacknet?.hashes ?? 0);
            const hashesChanged = current.hacknet.hashes !== hashesLast;
            const hashesColour =
                current.hacknet.hashes > hashesLast
                    ? "green"
                    : current.hacknet.hashes < hashesLast
                        ? "red"
                        : "normal";

            ns.print(
                `Hacknet hashes:         ` +
                `${changed(fmtNum(current.hacknet.hashes), hashesChanged, hashesColour)} / ` +
                `${fmtNum(current.hacknet.capacity)}`
            );
        }
    } else {
        ns.print("");
        ns.print("Hacknet:                unavailable");
    }
}

function readJson(ns, file) {
    try {
        if (!ns.fileExists(file, "home")) return null;

        const text = ns.read(file);
        if (!text || !text.trim()) return null;

        return JSON.parse(text);
    } catch {
        return null;
    }
}

function writeJson(ns, file, data) {
    ns.write(file, safeStringify(data), "w");
}

function safeStringify(value) {
    return JSON.stringify(
        value,
        (_key, val) => {
            if (typeof val === "bigint") return val.toString();
            if (typeof val === "number" && !Number.isFinite(val)) return null;
            return val;
        },
        2
    );
}

function safeCall(fn) {
    try {
        return fn();
    } catch {
        return null;
    }
}

function extractFirstNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === "number" && Number.isFinite(item)) {
                return item;
            }
        }
    }

    return 0;
}

function unionKeys(...objects) {
    const set = new Set();

    for (const obj of objects) {
        if (!obj || typeof obj !== "object") continue;

        for (const key of Object.keys(obj)) {
            set.add(key);
        }
    }

    return [...set];
}

function fmtDeltaMoney(value) {
    const prefix = value >= 0 ? "+" : "-";
    return prefix + fmtMoneyRaw(Math.abs(value));
}

function fmtMoneyRaw(value) {
    return "$" + fmtNum(value);
}

function fmtNum(value) {
    if (!Number.isFinite(value)) return "n/a";

    const abs = Math.abs(value);

    if (abs >= 1e15) return (value / 1e15).toFixed(3) + "q";
    if (abs >= 1e12) return (value / 1e12).toFixed(3) + "t";
    if (abs >= 1e9) return (value / 1e9).toFixed(3) + "b";
    if (abs >= 1e6) return (value / 1e6).toFixed(3) + "m";
    if (abs >= 1e3) return (value / 1e3).toFixed(3) + "k";

    return value.toFixed(2);
}

function signed(value) {
    if (!Number.isFinite(value)) return "n/a";
    return value >= 0 ? `+${value}` : `${value}`;
}

function signedNum(value) {
    if (!Number.isFinite(value)) return "n/a";
    return value >= 0 ? `+${fmtNum(value)}` : `-${fmtNum(Math.abs(value))}`;
}

function padRight(text, width) {
    text = String(text);
    return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function changed(text, didChange, colourName = "cyan") {
    if (!didChange) return text;

    // Positive changes were originally green.
    // Remap them to yellow for better visibility in Bitburner's green terminal.
    if (colourName === "green") colourName = "yellow";
    if (colourName === "brightGreen") colourName = "brightYellow";

    return colour(text, colourName);
}

function colour(text, colourName) {
    const codes = {
        normal: "0",
        red: "31",
        green: "32",
        yellow: "33",
        blue: "34",
        magenta: "35",
        cyan: "36",
        white: "37",
        brightRed: "91",
        brightGreen: "92",
        brightYellow: "93",
        brightCyan: "96",
    };

    const code = codes[colourName] ?? codes.cyan;
    return `\x1b[${code}m${text}\x1b[0m`;
}

function openTailSafe(ns, width = 860, height = 920, x = 20, y = 20) {
    try {
        if (ns.ui?.openTail) {
            ns.ui.openTail();
        } else if (ns.tail) {
            ns.tail();
        }
    } catch {
        // Ignore UI failure.
    }

    try {
        if (ns.ui?.resizeTail) {
            ns.ui.resizeTail(width, height);
        } else if (ns.resizeTail) {
            ns.resizeTail(width, height);
        }
    } catch {
        // Ignore UI failure.
    }

    try {
        if (ns.ui?.moveTail) {
            ns.ui.moveTail(x, y);
        } else if (ns.moveTail) {
            ns.moveTail(x, y);
        }
    } catch {
        // Ignore UI failure.
    }
}