/**
 * help-market.js — Stock market and trading
 * Generated from the dependency and usage audit.
 * Pure read-only help. Run on home or any server where this file is present.
 * @param {NS} ns
 */
const SUBJECT="market";
const TITLE="Stock market and trading";
const INTRO="Trading requires TIX + 4S TIX API. Read-only reporting works with TIX; no purchases are made by the reporting tools.";
const SCRIPTS=[
  {
    "file": "info-stock.js",
    "purpose": "Read-only stock inventory, prices, positions and 4S signals",
    "command": "run info-stock.js",
    "effect": "writes /data/manager/stocks.json"
  },
  {
    "file": "check-infection.js",
    "purpose": "Unified console, detailed market page",
    "command": "run check-infection.js marketing",
    "effect": "read-only"
  },
  {
    "file": "manager-console.js",
    "purpose": "Legacy alias for check-infection.js",
    "command": "run manager-console.js market",
    "effect": "read-only"
  },
  {
    "file": "stock-trader.js",
    "purpose": "4S long-only strategy, dry-run by default",
    "command": "run stock-trader.js",
    "effect": "writes /data/manager/stock-trader.json"
  },
  {
    "file": "stock-trader.js",
    "purpose": "Single live trading pass (spends money)",
    "command": "run stock-trader.js --live",
    "effect": "LIVE: buy/sell"
  },
  {
    "file": "stock-trader.js",
    "purpose": "Continuous strategy execution",
    "command": "run stock-trader.js --live --loop",
    "effect": "LIVE: recurring orders"
  },
  {
    "file": "startup.js",
    "purpose": "Normal orchestrator, opens market console when ready",
    "command": "run startup.js --marketing",
    "effect": "does NOT start trading"
  }
];
const NOTES=[
  "Trader flags: --reserve, --max-position, --max-exposure, --entry, --exit, --live and --loop.",
  "Existing short positions are reported but not traded or closed by the long-only engine.",
  "The trading budget is not coordinated with concurrent server purchases.",
  "'marketing' is accepted as an alias for 'market' for backwards compatibility."
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
