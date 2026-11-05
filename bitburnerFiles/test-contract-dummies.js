/**
 * Game-validated solver tests. Only creates/attempts DUMMY .cct files on home,
 * never submits or deletes a real contract. Run after fixture tests.
 * run test-contract-dummies.js [samples=3] [type substring]
 */
import { SOLVERS, solveContract } from "./contract-solvers.js";
/** @param {NS} ns */
export async function main(ns){
 ns.disableLog("ALL");
 const count=Math.max(1,Math.min(20,Math.floor(Number(ns.args[0]??3))));
 const match=String(ns.args[1]??"").toLowerCase();
 const types=ns.codingcontract.getContractTypes();
 const results=[];
 for(const type of types){
   if(match&&!type.toLowerCase().includes(match))continue;
   if(!Object.hasOwn(SOLVERS,type)){results.push({type,status:"unsupported"});continue}
   for(let i=0;i<count;i++){
     let file="";
     try{
       file=ns.codingcontract.createDummyContract(type,"home");
       const data=ns.codingcontract.getData(file,"home");
       const answer=solveContract(type,data);
       const reward=ns.codingcontract.attempt(answer,file,"home",{returnReward:true});
       results.push({type,file,status:reward?"pass":"fail",answer:JSON.parse(JSON.stringify(answer,(_k,v)=>typeof v==="bigint"?v.toString():v))});
       if(!reward)ns.tprint(`FAILED dummy contract: ${type} (${file})`);
     }catch(e){results.push({type,file,status:"error",error:String(e)});ns.tprint(`ERROR dummy ${type}: ${e}`)}
     await ns.sleep(0);
   }
 }
 const report={timestamp:Date.now(),typesAvailable:types.length,
   typesImplemented:Object.keys(SOLVERS).length,
   passed:results.filter(r=>r.status==="pass").length,
   failed:results.filter(r=>r.status==="fail"||r.status==="error").length,results};
 ns.write("/data/manager/contracts-dummy-tests.json",JSON.stringify(report,null,2),"w");
 ns.tprint(`Dummy contracts: ${report.passed} passed, ${report.failed} failed. See /data/manager/contracts-dummy-tests.json`);
}
