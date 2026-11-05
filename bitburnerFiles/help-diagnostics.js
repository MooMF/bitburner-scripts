/**
 * help-diagnostics.js — Management console, diagnostics and operating reports
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="diagnostics";
const TITLE="Management console, diagnostics and operating reports";
const INTRO="check-infection.js is the canonical unified management console. manager-console.js is an alias, not a second report engine.";
const SCRIPTS=[
  {
    "file": "check-infection.js",
    "purpose": "Overview and operational recommendations",
    "command": "run check-infection.js",
    "effect": "canonical"
  },
  {
    "file": "check-infection.js",
    "purpose": "Dedicated subviews",
    "command": "run check-infection.js security",
    "effect": "money|security|payouts|runtime|share|xp|actions|server <name>|marketing"
  },
  {
    "file": "manager-console.js",
    "purpose": "Backwards-compatible entrypoint",
    "command": "run manager-console.js",
    "effect": "forwards args"
  },
  {
    "file": "info-money.js",
    "purpose": "Target money state",
    "command": "run info-money.js",
    "effect": "generates /data/manager/money.json"
  },
  {
    "file": "info-security.js",
    "purpose": "Security backlog and weaken ETA",
    "command": "run info-security.js",
    "effect": "generates /data/manager/security.json"
  },
  {
    "file": "info-payouts.js",
    "purpose": "Estimated hacking payouts",
    "command": "run info-payouts.js",
    "effect": "generates /data/manager/payouts.json"
  },
  {
    "file": "info-runtime.js",
    "purpose": "Workers, managers, RAM and root status",
    "command": "run info-runtime.js",
    "effect": "generates /data/manager/runtime.json"
  },
  {
    "file": "info-share.js",
    "purpose": "Shared workload and capacity",
    "command": "run info-share.js",
    "effect": "generates /data/manager/share.json"
  },
  {
    "file": "info-player.js",
    "purpose": "Player progression snapshot",
    "command": "run info-player.js",
    "effect": "read-only"
  },
  {
    "file": "info-diagnostic.js",
    "purpose": "Consolidated AI handoff diagnostic JSON",
    "command": "run info-diagnostic.js",
    "effect": "writes /data/manager/ai-diagnostic.json"
  },
  {
    "file": "info-startup-config.js",
    "purpose": "Suggested startup configuration",
    "command": "run info-startup-config.js",
    "effect": "read-only"
  },
  {
    "file": "session-gains.js",
    "purpose": "Session income and rate estimates",
    "command": "run session-gains.js",
    "effect": "report"
  },
  {
    "file": "logview.js",
    "purpose": "Inspect logs for one server",
    "command": "run logview.js n00dles",
    "effect": "read-only"
  }
];
const NOTES=[
  "Console subviews call focused info-*.js reporters. Do not run the reporters from remote hosts unless supported.",
  "The compatibility alias requires check-infection.js on home.",
  "Some reporters collect by reading processes rather than by launching managed workers."
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
