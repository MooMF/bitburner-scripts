/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const nonce = String(ns.args[0] ?? "");

    while (true) {
        try {
            await ns.share();
        } catch (err) {
            ns.print(`share failed ${nonce ? `(${nonce})` : ""}: ${String(err)}`);
            await ns.sleep(1000);
        }

        await ns.sleep(1);
    }
}