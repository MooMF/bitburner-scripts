/**
 * manager-console.js
 * Backwards-compatible alias for the unified check-infection.js console.
 * Modes and arguments are passed through unchanged; no duplicate reporting logic.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    if (ns.getHostname() !== "home") {
        ns.tprint("Run the management console on home.");
        return;
    }
    if (!ns.fileExists("check-infection.js", "home")) {
        ns.tprint("Missing check-infection.js (canonical console).");
        return;
    }
    const pid = ns.run("check-infection.js", 1, ...ns.args);
    if (!pid) ns.tprint("Unable to launch check-infection.js: free home RAM or close an existing console.");
}
