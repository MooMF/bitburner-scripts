/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const target = ns.args[0];

    if (!target) return -1;
    if (!ns.serverExists(target)) return -2;
    if (!ns.hasRootAccess(target)) return -3;

    const processRunning = ns.ps(target).some(p => p.filename === "process.js");

    // Avoid disrupting already-managed servers during optional worm propagation.
    if (processRunning) return 0;

    const managedScripts = [
        "infect.js",
        "infect-root.js",
        "infect-deploy.js",
        "infect-start.js",
        "process.js",
        "iteration.js",
        "weaken.js",
        "grow.js",
        "hack.js"
    ];

    for (const script of managedScripts) {
        if (ns.scriptRunning(script, target)) {
            ns.scriptKill(script, target);
            await ns.sleep(5);
        }
    }

    for (const script of managedScripts) {
        if (ns.fileExists(script, target)) {
            ns.rm(script, target);
        }
    }

    for (const script of managedScripts) {
        if (!ns.fileExists(script, "home")) continue;

        try {
            await ns.scp(script, target, "home");
            await ns.sleep(5);
        } catch {
            // Ignore failed copy.
        }
    }

    return 1;
}