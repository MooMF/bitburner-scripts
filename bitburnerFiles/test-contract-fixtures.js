/**
 * Deterministic fixture suite; never submits contracts.
 * run test-contract-fixtures.js
 */
import { solveContract, SUPPORTED_TYPES } from "./contract-solvers.js";
/** @param {NS} ns */
export async function main(ns){
 const cases=[
  ["Find Largest Prime Factor",13195,29],
  ["Subarray with Maximum Sum",[-2,1,-3,4,-1,2,1,-5,4],6],
  ["Total Ways to Sum",5,6],
  ["Total Ways to Sum II",[10,[2,5,3,6]],5],
  ["Spiralize Matrix",[[1,2,3],[4,5,6],[7,8,9]],[1,2,3,6,9,8,7,4,5]],
  ["Array Jumping Game",[2,3,1,1,4],1],
  ["Array Jumping Game",[0],1],
  ["Array Jumping Game",[0,1],0],
  ["Array Jumping Game II",[2,3,1,1,4],2],
  ["Array Jumping Game II",[0,2],0],
  ["Merge Overlapping Intervals",[[1,3],[2,6],[8,10],[15,18]],[[1,6],[8,10],[15,18]]],
  ["Generate IP Addresses","25525511135",["255.255.11.135","255.255.111.35"]],
  ["Algorithmic Stock Trader I",[7,1,5,3,6,4],5],
  ["Algorithmic Stock Trader II",[7,1,5,3,6,4],7],
  ["Algorithmic Stock Trader III",[3,3,5,0,0,3,1,4],6],
  ["Algorithmic Stock Trader IV",[2,[3,3,5,0,0,3,1,4]],6],
  ["Minimum Path Sum in a Triangle",[[2],[3,4],[6,5,7],[4,1,8,3]],11],
  ["Unique Paths in a Grid I",[3,7],28],
  ["Unique Paths in a Grid II",[[0,0,0],[0,1,0],[0,0,0]],2],
  ["Shortest Path in a Grid",[[0,0,0],[1,1,0],[0,0,0]],"RRDD"],
  ["Sanitize Parentheses in Expression","()())()",["(())()","()()()"]],
  ["Find All Valid Math Expressions",["123",6],["1+2+3","1*2*3"]],
  ["HammingCodes: Integer to Encoded Binary",0,"0000"],
  ["HammingCodes: Encoded Binary to Integer","0000",0],
  ["Proper 2-Coloring of a Graph",[4,[[0,1],[1,2],[2,3]]],[0,1,0,1]],
  ["Proper 2-Coloring of a Graph",[3,[[0,1],[1,2],[2,0]]],[]],
  ["Compression I: RLE Compression","aaaaaaaaaaaa","9a3a"],
  ["Compression II: LZ Decompression","5aaabb0103","aaabbabb"],
  ["Encryption I: Caesar Cipher",["BCD",1],"ABC"],
  ["Encryption II: Vigenère Cipher",["ATTACKATDAWN","LEMON"],"LXFOPVEFRNHR"],
  ["Square Root","17","4"],
  ["Total Number of Primes",[10,20],4],
  ["Largest Rectangle in a Matrix",[[1,1,0],[1,1,1]],[[0,0],[1,1]]]
 ];
 const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const results=cases.map(([type,data,expected])=>{
   try{const actual=solveContract(type,data);return {type,pass:eq(actual,expected),actual,expected}}
   catch(e){return {type,pass:false,error:String(e)}}
 });
 const lz=["","x","abcabcabc","aaaaa","abracadabra","123456789", "a".repeat(100)];
 for(const original of lz){
   try{const coded=solveContract("Compression III: LZ Compression",original);
     results.push({type:"Compression III: LZ Compression",pass:solveContract("Compression II: LZ Decompression",coded)===original,
       original,coded});}
   catch(e){results.push({type:"Compression III: LZ Compression",pass:false,error:String(e)})}
 }
 const coverage=SUPPORTED_TYPES.filter(t=>!results.some(x=>x.type===t));
 const report={timestamp:Date.now(),total:results.length,passed:results.filter(r=>r.pass).length,coverageMissing:coverage,results};
 ns.write("/data/manager/contracts-fixture-tests.json",JSON.stringify(report,null,2),"w");
 ns.tprint(`Contract fixture tests: ${report.passed}/${report.total}, missing coverage ${coverage.length}; /data/manager/contracts-fixture-tests.json`);
}
