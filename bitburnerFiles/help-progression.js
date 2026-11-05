/**
 * help-progression.js — Player progression, faction/backdoors and opportunities
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="progression";
const TITLE="Player progression, faction/backdoors and opportunities";
const INTRO="These scripts support progression reporting and optional tasks; Singularity-enabled player automation is a separate milestone.";
const SCRIPTS=[
  {
    "file": "backdoor-check.js",
    "purpose": "Identify rooted/backdoor-eligible server targets",
    "command": "run backdoor-check.js",
    "effect": "reports manual targets"
  },
  {
    "file": "faction-control.js",
    "purpose": "Faction and reputation workflows",
    "command": "run faction-control.js",
    "effect": "inspect options"
  },
  {
    "file": "info-player.js",
    "purpose": "Character stats, factions and augmentations",
    "command": "run info-player.js",
    "effect": "read-only"
  },
  {
    "file": "info-progression-gaps.js",
    "purpose": "Missing dark-web programs and automation gaps",
    "command": "run info-progression-gaps.js",
    "effect": "read-only"
  },
  {
    "file": "info-infiltration.js",
    "purpose": "Infiltration location and reward discovery",
    "command": "run info-infiltration.js",
    "effect": "read-only"
  },
  {
    "file": "info-diagnostic.js",
    "purpose": "Collect progress into AI handoff",
    "command": "run info-diagnostic.js",
    "effect": "read-only"
  },
  {
    "file": "session-gains.js",
    "purpose": "Measure progression and gains over session",
    "command": "run session-gains.js",
    "effect": "report"
  }
];
const NOTES=[
  "Conventional Dark Web purchases and direct crime automation need Singularity access.",
  "An infiltration info report cannot complete infiltration minigames."
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
