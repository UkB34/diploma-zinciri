import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passwordHash} from '../lib/auth-crypto.mjs';
import * as vc from '../lib/vc.mjs';
import * as chain from '../lib/chain.mjs';
const origin='https://test.example',RPC='https://rpc.test';
const NFT='0x09917f2deb350c50a626158d07017cb77953bb1c',ANCHOR='0x871c9551aee5911d998c84f239ab9acb79bf4f51',ISSUER='0x15c21b5c00ed0ed37ffe43cc0cde1181c52b2847';
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['merkez','central'],['fakulte','faculty']].map(async([username,role])=>({username,role,salt:'s',hash:await passwordHash('pw','s')})))),
 UNIVERSITY_KEY_JSON:JSON.stringify(await vc.generateUniversityKey()),APP_ORIGIN:origin,CHAIN_RPC:RPC,NFT_CONTRACT:NFT,ANCHOR_CONTRACT:ANCHOR,CHAIN_ISSUER:ISSUER};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});source=source.replace(/await import\('\.\/chain\.mjs'\)/g,'await import('+JSON.stringify(pathToFileURL(resolve(dirname(file),'chain.mjs')).href)+')');const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const api=await import(moduleUrl('app/api/chain/route.ts'));
const verifyApi=await import(moduleUrl('app/api/chain/verify/route.ts'));
const nftApi=await import(moduleUrl('app/api/nft/[id]/route.ts'));
const req=(body,cookie)=>{globalThis.__headers=new Headers({cookie});return new Request(origin+'/api/chain',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'1.1.1.1'},body:JSON.stringify(body)});};
const login=async u=>(await auth.POST(req({username:u,password:'pw'},''))).headers.get('set-cookie').split(';')[0];

// ---- Simulated Sepolia node: mirrors the contract rules for the calls our server/browser make ----
const txs=new Map(),roots=new Set(),tokens=new Map(),revokedTokens=new Set(),revokedLeaves=new Set();let revertNext=false;
function applyTx(to,input){
 const sel=input.slice(2,10),body=input.slice(10),wordAt=i=>body.slice(i*64,i*64+64);
 if(to===NFT&&sel===chain.SELECTORS.mintBatch){const n=Number(BigInt('0x'+wordAt(2)));const ids=Array.from({length:n},(_,i)=>BigInt('0x'+wordAt(3+i)));const hs=Array.from({length:n},(_,i)=>wordAt(4+n+i));ids.forEach((id,i)=>{if(tokens.has(id))throw Error('dup');tokens.set(id,hs[i]);});return 60000*n+30000;}
 if(to===NFT&&sel===chain.SELECTORS.revoke){revokedTokens.add(BigInt('0x'+wordAt(0)));return 30000;}
 if(to===ANCHOR&&sel===chain.SELECTORS.anchor){roots.add(wordAt(0));return 90000;}
 if(to===ANCHOR&&sel===chain.SELECTORS.revokeLeaf){revokedLeaves.add(wordAt(0));return 45000;}
 throw Error('unknown call');
}
async function ethCallSim({to,data,from}){
 const sel=data.slice(2,10),body=data.slice(10),wordAt=i=>body.slice(i*64,i*64+64);
 if(from&&from.toLowerCase()!==ISSUER)throw Object.assign(Error('execution reverted: '+(to===NFT?'DiplomaNFT':'DiplomaAnchor')+': yetkisiz cuzdan'));
 if(to===NFT&&sel===chain.SELECTORS.nftVerify){const id=BigInt('0x'+wordAt(0)),stored=tokens.get(id);return '0x'+chain.word(stored?1:0)+chain.word(stored===wordAt(1)?1:0)+chain.word(revokedTokens.has(id)?1:0);}
 if(to===ANCHOR&&sel===chain.SELECTORS.anchorVerify){const leaf=wordAt(0),n=Number(BigInt('0x'+wordAt(2)));const proof=Array.from({length:n},(_,i)=>wordAt(3+i));const ok=roots.has(await chain.rootFromProof(leaf,proof));return '0x'+chain.word(ok?1:0)+chain.word(revokedLeaves.has(leaf)?1:0)+chain.word(0);}
 throw Error('unknown view');
}
globalThis.fetch=async(url,opts)=>{
 assert.equal(url,RPC);const {method,params}=JSON.parse(opts.body);let result=null;
 try{
  if(method==='eth_getTransactionReceipt'){const t=txs.get(params[0]);result=t?{status:t.ok?'0x1':'0x0',blockNumber:'0x10',gasUsed:'0x'+t.gas.toString(16),effectiveGasPrice:'0x3b9aca00'}:null;}
  else if(method==='eth_getTransactionByHash'){const t=txs.get(params[0]);result=t?{to:t.to,input:t.input,from:t.from}:null;}
  else if(method==='eth_getBlockByNumber')result={timestamp:'0x'+Math.floor(Date.now()/1000+12).toString(16)};
  else if(method==='eth_call')result=await ethCallSim(params[0]);
  else throw Error('unexpected '+method);
 }catch(e){return Response.json({jsonrpc:'2.0',id:1,error:{code:3,message:e.message}});}
 return Response.json({jsonrpc:'2.0',id:1,result});
};
// What MetaMask would do: send the prepared calldata from the university wallet.
function mine(tx,{input=tx.data,from=ISSUER}={}){const hash='0x'+crypto.randomUUID().replaceAll('-','').padEnd(64,'0');let ok=!revertNext,gas=21000;revertNext=false;if(ok){try{gas=applyTx(tx.to.toLowerCase(),input);}catch{ok=false;}}txs.set(hash,{to:tx.to.toLowerCase(),input,from,ok,gas});return hash;}
const post=async(cookie,body)=>{const r=await api.POST(req(body,cookie));return {status:r.status,body:await r.json()};};
async function runAndConfirm(cookie,prep,opts){for(const tx of prep.transactions){const h=mine(tx,opts);assert.equal((await post(cookie,{action:'submit',batchId:tx.batchId,txHash:h})).status,200);const c=await post(cookie,{action:'confirm',batchId:tx.batchId});assert.equal(c.status,200);if(c.body.status!=='confirmed')return c.body;}return {status:'confirmed'};}
const status=async q=>(await verifyApi.GET(new Request(origin+'/api/chain/verify?'+q))).json();

test('iki yöntem: kayıt, makbuz kontrolü, doğrulama, iptal ve yetkisiz cüzdan',async()=>{
 const central=await login('merkez'),faculty=await login('fakulte');
 assert.equal((await post(faculty,{action:'generate',count:3})).status,403);
 for(let i=0;i<16;i++)assert.equal((await post(central,{action:'generate',count:10})).status,200);
 assert.equal((await post(central,{action:'generate',count:11})).status,400);
 globalThis.__headers=new Headers({cookie:faculty});let info=await (await api.GET()).json();assert.equal(info.canAct,false);assert.equal(info.benchCount,160);assert.equal(info.available.nft_bench,160);
 // Merkle: 50 diplomas in one transaction.
 let prep=(await post(central,{action:'prepare',method:'anchor',size:50,source:'bench'})).body;assert.equal(prep.transactions.length,1);assert.equal(prep.transactions[0].to.toLowerCase(),ANCHOR);
 assert.equal((await runAndConfirm(central,prep)).status,'confirmed');
 // NFT: 160 diplomas → 2 transactions (150 + 10).
 prep=(await post(central,{action:'prepare',method:'nft',size:160,source:'bench'})).body;assert.deepEqual(prep.transactions.map(t=>t.count),[150,10]);
 assert.equal((await runAndConfirm(central,prep)).status,'confirmed');
 assert.equal((await post(central,{action:'prepare',method:'nft',size:1,source:'bench'})).status,400); // nothing left
 globalThis.__headers=new Headers({cookie:central});info=await (await api.GET()).json();
 const nftRun=info.runs.find(r=>r.method==='nft'),anchorRun=info.runs.find(r=>r.method==='anchor');
 assert.equal(nftRun.txCount,2);assert.equal(nftRun.size,160);assert.equal(nftRun.status,'confirmed');assert.equal(nftRun.gasUsed,String(60000*160+60000));
 assert.equal(anchorRun.txCount,1);assert.equal(anchorRun.gasUsed,'90000');assert.ok(anchorRun.seconds!=null);
 // Verification of one diploma registered with both methods.
 const code=sql.prepare("SELECT code FROM chain_records WHERE method='anchor' LIMIT 1").get().code;
 let s=await status('code='+code);assert.equal(s.records.length,2);
 for(const r of s.records)assert.deepEqual([r.onChain.registered,r.onChain.matches,r.onChain.revoked],[true,true,false]);
 assert.ok(s.records.find(r=>r.method==='anchor').proof.length>=5);
 // A tampered VC hash does not match on chain.
 const rec=s.records[0];
 const tampered=await (await verifyApi.GET(new Request(origin+'/api/chain/verify?hash='+'0'.repeat(64)))).json();assert.equal(tampered.records.length,0);
 const meta=await (await nftApi.GET(new Request(origin+'/api/nft/'+chain.tokenIdFromCode(code).toString()))).json();
 assert.equal(meta.attributes.find(a=>a.trait_type==='Diploma kodu').value,code);assert.equal(JSON.stringify(meta).includes('Test Mezun'),false);
 // Revocation on both contracts.
 for(const method of ['nft','anchor']){prep=(await post(central,{action:'revoke',method,code})).body;assert.equal((await runAndConfirm(central,prep)).status,'confirmed');}
 s=await status('code='+code);for(const r of s.records)assert.equal(r.onChain.revoked,true);
 assert.equal((await post(central,{action:'revoke',method:'nft',code})).status,400);
 // T5: unauthorized wallet is rejected by both contracts (simulated, no gas).
 for(const method of ['nft','anchor']){const r=(await post(central,{action:'auth-test',method})).body;assert.equal(r.rejected,true);assert.match(r.message,/yetkisiz/);}
 // A mined tx whose calldata differs from the prepared one is not accepted; a reverted tx records nothing.
 for(let i=0;i<2;i++)await post(central,{action:'generate',count:2});
 prep=(await post(central,{action:'prepare',method:'anchor',size:2,source:'bench'})).body;
 let out=await runAndConfirm(central,prep,{input:chain.encodeAnchor('ab'.repeat(32),2)});assert.equal(out.status,'failed');assert.match(out.error,/eşleşmiyor/);
 prep=(await post(central,{action:'prepare',method:'anchor',size:2,source:'bench'})).body;revertNext=true;
 out=await runAndConfirm(central,prep);assert.equal(out.status,'failed');
 assert.equal(sql.prepare("SELECT count(*) AS n FROM chain_records WHERE method='anchor'").get().n,50);
 // Cancelled MetaMask prompt frees the diplomas again; bad tx hashes are refused.
 prep=(await post(central,{action:'prepare',method:'anchor',size:4,source:'bench'})).body;
 assert.equal((await post(central,{action:'submit',batchId:prep.transactions[0].batchId,txHash:'0x123'})).status,400);
 await post(central,{action:'cancel',batchId:prep.transactions[0].batchId});
 assert.equal((await post(central,{action:'prepare',method:'anchor',size:4,source:'bench'})).status,200);
});
