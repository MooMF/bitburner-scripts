/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const target = ns.args[0];
    const parent = ns.args[1] ?? ns.getHostname();

    if (!target) return -1;
    if (!ns.serverExists(target)) return -2;
    if (!ns.hasRootAccess(target)) return -3;

    startIfPossible(ns, target, "infect.js", 1, parent);

    await ns.sleep(10);

    startIfPossible(ns, target, "iteration.js", 1);

    await ns.sleep(10);

    if (ns.getServerMaxMoney(target) > 0) {
        startIfPossible(ns, target, "process.js", 1, target);
    }

    return 1;
}

function startIfPossible(ns, host, script, threads, ...args) {
    if (!ns.fileExists(script, host)) return 0;

    const alreadyRunning = ns.ps(host)
        .some(p => p.filename === script && sameArgs(p.args, args));

    if (alreadyRunning) return 0;

    const ram = ns.getScriptRam(script, host);
    if (ram <= 0) return 0;

    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (free < ram * threads) return 0;

    return ns.exec(script, host, threads, ...args);
}

function sameArgs(a, b) {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
        if (String(a[i]) !== String(b[i])) return false;
    }

    return true;
}