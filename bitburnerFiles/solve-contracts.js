/**
 * Contract execution. Dry-run is DEFAULT. Real contracts require --live.
 * run info-contracts.js
 * run solve-contracts.js --dry [--type <substring>] [--server <host>] [--file <file>]
 * run solve-contracts.js --live [same filters]
 * Only the original server/file handles are used. No remote .cct copying.
 */
import { SOLVERS, solveContract } from "./contract-solvers.js";
/** @param {NS} ns */
export async function main(ns){
  ns.disableLog("ALL");
  const opts={live:false,type:"",server:"",file:"",silent:false,force:false};
  for(let i=0;i<ns.args.length;i++){
    const a=String(ns.args[i]).toLowerCase();
    if(a==="--live")opts.live=true;
    else if(a==="--dry"||a==="--dry-run")opts.live=false;
    else if(a==="--silent")opts.silent=true;
    else if(a==="--type")opts.type=String(ns.args[++i]||"").toLowerCase();
    else if(a==="--server")opts.server=String(ns.args[++i]||"");
    else if(a==="--file")opts.file=String(ns.args[++i]||"");
  }
  const input="/data/manager/contracts.json",output="/data/manager/contracts-solve-results.json";
  if(!ns.fileExists(input,"home")){ns.tprint("Run info-contracts.js before solving.");return}
  let inventory;
  try{inventory=JSON.parse(ns.read(input))}catch(e){ns.tprint("Invalid contract inventory: "+e);return}
  const queue=Array.isArray(inventory.solveQueue)?inventory.solveQueue:inventory.rawContracts||[];
  const seen=new Set(),results=[];
  for(const row of queue){
    const server=row.server||row.handle?.server,file=row.file||row.handle?.file;
    if(!server||!file||row.valid===false)continue;
    if(opts.server&&opts.server!==server)continue;
    if(opts.file&&opts.file!==file&&opts.file!==file.split("/").at(-1))continue;
    const handle=server+"\u0000"+file;
    if(seen.has(handle))continue;seen.add(handle);
    const result={server,file,type:row.type||"",computed:false,solved:false,failed:false,skipped:false,reward:"",error:"",triesRemaining:null,answer:null};
    results.push(result);
    try{
      if(!ns.serverExists(server)||!ns.fileExists(file,server)){result.skipped=true;result.error="Contract missing";continue}
      const type=ns.codingcontract.getContractType(file,server);
      result.type=type;
      if(opts.type&&!type.toLowerCase().includes(opts.type)) {result.skipped=true;continue}
      if(!Object.hasOwn(SOLVERS,type)){result.skipped=true;result.error="Unsupported contract type";continue}
      result.triesRemaining=ns.codingcontract.getNumTriesRemaining(file,server);
      if(result.triesRemaining<=0){result.skipped=true;result.error="No attempts remain";continue}
      const data=ns.codingcontract.getData(file,server);
      const answer=solveContract(type,data);
      result.computed=true;
      result.answer=JSON.parse(JSON.stringify(answer,(_k,v)=>typeof v==="bigint"?v.toString():v));
      if(!opts.live)continue;
      const reward=ns.codingcontract.attempt(answer,file,server,{returnReward:true});
      result.solved=Boolean(reward);
      result.failed=!result.solved;
      result.reward=reward||"";
      if(result.failed)result.error="Game rejected answer; do not repeat until solver is fixed.";
    }catch(e){result.failed=true;result.error=String(e)}
    if(!opts.silent)ns.print(`[${result.solved?"SOLVED":result.failed?"FAIL":result.skipped?"SKIP":"DRY"}] ${result.type} ${server}/${file} ${result.error}`);
  }
  const summary={total:results.length,computed:results.filter(x=>x.computed).length,
    solved:results.filter(x=>x.solved).length,failed:results.filter(x=>x.failed).length,
    skipped:results.filter(x=>x.skipped).length,unsupported:results.filter(x=>x.error==="Unsupported contract type").length};
  const report={timestamp:Date.now(),dryRun:!opts.live,source:input,summary,results};
  ns.write(output,JSON.stringify(report,null,2),"w");
  ns.tprint(`Contracts: ${summary.computed} computed, ${summary.solved} solved, ${summary.failed} failed, ${summary.unsupported} unsupported; ${opts.live?"LIVE":"DRY"}; ${output}`);
}
