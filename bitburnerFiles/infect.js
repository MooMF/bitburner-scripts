/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const here = ns.getHostname();
    const parent = ns.args[0] ?? null;

    if (here === "home") return 0;

    const stageScripts = [
        "infect-root.js",
        "infect-deploy.js",
        "infect-start.js"
    ];

    for (const script of stageScripts) {
        if (ns.fileExists(script, "home")) {
            await ns.scp(script, here, "home");
            await ns.sleep(5);
        }
    }

    const neighbours = ns.scan(here)
        .filter(s => s !== "home")
        .filter(s => s !== parent);

    for (const target of neighbours) {
        await ns.sleep(25);

        if (!ns.serverExists(target)) continue;

        await runStage(ns, "infect-root.js", target);

        if (!ns.hasRootAccess(target)) continue;

        await runStage(ns, "infect-deploy.js", target);
        await runStage(ns, "infect-start.js", target, here);
    }

    return 1;
}

async function runStage(ns, script, ...args) {
    const host = ns.getHostname();

    if (!ns.fileExists(script, host)) return 0;

    const ram = ns.getScriptRam(script, host);
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);

    if (ram <= 0 || free < ram) return 0;

    const pid = ns.exec(script, host, 1, ...args);

    if (pid === 0) return 0;

    while (ns.isRunning(pid)) {
        await ns.sleep(50);
    }

    return 1;
}