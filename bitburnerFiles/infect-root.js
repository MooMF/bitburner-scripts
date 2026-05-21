/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const target = ns.args[0];

    if (!target) return -1;
    if (!ns.serverExists(target)) return -2;
    if (ns.hasRootAccess(target)) return 1;

    const portPrograms = [
        { name: "BruteSSH.exe", run: t => ns.brutessh(t) },
        { name: "FTPCrack.exe", run: t => ns.ftpcrack(t) },
        { name: "relaySMTP.exe", run: t => ns.relaysmtp(t) },
        { name: "HTTPWorm.exe", run: t => ns.httpworm(t) },
        { name: "SQLInject.exe", run: t => ns.sqlinject(t) }
    ];

    let opened = 0;

    for (const p of portPrograms) {
        if (!ns.fileExists(p.name, "home")) continue;

        try {
            p.run(target);
            opened++;
        } catch {
            // Ignore failed opener.
        }
    }

    const required = ns.getServerNumPortsRequired(target);

    if (opened >= required) {
        try {
            ns.nuke(target);
        } catch {
            return -3;
        }
    }

    return ns.hasRootAccess(target) ? 1 : 0;
}