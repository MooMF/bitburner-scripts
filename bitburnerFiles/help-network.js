/**
 * help-network.js — Network discovery, infection and hacking workers
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="network";
const TITLE="Network discovery, infection and hacking workers";
const INTRO="Normal production route is centralized upload.js followed by assign-targets.js. The staged infection chain is retained as an optional legacy path.";
const SCRIPTS=[
  {
    "file": "startup.js",
    "purpose": "Orchestrate clean, purchase, deploy, assignments, share, console",
    "command": "run startup.js true false",
    "effect": "orchestrator"
  },
  {
    "file": "upload.js",
    "purpose": "Root and deploy scripts to rooted servers",
    "command": "run upload.js",
    "effect": "disrupts/restarts target workers"
  },
  {
    "file": "assign-targets.js",
    "purpose": "Allocate low-RAM targets to worker hosts",
    "command": "run assign-targets.js 1 2",
    "effect": "starts process.js on selected hosts"
  },
  {
    "file": "process.js",
    "purpose": "Persistent target controller: weaken/grow/hack decisions",
    "command": "(managed by upload/assign-targets)",
    "effect": "not normally manual"
  },
  {
    "file": "weaken.js",
    "purpose": "One-shot weaken worker",
    "command": "(managed by process.js)",
    "effect": "worker"
  },
  {
    "file": "grow.js",
    "purpose": "One-shot grow worker",
    "command": "(managed by process.js)",
    "effect": "worker"
  },
  {
    "file": "hack.js",
    "purpose": "One-shot hack worker",
    "command": "(managed by process.js)",
    "effect": "worker"
  },
  {
    "file": "iteration.js",
    "purpose": "Discover and catalogue files on rooted hosts",
    "command": "(managed by upload.js)",
    "effect": "file enumeration"
  },
  {
    "file": "infect.js",
    "purpose": "Optional staged network propagation coordinator",
    "command": "(legacy optional)",
    "effect": "candidate for retirement review"
  },
  {
    "file": "infect-root.js",
    "purpose": "Optional propagation: gain root",
    "command": "(used by infect.js)",
    "effect": "candidate for retirement review"
  },
  {
    "file": "infect-deploy.js",
    "purpose": "Optional propagation: copy payload",
    "command": "(used by infect.js)",
    "effect": "candidate for retirement review"
  },
  {
    "file": "infect-start.js",
    "purpose": "Optional propagation: start runtime",
    "command": "(used by infect.js)",
    "effect": "candidate for retirement review"
  },
  {
    "file": "start-processes.js",
    "purpose": "Old standalone process launcher/diagnostic",
    "command": "run start-processes.js",
    "effect": "candidate for retirement review"
  }
];
const NOTES=[
  "The four infect-*.js modules still have mutual references and are deployed by upload.js.",
  "Do not delete the infection chain merely because it is not used on the default path.",
  "The manager console shows network status: run check-infection.js runtime."
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
