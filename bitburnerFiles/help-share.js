/**
 * help-share.js — Spare RAM, faction share, and hacking XP
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="share";
const TITLE="Spare RAM, faction share, and hacking XP";
const INTRO="The share/rent path occupies spare memory and can conflict with bursty hacking workload; monitor headroom.";
const SCRIPTS=[
  {
    "file": "rent-capacity.js",
    "purpose": "Distribute share workload over spare RAM",
    "command": "(managed by startup.js)",
    "effect": "long-lived manager"
  },
  {
    "file": "rent-share.js",
    "purpose": "Repeated ns.share() worker",
    "command": "(managed by rent-capacity.js)",
    "effect": "worker"
  },
  {
    "file": "info-share.js",
    "purpose": "Measure active share threads and fleet headroom",
    "command": "run info-share.js",
    "effect": "read-only report"
  },
  {
    "file": "check-infection.js",
    "purpose": "Show spare capacity",
    "command": "run check-infection.js share",
    "effect": "read-only"
  },
  {
    "file": "xp-farm.js",
    "purpose": "Dedicated hacking XP farming mode",
    "command": "run xp-farm.js nwo 1024 false 10000 60",
    "effect": "changes active workload"
  },
  {
    "file": "faction-control.js",
    "purpose": "Faction-oriented operations and share support",
    "command": "run faction-control.js",
    "effect": "inspect its args before running"
  },
  {
    "file": "clean.js",
    "purpose": "Release sharing memory",
    "command": "run clean.js share",
    "effect": "stops workers"
  }
];
const NOTES=[
  "XP farming and share placement compete for RAM; plan the mode before launching.",
  "The player/faction workflow is not fully automated without Singularity."
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
