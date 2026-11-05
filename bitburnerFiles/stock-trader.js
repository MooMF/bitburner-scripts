/**
 * Conservative 4S-only trading engine; opt-in live orders.
 * run stock-trader.js                 => dry-run single decision pass
 * run stock-trader.js --live          => live single pass
 * run stock-trader.js --live --loop   => live loop aligned to stock updates
 * run stock-trader.js --live --long-only
 * No API upgrades are purchased, and no shorts are opened. Existing shorts are left untouched.
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const flags=ns.flags([["live",false],["loop",false],["long-only",false],
    ["reserve",1e9],["max-position",0.15],["max-exposure",0.7],
    ["entry",0.60],["exit",0.52]]);
  if(!ns.stock.hasTixApiAccess() || !ns.stock.has4SDataTixApi()) {
    ns.tprint("Stock trader requires TIX + 4S TIX API; no orders placed.");
    return;
  }
  const live=Boolean(flags.live);
  const commission=ns.stock.getConstants().StockMarketCommission;
  const positionPct=Math.max(0,Math.min(1,Number(flags["max-position"])));
  const exposurePct=Math.max(0,Math.min(1,Number(flags["max-exposure"])));
  const reserve=Math.max(0,Number(flags.reserve));
  let cycle=0;
  do {
    const symbols=ns.stock.getSymbols();
    const rows=symbols.map(symbol=>{
      const [shares,average,shortShares]=ns.stock.getPosition(symbol);
      const bid=ns.stock.getBidPrice(symbol),ask=ns.stock.getAskPrice(symbol);
      return {symbol,shares,average,shortShares,bid,ask,
        forecast:ns.stock.getForecast(symbol),maxShares:ns.stock.getMaxShares(symbol)};
    });
    const cash=ns.getServerMoneyAvailable("home");
    const longValue=rows.reduce((a,r)=>a+r.shares*r.bid,0);
    const capital=cash+longValue;
    let budget=Math.max(0,Math.min(cash-reserve,capital*exposurePct-longValue));
    const actions=[];
    // Exit before entries. Short positions are deliberately never touched.
    for(const r of rows.filter(r=>r.shares>0 && r.forecast<Number(flags.exit))) {
      actions.push({action:"sell",symbol:r.symbol,shares:r.shares,forecast:r.forecast});
      if(live) {const price=ns.stock.sellStock(r.symbol,r.shares);
        actions[actions.length-1].executed=price>0;}
    }
    // Recompute after exits, including available exposure.
    const freshCash=live?ns.getServerMoneyAvailable("home"):cash;
    const freshLong=live?rows.reduce((a,r)=>a+ns.stock.getPosition(r.symbol)[0]*r.bid,0):longValue;
    budget=Math.max(0,Math.min(freshCash-reserve,capital*exposurePct-freshLong));
    for(const r of rows.filter(r=>r.forecast>=Number(flags.entry) && r.shortShares===0)
      .sort((a,b)=>b.forecast-a.forecast)) {
      const currentShares=live?ns.stock.getPosition(r.symbol)[0]:r.shares;
      const currentValue=currentShares*r.ask;
      const target=Math.min(capital*positionPct,r.maxShares*r.ask);
      const cap=Math.min(budget,target-currentValue);
      const shares=Math.max(0,Math.min(r.maxShares-currentShares,Math.floor((cap-commission)/r.ask)));
      if(shares<=0 || shares*r.ask<=commission*4) continue;
      const cost=shares*r.ask+commission;
      actions.push({action:"buy",symbol:r.symbol,shares,forecast:r.forecast,estimatedCost:cost});
      if(live){const price=ns.stock.buyStock(r.symbol,shares);actions[actions.length-1].executed=price>0;
        if(price>0) budget-=cost;}
      else budget-=cost;
    }
    const report={timestamp:Date.now(),cycle:++cycle,live,capital,cash,actions,
      policy:{reserve,positionPct,exposurePct,entry:flags.entry,exit:flags.exit},
      note:"4S long-only strategy. Dry-run does not simulate sale proceeds. No short orders."};
    ns.write("/data/manager/stock-trader.json",JSON.stringify(report,null,2),"w");
    ns.tprint(`Stock cycle ${cycle}: ${live?"LIVE":"DRY"}; ${actions.length} signals; report /data/manager/stock-trader.json`);
    if(!flags.loop) break;
    await ns.stock.nextUpdate();
  } while(true);
}
