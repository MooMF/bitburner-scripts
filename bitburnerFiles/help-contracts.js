/**
 * help-contracts.js — Coding contracts: discovery, solution and verification
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="contracts";
const TITLE="Coding contracts: discovery, solution and verification";
const INTRO="Contract solver catalogue implements the known game types. All real submissions require explicit --live; dry-run is default.";
const SCRIPTS=[
  {
    "file": "info-contracts.js",
    "purpose": "Discover every live .cct handle; no attempts",
    "command": "run info-contracts.js",
    "effect": "writes /data/manager/contracts.json"
  },
  {
    "file": "info-contract-triage.js",
    "purpose": "Classify by solver support and review difficulty",
    "command": "run info-contract-triage.js",
    "effect": "writes /data/manager/contracts-triage.json"
  },
  {
    "file": "contract-solvers.js",
    "purpose": "Shared library of deterministic solvers",
    "command": "(import only)",
    "effect": "library; do not run directly"
  },
  {
    "file": "test-contract-fixtures.js",
    "purpose": "Run fixed deterministic test cases",
    "command": "run test-contract-fixtures.js",
    "effect": "writes /data/manager/contracts-fixture-tests.json"
  },
  {
    "file": "test-contract-dummies.js",
    "purpose": "Create and solve dummy contracts in-game",
    "command": "run test-contract-dummies.js 3",
    "effect": "dummy game submissions only"
  },
  {
    "file": "solve-contracts.js",
    "purpose": "Compute solutions without spending tries (default)",
    "command": "run solve-contracts.js --dry",
    "effect": "writes /data/manager/contracts-solve-results.json"
  },
  {
    "file": "solve-contracts.js",
    "purpose": "Submit solutions to real contracts",
    "command": "run solve-contracts.js --live",
    "effect": "LIVE: uses contract tries"
  }
];
const NOTES=[
  "Run fixture and dummy tests before real submissions; a computed answer is not a game acceptance.",
  "Filter solve-contracts.js by --type <substring>, --server <host> and --file <file>.",
  "The inventory stores server+file references; never copy remote .cct files home.",
  "After successful contracts disappear, refresh inventory before another submission pass."
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
