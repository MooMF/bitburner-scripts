/**
 * check-infection.js
 * Compatibility entry point for the Bitburner management console.
 *
 * Usage:
 *   run check-infection.js
 *   run check-infection.js security
 *   run check-infection.js money
 *   run check-infection.js payouts
 *   run check-infection.js server 4sigma
 *
 * This script intentionally stays small. The detailed tables live in child scripts.
 * The manager console runs those child scripts, reads their JSON reports, and prints
 * a high-level operational view.
 *
 * @param {NS} ns
 **/
export async function main(ns) {
    ns.disableLog("ALL");

    const manager = "manager-console.js";
    const args = ns.args.map(String);

    if (!ns.fileExists(manager, "home")) {
        ns.tprint(`ERROR: ${manager} is missing from home.`);
        ns.tprint("Install manager-console.js plus the info-* child scripts, then run this again.");
        return;
    }

    const pid = ns.run(manager, 1, ...args);
    if (!pid) {
        ns.tprint(`ERROR: Could not start ${manager}. Close an old console or free home RAM.`);
        return;
    }

    ns.tprint(`Started ${manager} ${args.join(" ")}`.trim());
}
