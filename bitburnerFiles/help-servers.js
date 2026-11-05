/**
 * help-servers.js — Purchased servers, resource assignment and cleanup
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="servers";
const TITLE="Purchased servers, resource assignment and cleanup";
const INTRO="Purchased-server capacity changes require deployment and reassignment before the fleet is fully utilized.";
const SCRIPTS=[
  {
    "file": "buy-servers.js",
    "purpose": "Purchase/upgrade managed servers; ratio is fraction of cash",
    "command": "run buy-servers.js 0.4",
    "effect": "spends money"
  },
  {
    "file": "startup.js",
    "purpose": "Optional purchase during clean startup",
    "command": "run startup.js true true 0.4",
    "effect": "spends money"
  },
  {
    "file": "assign-targets.js",
    "purpose": "Place target managers on available hosts",
    "command": "run assign-targets.js 1 2",
    "effect": "starts process managers"
  },
  {
    "file": "clean.js",
    "purpose": "Stop managed framework processes across network",
    "command": "run clean.js managed",
    "effect": "destructive to running jobs"
  },
  {
    "file": "clean.js",
    "purpose": "Stop only rent/share processes",
    "command": "run clean.js share",
    "effect": "destructive to share jobs"
  },
  {
    "file": "check-infection.js",
    "purpose": "Memory, work distribution, server ownership",
    "command": "run check-infection.js runtime",
    "effect": "read-only"
  },
  {
    "file": "info-startup-config.js",
    "purpose": "Recommend adaptive configuration",
    "command": "run info-startup-config.js",
    "effect": "diagnostics"
  }
];
const NOTES=[
  "Re-run startup.js after buying or upgrading servers.",
  "Avoid clean.js all unless intentionally stopping dashboards and other managed processes.",
  "Defaults and flags are listed in the startup.js source and STARTUP_v2_4.md."
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
