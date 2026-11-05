/** Read-only stock snapshot. No purchases, sales or API unlocks. @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const output="/data/manager/stocks.json";
  let report={timestamp:Date.now(),available:false,symbols:[],positions:[],message:""};
  try {
    if (!ns.stock.hasTixApiAccess()) {
      report.message="TIX API access required; no unlock is purchased automatically.";
    } else {
      report.available=true;
      const fourS=ns.stock.has4SDataTixApi();
      report.fourS=fourS;
      report.cash=ns.getServerMoneyAvailable("home");
      for(const symbol of ns.stock.getSymbols()) {
        const [longShares,longAvg,shortShares,shortAvg]=ns.stock.getPosition(symbol);
        const row={symbol,price:ns.stock.getPrice(symbol),ask:ns.stock.getAskPrice(symbol),
          bid:ns.stock.getBidPrice(symbol),maxShares:ns.stock.getMaxShares(symbol),
          longShares,longAvg,shortShares,shortAvg};
        if(fourS) {row.forecast=ns.stock.getForecast(symbol);row.volatility=ns.stock.getVolatility(symbol);}
        report.symbols.push(row);
      }
      report.positions=report.symbols.filter(x=>x.longShares||x.shortShares);
      report.message=`Found ${report.symbols.length} stocks, ${report.positions.length} positions; 4S API: ${fourS}`;
    }
  } catch(e) {report.message=String(e);}
  ns.write(output,JSON.stringify(report,null,2),"w");
  ns.tprint(report.message+" | "+output);
}
