/**
 * help-darknet.js — Darknet — planned distributed discovery
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="darknet";
const TITLE="Darknet — planned distributed discovery";
const INTRO="No live Darknet manager or worm is installed. This help page documents the architecture proposal only.";
const SCRIPTS=[
  {
    "file": "docs/DARKNET_SWARM_DESIGN.md",
    "purpose": "Proposed manager, worm and relay topology",
    "command": "(repository documentation)",
    "effect": "design only"
  },
  {
    "file": "info-progression-gaps.js",
    "purpose": "Current outstanding progression features",
    "command": "run info-progression-gaps.js",
    "effect": "read-only"
  },
  {
    "file": "help-network.js",
    "purpose": "Compare traditional infection with Darknet topology",
    "command": "run help-network.js",
    "effect": "read-only"
  }
];
const NOTES=[
  "Darknet uses ns.dnet, not ordinary ns.scan and ns.nuke.",
  "Authenticated access and execution permissions are per-session, and servers are ephemeral.",
  "Any future implementation should retain observations on home with timestamp/epoch, deduplicate gossip and expire stale links.",
  "This is not an executable Darknet propagation tool."
];

export async function main(ns){
    ns.disableLog("ALL");
    const options=ns.flags([["short",false],["json",false],["missing",false]]);
    const host=ns.getHostname();
    const found=SCRIPTS.map(item=>({
        ...item,
        installed:item.file.endsWith(".js") ? ns.fileExists(item.file,host) || (host!=="home"&&ns.fileExists(item.file,"home")) : null
    }));
    if(options.json){
        ns.tprint(JSON.stringify({subject:SUBJECT,title:TITLE,intro:INTRO,scripts:found,notes:NOTES},null,2));
        return;
    }
    try{ns.ui.openTail();ns.ui.resizeTail(1110,690);ns.ui.moveTail(20,20)}catch(_){try{ns.tail()}catch(_){}}
    ns.clearLog();
    ns.print("HELP: "+TITLE.toUpperCase());
    ns.print("=".repeat(112));
    ns.print(INTRO);
    ns.print("");
    for(const item of found){
        if(options.missing && item.installed!==false)continue;
        const marker=item.installed===null?"DOC":item.installed?"OK":"MISSING";
        ns.print("["+marker+"] "+item.file+" — "+item.purpose);
        ns.print("      "+item.command);
        if(!options.short)ns.print("      "+item.effect);
    }
    if(!options.short){
        ns.print("");
        ns.print("NOTES");
        ns.print("-".repeat(112));
        for(const note of NOTES)ns.print("• "+note);
        ns.print("");
        ns.print("Options: --short | --missing | --json");
    }
}
