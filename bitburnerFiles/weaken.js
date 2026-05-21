/** @param {NS} ns **/
export async function main(ns) {
    const target = ns.args[0] ?? ns.getHostname();

    if (target === "home") return 0;
    if (!ns.hasRootAccess(target)) return -1;

    await ns.weaken(target);
    return 1;
}