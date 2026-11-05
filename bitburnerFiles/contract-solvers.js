/**
 * Deterministic coding-contract solver catalogue (Bitburner 3.x).
 * Every key is the exact game contract type. Answers preserve native JS arrays,
 * numbers and strings; Square Root is decimal string for BigInt-safe submission.
 * These algorithms are separate from network discovery and submission.
 */
export const SOLVERS = {
 "Find Largest Prime Factor": n=>{let v=Number(n),p=2,last=1;while(p*p<=v){if(v%p===0){last=p;do{v/=p}while(v%p===0)}p=p===2?3:p+2}return Math.max(last,v)},
 "Subarray with Maximum Sum": a=>{let best=-Infinity,sum=0;for(const x of a){sum=Math.max(x,sum+x);best=Math.max(best,sum)}return best},
 "Total Ways to Sum": n=>ways(n,Array.from({length:n-1},(_,i)=>i+1)),
 "Total Ways to Sum II": d=>ways(d[0],d[1]),
 "Spiralize Matrix": a=>spiral(a),
 "Array Jumping Game": a=>(a.length===1||jump(a)>0)?1:0,
 "Array Jumping Game II": a=>jump(a),
 "Merge Overlapping Intervals": a=>merge(a),
 "Generate IP Addresses": s=>ips(s),
 "Algorithmic Stock Trader I": a=>stocks(a,1),
 "Algorithmic Stock Trader II": a=>stocks(a,Math.floor(a.length/2)),
 "Algorithmic Stock Trader III": a=>stocks(a,2),
 "Algorithmic Stock Trader IV": d=>stocks(d[1],d[0]),
 "Minimum Path Sum in a Triangle": a=>triangle(a),
 "Unique Paths in a Grid I": d=>paths(Array.from({length:d[0]},()=>Array(d[1]).fill(0))),
 "Unique Paths in a Grid II": a=>paths(a),
 "Shortest Path in a Grid": a=>shortest(a),
 "Sanitize Parentheses in Expression": s=>sanitize(s),
 "Find All Valid Math Expressions": d=>expressions(d[0],d[1]),
 "HammingCodes: Integer to Encoded Binary": n=>encodeHamming(n),
 "HammingCodes: Encoded Binary to Integer": s=>decodeHamming(s),
 "Proper 2-Coloring of a Graph": d=>color(d),
 "Compression I: RLE Compression": s=>rle(s),
 "Compression II: LZ Decompression": s=>lzDecode(s),
 "Compression III: LZ Compression": s=>lzEncode(s),
 "Encryption I: Caesar Cipher": d=>d[0].replace(/[A-Z]/g,c=>String.fromCharCode(65+(c.charCodeAt(0)-65-(d[1]%26)+52)%26)),
 "Encryption II: Vigenère Cipher": d=>{let i=0;return d[0].replace(/[A-Z]/g,c=>String.fromCharCode(65+(c.charCodeAt(0)-65+d[1].charCodeAt((i++)%d[1].length)-65)%26))},
 "Square Root": n=>squareRoot(n),
 "Total Number of Primes": d=>primesInRange(d[0],d[1]),
 "Largest Rectangle in a Matrix": a=>largestRectangle(a)
};
export const SUPPORTED_TYPES=Object.freeze(Object.keys(SOLVERS));
export function solveContract(type,data){if(!Object.hasOwn(SOLVERS,type))throw Error("Unsupported contract: "+type);return SOLVERS[type](data)}
function ways(n,coins){const dp=Array(n+1).fill(0);dp[0]=1;for(const c of [...new Set(coins)].sort((a,b)=>a-b))for(let i=c;i<=n;i++)dp[i]+=dp[i-c];return dp[n]}
function spiral(a){if(!a.length||!a[0].length)return [];const out=[];let t=0,b=a.length-1,l=0,r=a[0].length-1;while(t<=b&&l<=r){for(let i=l;i<=r;i++)out.push(a[t][i]);t++;for(let i=t;i<=b;i++)out.push(a[i][r]);r--;if(t<=b){for(let i=r;i>=l;i--)out.push(a[b][i]);b--}if(l<=r){for(let i=b;i>=t;i--)out.push(a[i][l]);l++}}return out}
function jump(a){if(a.length<=1)return 0;let steps=0,reach=0,end=0;for(let i=0;i<a.length-1;i++){if(i>reach)return 0;reach=Math.max(reach,i+a[i]);if(i===end){steps++;end=reach;if(end>=a.length-1)return steps}}return 0}
function merge(a){const sorted=a.map(x=>x.slice()).sort((a,b)=>a[0]-b[0]);const out=[];for(const x of sorted){if(!out.length||out[out.length-1][1]<x[0])out.push(x);else out[out.length-1][1]=Math.max(out[out.length-1][1],x[1])}return out}
function ips(s){const out=[];function rec(i,p){if(p.length===4){if(i===s.length)out.push(p.join("."));return}for(let n=1;n<=3&&i+n<=s.length;n++){const part=s.slice(i,i+n);if((n>1&&part[0]==="0")||Number(part)>255)continue;rec(i+n,[...p,part])}}rec(0,[]);return out}
function stocks(a,k){if(k<=0||a.length<2)return 0;if(k>=a.length/2){let x=0;for(let i=1;i<a.length;i++)x+=Math.max(0,a[i]-a[i-1]);return x}const buy=Array(k+1).fill(-Infinity),sell=Array(k+1).fill(0);for(const p of a){for(let i=k;i>=1;i--){sell[i]=Math.max(sell[i],buy[i]+p);buy[i]=Math.max(buy[i],sell[i-1]-p)}}return sell[k]}
function triangle(a){if(!a.length)return 0;let dp=a[a.length-1].slice();for(let i=a.length-2;i>=0;i--)for(let j=0;j<a[i].length;j++)dp[j]=a[i][j]+Math.min(dp[j],dp[j+1]);return dp[0]}
function paths(a){if(!a.length||!a[0].length)return 0;const dp=Array(a[0].length).fill(0);dp[0]=1;for(const row of a)for(let j=0;j<row.length;j++)dp[j]=row[j]?0:(j===0?dp[j]:dp[j]+dp[j-1]);return dp.at(-1)}
function shortest(a){if(!a.length||!a[0].length||a[0][0])return "";const h=a.length,w=a[0].length,q=[[0,0,""]],seen=new Set(["0,0"]);const moves=[[1,0,"D"],[0,1,"R"],[-1,0,"U"],[0,-1,"L"]];for(let i=0;i<q.length;i++){const [y,x,p]=q[i];if(y===h-1&&x===w-1)return p;for(const [dy,dx,ch] of moves){const ny=y+dy,nx=x+dx,key=ny+","+nx;if(ny<0||nx<0||ny>=h||nx>=w||a[ny][nx]||seen.has(key))continue;seen.add(key);q.push([ny,nx,p+ch])}}return ""}
function sanitize(s){const valid=t=>{let n=0;for(const c of t){if(c==="(")n++;if(c===")"&&--n<0)return false}return n===0};const seen=new Set([s]);let level=[s];while(level.length){const good=level.filter(valid);if(good.length)return [...new Set(good)].sort();const next=[];for(const t of level)for(let i=0;i<t.length;i++){if(!"()".includes(t[i]))continue;const x=t.slice(0,i)+t.slice(i+1);if(!seen.has(x)){seen.add(x);next.push(x)}}level=next}return [""]}
function expressions(s,target){const out=[];function rec(i,expr,val,last){if(i===s.length){if(val===target)out.push(expr);return}for(let j=i+1;j<=s.length;j++){const chunk=s.slice(i,j);if(chunk.length>1&&chunk[0]==="0")break;const v=Number(chunk);if(!i)rec(j,chunk,v,v);else{rec(j,expr+"+"+chunk,val+v,v);rec(j,expr+"-"+chunk,val-v,-v);rec(j,expr+"*"+chunk,val-last+last*v,last*v)}}}rec(0,"",0,0);return out}
function encodeHamming(n){const binary=BigInt(n).toString(2).split("").reverse(),bits=[0];let idx=0;for(let i=1;idx<binary.length;i++){if((i&(i-1))===0)bits[i]=0;else bits[i]=Number(binary[idx++])}for(let p=1;p<bits.length;p*=2){let parity=0;for(let i=1;i<bits.length;i++)if(i&p)parity^=bits[i];bits[p]=parity}bits[0]=bits.slice(1).reduce((a,b)=>a^b,0);return bits.join("")}
function decodeHamming(s){const bits=[...s].map(Number);let error=0;for(let p=1;p<bits.length;p*=2){let parity=0;for(let i=1;i<bits.length;i++)if(i&p)parity^=bits[i];if(parity)error+=p}if(error>0&&error<bits.length)bits[error]^=1;let data="";for(let i=1;i<bits.length;i++)if((i&(i-1))!==0)data+=bits[i];return parseInt(data.split("").reverse().join("")||"0",2)}
function color(d){const [n,edges]=d,adj=Array.from({length:n},()=>[]),c=Array(n).fill(-1);for(const [a,b] of edges){adj[a].push(b);adj[b].push(a)}for(let i=0;i<n;i++){if(c[i]!==-1)continue;c[i]=0;const q=[i];for(let j=0;j<q.length;j++)for(const v of adj[q[j]]){if(c[v]===-1){c[v]=1-c[q[j]];q.push(v)}else if(c[v]===c[q[j]])return []}}return c}
function rle(s){let out="";for(let i=0;i<s.length;){let n=1;while(n<9&&s[i+n]===s[i])n++;out+=n+s[i];i+=n}return out}
function lzDecode(s){let out="",i=0,literal=true;while(i<s.length){const len=Number(s[i++]);if(len===0){literal=!literal;continue}if(literal){out+=s.slice(i,i+len);i+=len}else{const offset=Number(s[i++]);if(offset<1||offset>9||offset>out.length)throw Error("Bad LZ reference");for(let j=0;j<len;j++)out+=out[out.length-offset]}literal=!literal}return out}
function lzEncode(s){const memo=new Map();function rec(i,literal){if(i===s.length)return "";const key=i+":"+literal;if(memo.has(key))return memo.get(key);let best=null;const consider=t=>{if(best===null||t.length<best.length||(t.length===best.length&&t<best))best=t};
    if(literal){for(let len=1;len<=9&&i+len<=s.length;len++)consider(len+s.slice(i,i+len)+rec(i+len,false))}
    else{for(let off=1;off<=9&&off<=i;off++)for(let len=1;len<=9&&i+len<=s.length;len++){let match=true;for(let j=0;j<len;j++)if(s[i+j]!==s[i+j-off]){match=false;break}if(match)consider(""+len+off+rec(i+len,true))}}
    // zero-length blocks switch mode but cannot switch twice without consuming text
    if(literal){for(let off=1;off<=9&&off<=i;off++)for(let len=1;len<=9&&i+len<=s.length;len++){let ok=true;for(let j=0;j<len;j++)if(s[i+j]!==s[i+j-off]){ok=false;break}if(ok)consider("0"+len+off+rec(i+len,true))}}
    else for(let len=1;len<=9&&i+len<=s.length;len++)consider("0"+len+s.slice(i,i+len)+rec(i+len,false));
    memo.set(key,best??"");return best??""}
  return rec(0,true)}
function squareRoot(n){const x=BigInt(n);if(x<0n)throw Error("negative square root");if(x<2n)return x.toString();let z=1n<<BigInt(Math.ceil(x.toString(2).length/2));while(true){const next=(z+x/z)>>1n;if(next>=z)break;z=next}const above=z+1n;return (x-z*z>=above*above-x?above:z).toString()}
function primesInRange(low,high){low=Math.max(2,Math.floor(low));high=Math.floor(high);if(low>high)return 0;const sieve=new Uint8Array(Math.floor(Math.sqrt(high))+1);const primes=[];for(let p=2;p<sieve.length;p++){if(sieve[p])continue;primes.push(p);for(let j=p*p;j<sieve.length;j+=p)sieve[j]=1}const composite=new Uint8Array(high-low+1);for(const p of primes)for(let v=Math.max(p*p,Math.ceil(low/p)*p);v<=high;v+=p)composite[v-low]=1;return composite.length-composite.reduce((a,b)=>a+b,0)}
function largestRectangle(a){if(!a.length||!a[0].length)return [[0,0],[0,0]];let best=0,result=[[0,0],[0,0]];const h=Array(a[0].length).fill(0);for(let y=0;y<a.length;y++){for(let x=0;x<h.length;x++)h[x]=a[y][x]?h[x]+1:0;const st=[];for(let x=0;x<=h.length;x++){const height=x===h.length?0:h[x];while(st.length&&h[st.at(-1)]>height){const k=st.pop(),hh=h[k],left=st.length?st.at(-1)+1:0,area=hh*(x-left);if(area>best){best=area;result=[[y-hh+1,left],[y,x-1]]}}st.push(x)}}return result}
