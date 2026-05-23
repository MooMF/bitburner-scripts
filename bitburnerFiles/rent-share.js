/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    while (true) {
        await ns.share();
        await ns.sleep(1);
    }
}