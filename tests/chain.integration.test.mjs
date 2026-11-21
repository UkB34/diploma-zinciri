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
const NFT='0x09917f2deb350c50a626158d07017cb77953bb1c',ISSUER='0x15c21b5c00ed0ed37ffe43cc0cde1181c52b2847';
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['merkez','central'],['fakulte','faculty']].map(async([username,role])=>({username,role,salt:'s',hash:await passwordHash('pw','s')})))),
 UNIVERSITY_KEY_JSON:JSON.stringify(await vc.generateUniversityKey()),APP_ORIGIN:origin,CHAIN_RPC:RPC,NFT_CONTRACT:NFT,CHAIN_ISSUER:ISSUER};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});source=source.replace(/await import\('\.\/chain\.mjs'\)/g,'await import('+JSON.stringify(pathToFileURL(resolve(dirname(file),'chain.mjs')).href)+')');const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const api=await import(moduleUrl('app/api/chain/route.ts'));
const verifyApi=await import(moduleUrl('app/api/chain/verify/route.ts'));
const nftApi=await import(moduleUrl('app/api/nft/[id]/route.ts'));
const imageApi=await import(moduleUrl('app/api/nft-image/[id]/route.ts'));
const req=(body,cookie)=>{globalThis.__headers=new Headers({cookie});return new Request(origin+'/api/chain',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'1.1.1.1'},body:JSON.stringify(body)});};
const login=async u=>(await auth.POST(req({username:u,password:'pw'},''))).headers.get('set-cookie').split(';')[0];

// ---- Simulated Sepolia node: mirrors the contract rules for the calls our server/browser make ----
const txs=new Map(),tokens=new Map(),revokedTokens=new Set();let revertNext=false;
function applyTx(to,input){
 const sel=input.slice(2,10),body=input.slice(10),wordAt=i=>body.slice(i*64,i*64+64);
 if(to===NFT&&sel===chain.SELECTORS.mintBatch){const n=Number(BigInt('0x'+wordAt(2)));const ids=Array.from({length:n},(_,i)=>BigInt('0x'+wordAt(3+i)));const hs=Array.from({length:n},(_,i)=>wordAt(4+n+i));ids.forEach((id,i)=>{if(tokens.has(id))throw Error('dup');tokens.set(id,hs[i]);});return 60000*n+30000;}
 if(to===NFT&&sel===chain.SELECTORS.revoke){revokedTokens.add(BigInt('0x'+wordAt(0)));return 30000;}
 throw Error('unknown call');
}
async function ethCallSim({to,data,from}){
 const sel=data.slice(2,10),body=data.slice(10),wordAt=i=>body.slice(i*64,i*64+64);
 if(from&&from.toLowerCase()!==ISSUER)throw Object.assign(Error('execution reverted: DiplomaNFT: yetkisiz cuzdan'));
 if(to===NFT&&sel===chain.SELECTORS.nftVerify){const id=BigInt('0x'+wordAt(0)),stored=tokens.get(id);return '0x'+chain.word(stored?1:0)+chain.word(stored===wordAt(1)?1:0)+chain.word(revokedTokens.has(id)?1:0);}
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

async function addDiploma(code,name){
 const uni=await vc.importUniversityKey(JSON.parse(globalThis.__env.UNIVERSITY_KEY_JSON));
 const jwt=await vc.issueCredential(uni,origin,vc.diplomaCredential({id:vc.randomId(),code,content:{name,university:'Örnek Üniversite',faculty:'Müh',program:'Bilg',transcript:{hash:'c'.repeat(64)}},version:1,documentHash:'d'.repeat(64),approvals:[],statusIndex:7,origin}));
 sql.prepare("INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at) VALUES (?,'diploma',NULL,NULL,?,?,?,?)").run('urn:'+code,code,Math.floor(Math.random()*1e6),jwt,Date.now());
}

test('gerçek diploma NFT olarak kaydedilir, doğrulanır ve zincirde iptal edilir',async()=>{
 const central=await login('merkez'),faculty=await login('fakulte');
 globalThis.__headers=new Headers({cookie:faculty});let info=await (await api.GET()).json();assert.equal(info.canAct,false);assert.equal(info.config.nft.toLowerCase(),NFT);assert.equal('anchor' in info.config,false);
 const code='TEST-'+'AB12'.repeat(5);await addDiploma(code,'Zeynep Deniz');
 assert.equal((await post(faculty,{action:'register-diploma',code})).status,403);
 assert.equal((await post(central,{action:'register-diploma',code:'TEST-'+'F'.repeat(20)})).status,400);
 for(const action of ['generate','prepare','auth-test'])assert.equal((await post(central,{action,method:'nft',count:1,size:1})).status,400);
 let prep=(await post(central,{action:'register-diploma',code})).body;assert.equal(prep.transactions.length,1);assert.equal(prep.transactions[0].to.toLowerCase(),NFT);
 // While a transaction is pending the same diploma cannot be prepared twice.
 assert.equal((await post(central,{action:'register-diploma',code})).status,400);
 assert.equal((await runAndConfirm(central,prep)).status,'confirmed');
 assert.equal((await post(central,{action:'register-diploma',code})).status,400);
 let s=await status('code='+code);assert.equal(s.records.length,1);assert.equal(s.records[0].method,'nft');
 assert.deepEqual([s.records[0].onChain.registered,s.records[0].onChain.matches,s.records[0].onChain.revoked],[true,true,false]);
 assert.equal(s.chain.issuer.toLowerCase(),ISSUER);assert.equal('anchor' in s.chain,false);
 assert.equal((await status('hash='+s.records[0].vcHash)).records.length,1);
 assert.equal((await status('hash='+'0'.repeat(64))).records.length,0);
 // Wallet metadata and badge contain no personal data.
 const id=chain.tokenIdFromCode(code).toString();
 const meta=await (await nftApi.GET(new Request(origin+'/api/nft/'+id))).json();
 assert.equal(meta.attributes.find(a=>a.trait_type==='Diploma kodu').value,code);assert.equal(JSON.stringify(meta).includes('Zeynep'),false);
 assert.equal(meta.external_url,origin+'/diploma/'+code);assert.equal(meta.image,origin+'/api/nft-image/'+id);
 const img=await imageApi.GET(new Request(meta.image));assert.equal(img.headers.get('content-type'),'image/svg+xml; charset=utf-8');const svg=await img.text();
 assert.ok(svg.startsWith('<svg')&&svg.includes(code)&&svg.includes('GEÇERLİ'));assert.equal(svg.includes('Zeynep'),false);
 assert.equal((await imageApi.GET(new Request(origin+'/api/nft-image/1'))).status,404);
 // Revocation on chain.
 prep=(await post(central,{action:'revoke',code})).body;assert.equal((await runAndConfirm(central,prep)).status,'confirmed');
 s=await status('code='+code);assert.equal(s.records[0].onChain.revoked,true);
 assert.equal((await post(central,{action:'revoke',code})).status,400);
 assert.ok((await (await imageApi.GET(new Request(meta.image))).text()).includes('İPTAL EDİLDİ'));
 // A mined tx whose calldata differs from the prepared one is not accepted; a reverted tx records nothing; cancel frees the diploma.
 const code2='TEST-'+'CD34'.repeat(5);await addDiploma(code2,'Kenan Yıldız');
 prep=(await post(central,{action:'register-diploma',code:code2})).body;
 let out=await runAndConfirm(central,prep,{input:chain.encodeMintBatch([chain.tokenIdFromCode('TEST-'+'E'.repeat(20))],['ab'.repeat(32)])});assert.equal(out.status,'failed');assert.match(out.error,/eşleşmiyor/);
 prep=(await post(central,{action:'register-diploma',code:code2})).body;revertNext=true;
 out=await runAndConfirm(central,prep);assert.equal(out.status,'failed');
 assert.equal((await status('code='+code2)).records.length,0);
 prep=(await post(central,{action:'register-diploma',code:code2})).body;
 assert.equal((await post(central,{action:'submit',batchId:prep.transactions[0].batchId,txHash:'0x123'})).status,400);
 await post(central,{action:'cancel',batchId:prep.transactions[0].batchId});
 prep=(await post(central,{action:'register-diploma',code:code2})).body;assert.equal((await runAndConfirm(central,prep)).status,'confirmed');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM chain_records').get().n,2);
});

test('0005 göçü test verisini siler, gerçek diploma NFT kayıtlarını korur',()=>{
 const db=new DatabaseSync(':memory:');
 const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'0005'))db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const cred=db.prepare("INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at) VALUES (?,?,NULL,NULL,?,?,'x',1)");
 cred.run('c1','diploma','TEST-REAL',1);cred.run('c2','bench','TEST-BENCH',2);cred.run('c3','approver','did:jwk:x',3);
 const batch=db.prepare("INSERT INTO chain_batches (id,run_id,run_size,method,action,size,data_hash,payload,status,created_by,created_at) VALUES (?,?,1,?,?,1,'h','[]',?,'merkez',1)");
 batch.run('b1','r1','nft','diploma','confirmed');batch.run('b2','r2','anchor','diploma','confirmed');batch.run('b3','r3','nft','register','confirmed');batch.run('b4','r4','anchor','register','confirmed');batch.run('b5','r5','nft','register','prepared');batch.run('b6','r6','nft','diploma','cancelled');
 const rec=db.prepare("INSERT INTO chain_records (method,code,vc_hash,batch_id) VALUES (?,?,'h',?)");
 rec.run('nft','TEST-REAL','b1');rec.run('anchor','TEST-REAL','b2');rec.run('nft','TEST-BENCH','b3');rec.run('anchor','TEST-BENCH','b4');
 db.exec(readFileSync(new URL('../drizzle/'+files.find(f=>f.startsWith('0005')),import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('SELECT method,code FROM chain_records').all().map(r=>({...r})),[{method:'nft',code:'TEST-REAL'}]);
 assert.deepEqual(db.prepare('SELECT id FROM chain_batches').all().map(r=>r.id),['b1']);
 assert.deepEqual(db.prepare('SELECT id FROM credentials ORDER BY id').all().map(r=>r.id),['c1','c3']);
});
