/** 
 * info-player.js
 * Dumps current player/progression state for diagnostics.
 *
 * Usage:
 *   run info-player.js
 *   run info-player.js full
 *
 * Output:
 *   /data/manager/player.json
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const mode = String(ns.args[0] ?? "summary").toLowerCase();
    const full = mode === "full" || mode === "all";

    const reportFile = "/data/manager/player.json";

    const player = safeCall(() => ns.getPlayer(), null);
    const resetInfo = safeCall(() => ns.getResetInfo(), null);
    const moneySources = safeCall(() => ns.getMoneySources(), null);
    const ownedAugmentations = safeCall(() => ns.singularity?.getOwnedAugmentations?.(true), null);
    const ownedAugmentationsInstalled = safeCall(() => ns.singularity?.getOwnedAugmentations?.(false), null);
    const tor = safeCall(() => ns.hasTorRouter(), null);
    const bitNodeMultipliers = safeCall(() => ns.getBitNodeMultipliers(), null);

    const report = {
        context: "Bitburner player state report",
        schemaVersion: 1,
        generatedAt: Date.now(),
        generatedAtText: new Date().toISOString(),

        summary: buildSummary(ns, player, resetInfo, tor, ownedAugmentations, ownedAugmentationsInstalled),

        player: full ? player : compactPlayer(player),
        resetInfo,
        moneySources,
        ownedAugmentations,
        ownedAugmentationsInstalled,
        tor,
        bitNodeMultipliers,

        notes: {
            getPlayer: "Core player object from ns.getPlayer().",
            singularity: "Augmentation lists require Singularity access. Null means unavailable or inaccessible.",
            bitNodeMultipliers: "May require Source-File/API access. Null means unavailable or inaccessible."
        }
    };

    await ns.write(reportFile, JSON.stringify(report, null, 2), "w");

    printSummary(ns, report);

    ns.tprint(`Player state written to ${reportFile}`);

    return 1;
}

function buildSummary(ns, player, resetInfo, tor, ownedAugmentations, ownedAugmentationsInstalled) {
    if (!player) {
        return {
            ok: false,
            reason: "ns.getPlayer() returned null or failed"
        };
    }

    const skills = player.skills ?? {};
    const exp = player.exp ?? {};
    const mults = player.mults ?? {};

    return {
        ok: true,

        money: player.money ?? 0,
        city: player.city ?? null,
        location: player.location ?? null,

        hacking: skills.hacking ?? player.hacking ?? null,
        hackingExp: exp.hacking ?? player.hacking_exp ?? null,

        strength: skills.strength ?? player.strength ?? null,
        defense: skills.defense ?? player.defense ?? null,
        dexterity: skills.dexterity ?? player.dexterity ?? null,
        agility: skills.agility ?? player.agility ?? null,
        charisma: skills.charisma ?? player.charisma ?? null,
        intelligence: skills.intelligence ?? player.intelligence ?? null,

        hp: player.hp ?? null,

        factions: player.factions ?? [],
        jobs: player.jobs ?? {},

        tor,
        augmentationsOwnedTotal: Array.isArray(ownedAugmentations) ? ownedAugmentations.length : null,
        augmentationsInstalled: Array.isArray(ownedAugmentationsInstalled) ? ownedAugmentationsInstalled.length : null,

        currentNode: resetInfo?.currentNode ?? null,
        lastAugReset: resetInfo?.lastAugReset ?? null,
        lastNodeReset: resetInfo?.lastNodeReset ?? null,

        hackingMultipliers: {
            chance: mults.hacking_chance ?? null,
            speed: mults.hacking_speed ?? null,
            money: mults.hacking_money ?? null,
            growth: mults.hacking_grow ?? null,
            exp: mults.hacking_exp ?? null
        }
    };
}

function compactPlayer(player) {
    if (!player) return null;

    return {
        money: player.money,
        city: player.city,
        location: player.location,
        skills: player.skills,
        exp: player.exp,
        mults: player.mults,
        factions: player.factions,
        jobs: player.jobs,
        hp: player.hp
    };
}

function printSummary(ns, report) {
    const s = report.summary;

    ns.clearLog();
    ns.print("PLAYER STATE");
    ns.print("============");
    ns.print(`Generated:       ${report.generatedAtText}`);

    if (!s.ok) {
        ns.print(`ERROR:           ${s.reason}`);
        return;
    }

    ns.print(`Money:           ${money(ns, s.money)}`);
    ns.print(`City:            ${s.city ?? "-"}`);
    ns.print(`Location:        ${s.location ?? "-"}`);
    ns.print("");
    ns.print("Skills");
    ns.print("------");
    ns.print(`Hacking:         ${s.hacking ?? "-"}`);
    ns.print(`Hacking XP:      ${format(ns, s.hackingExp)}`);
    ns.print(`Strength:        ${s.strength ?? "-"}`);
    ns.print(`Defense:         ${s.defense ?? "-"}`);
    ns.print(`Dexterity:       ${s.dexterity ?? "-"}`);
    ns.print(`Agility:         ${s.agility ?? "-"}`);
    ns.print(`Charisma:        ${s.charisma ?? "-"}`);
    ns.print(`Intelligence:    ${s.intelligence ?? "-"}`);
    ns.print("");
    ns.print("Progression");
    ns.print("-----------");
    ns.print(`Current BitNode: ${s.currentNode ?? "-"}`);
    ns.print(`TOR:             ${s.tor}`);
    ns.print(`Factions:        ${(s.factions ?? []).join(", ") || "-"}`);
    ns.print(`Jobs:            ${Object.keys(s.jobs ?? {}).join(", ") || "-"}`);
    ns.print(`Augs installed:  ${s.augmentationsInstalled ?? "unavailable"}`);
    ns.print(`Augs total:      ${s.augmentationsOwnedTotal ?? "unavailable"}`);
    ns.print("");
    ns.print("Hacking multipliers");
    ns.print("-------------------");
    ns.print(`Chance:          ${format(ns, s.hackingMultipliers.chance)}`);
    ns.print(`Speed:           ${format(ns, s.hackingMultipliers.speed)}`);
    ns.print(`Money:           ${format(ns, s.hackingMultipliers.money)}`);
    ns.print(`Growth:          ${format(ns, s.hackingMultipliers.growth)}`);
    ns.print(`XP:              ${format(ns, s.hackingMultipliers.exp)}`);
    ns.print("");
    ns.print(`Written:         /data/manager/player.json`);
}

function safeCall(fn, fallback) {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function money(ns, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "$0";
    return "$" + ns.format.number(n, 2);
}

function format(ns, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return ns.format.number(n, 3);
}
