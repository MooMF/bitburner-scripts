/** Read-only audit of unavailable base-game automation. @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const programs=["BruteSSH.exe","FTPCrack.exe","relaySMTP.exe","HTTPWorm.exe",
    "SQLInject.exe","AutoLink.exe","DeepscanV1.exe","DeepscanV2.exe","ServerProfiler.exe",
    "Formulas.exe","NUKE.exe"];
  const inventory=programs.map(name=>({name,owned:ns.fileExists(name,"home")}));
  const report={timestamp:Date.now(),programs:inventory,
    missing:inventory.filter(x=>!x.owned).map(x=>x.name),
    notes:[
      "Dark Web program buying and player crime execution use Singularity; no automatic actions without API access.",
      "Darknet (ns.dnet) is separate from the legacy Dark Web; dynamic network operations need isolated testing.",
      "Infiltration has read-only discovery APIs, not an API for completing minigames.",
      "Use info-contracts.js and info-contract-triage.js to audit solver coverage."
    ]};
  ns.write("/data/manager/progression-gaps.json",JSON.stringify(report,null,2),"w");
  ns.tprint("Missing home programs: "+(report.missing.join(", ")||"none")+
    " | /data/manager/progression-gaps.json");
}
