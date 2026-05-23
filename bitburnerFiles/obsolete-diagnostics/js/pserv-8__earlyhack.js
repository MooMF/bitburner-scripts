/** @param {NS} ns */
export async function main(ns) {
    const target = ns.args[0] ?? "n00dles";
    const debug = ns.args[1] ?? false;

    if (!target) {
        ns.tprint("Usage: run earlyHack.js [target] [debug=true|false]");
        return;
    }

    const log = (...args) => { if (debug) ns.tprint(...args); };

    // Thresholds
    const maxMoney = ns.getServerMaxMoney(target);
    const moneyThresh = maxMoney * 0.9; // grow until 90% of max
    const securityBase = ns.getServerMinSecurityLevel(target);
    const securityThresh = securityBase + 2; // allow a small buffer

    ns.tprint(`Target: ${target}`);
    ns.tprint(`Max money: ${maxMoney}`);
    ns.tprint(`Money threshold: ${moneyThresh}`);
    ns.tprint(`Min security: ${securityBase}`);
    ns.tprint(`Security threshold: ${securityThresh}`);

    // Ensure we have root access
    if (!ns.hasRootAccess(target)) {
        const portsRequired = ns.getServerNumPortsRequired(target);
        let portsOpened = 0;

        if (ns.fileExists("BruteSSH.exe", "home")) { ns.brutessh(target); portsOpened++; }
        if (ns.fileExists("FTPCrack.exe", "home")) { ns.ftpcrack(target); portsOpened++; }
        if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(target); portsOpened++; }
        if (ns.fileExists("HTTPWorm.exe", "home")) { ns.httpworm(target); portsOpened++; }
        if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(target); portsOpened++; }

        if (portsOpened >= portsRequired) {
            ns.nuke(target);
            ns.tprint(`Gained root access on ${target}`);
        } else if (portsRequired === 0) {
            ns.nuke(target);
            ns.tprint(`Gained root access on ${target} (no ports required)`);
        } else {
            ns.tprint(`Not enough port openers for ${target}: need ${portsRequired}, have ${portsOpened}`);
            return;
        }

        let servers = ns.scan();
        ns.tprintRaw(JSON.stringify(servers));
    }

    // Main Hack loop
    while (true) {
        const secLvl = ns.getServerSecurityLevel(target);
        const moneyAvail = ns.getServerMoneyAvailable(target);

        if (secLvl > securityThresh) {
            const result = await ns.weaken(target);
            log(`Weaken completed, result: ${result}`);
        } else if (moneyAvail < moneyThresh) {
            const result = await ns.grow(target);
            log(`Grow completed, result: ${result}`);
        } else {
            const stolen = await ns.hack(target);
            log(`Hack completed, stole: ${stolen}`);
        }

        await ns.sleep(1000);
    }
}
