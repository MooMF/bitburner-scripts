/**
 * contract-help.js — compatibility alias for help-contracts.js.
 * @param {NS} ns
 */
export async function main(ns){
    ns.disableLog("ALL");
    if(!ns.fileExists("help-contracts.js","home")){ns.tprint("Missing help-contracts.js");return;}
    const pid=ns.run("help-contracts.js",1,...ns.args);
    if(!pid)ns.tprint("Unable to launch help-contracts.js");
}
