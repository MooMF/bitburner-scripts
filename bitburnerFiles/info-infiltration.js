/** Read-only infiltration opportunities; does not automate minigames. @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const report={timestamp:Date.now(),locations:[],errors:[]};
  try {
    for(const location of ns.infiltration.getPossibleLocations()){
      try {report.locations.push({location,details:ns.infiltration.getInfiltration(location.name)});}
      catch(e){report.errors.push({location,error:String(e)});}
    }
  } catch(e){report.errors.push(String(e));}
  ns.write("/data/manager/infiltration.json",JSON.stringify(report,null,2),"w");
  ns.tprint(`Infiltration: ${report.locations.length} locations, ${report.errors.length} errors; /data/manager/infiltration.json`);
}
