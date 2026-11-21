import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passwordHash} from '../lib/auth-crypto.mjs';
import * as vc from '../lib/vc.mjs';
import * as chain from '../lib/solana.mjs';
import {makeZip} from '../lib/zip.mjs';
const origin='https://test.example';
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['merkez','central'],['fakulte','faculty']].map(async([username,role])=>({username,role,salt:'s',hash:await passwordHash('pw','s')})))),
 UNIVERSITY_KEY_JSON:JSON.stringify(await vc.generateUniversityKey()),APP_ORIGIN:origin};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});source=source.replace(/await import\('\.\/chain\.mjs'\)/g,'await import('+JSON.stringify(pathToFileURL(resolve(dirname(file),'chain.mjs')).href)+')');const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const api=await import(moduleUrl('app/api/temsili/route.ts'));
const req=(body,cookie)=>{globalThis.__headers=new Headers({cookie});return new Request(origin+'/api/temsili',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'1.1.1.1'},body:JSON.stringify(body)});};
const login=async u=>(await auth.POST(req({username:u,password:'pw'},''))).headers.get('set-cookie').split(';')[0];
const post=async(cookie,body)=>{const r=await api.POST(req(body,cookie));return {status:r.status,body:await r.json()};};

test('temsili diplomalar üniversite anahtarıyla imzalanır ama hiçbir yerde saklanmaz',async()=>{
 const central=await login('merkez'),faculty=await login('fakulte');
 const uni=await vc.importUniversityKey(JSON.parse(globalThis.__env.UNIVERSITY_KEY_JSON));
 const realJwt=await vc.issueCredential(uni,origin,vc.diplomaCredential({id:vc.randomId(),code:'TEST-'+'AB12'.repeat(5),content:{name:'Zeynep Deniz',university:'Örnek',faculty:'Müh',program:'Bilg',transcript:{hash:'c'.repeat(64)}},version:1,documentHash:'d'.repeat(64),approvals:[],statusIndex:7,origin}));
 sql.prepare("INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at) VALUES ('urn:real','diploma',NULL,NULL,'TEST-AB12AB12AB12AB12AB12',7,?,1)").run(realJwt);
 const before=sql.prepare('SELECT count(*) AS n FROM credentials').get().n;
 globalThis.__headers=new Headers({cookie:faculty});assert.equal((await (await api.GET()).json()).canAct,false);
 assert.equal((await post(faculty,{action:'sign',start:1,count:5})).status,403);
 for(const [start,count] of [[0,5],[1,26],[990,20],[1,0]])assert.equal((await post(central,{action:'sign',start,count})).status,400);
 const r=await post(central,{action:'sign',start:996,count:5});assert.equal(r.status,200);
 const list=r.body.diplomas;assert.deepEqual(list.map(d=>d.no),[996,997,998,999,1000]);
 assert.equal(new Set(list.map(d=>d.code)).size,5);
 const pub=JSON.parse(globalThis.__env.UNIVERSITY_KEY_JSON).publicJwk||(await vc.importUniversityKey(JSON.parse(globalThis.__env.UNIVERSITY_KEY_JSON))).publicJwk;
 for(const d of list){
  const v=await vc.verifyIssuedCredential(d.jwt,{origin,universityJwk:pub,type:'DiplomaCredential'});
  assert.equal(v.credentialSubject.name,'Temsili Diploma '+String(d.no).padStart(4,'0'));assert.equal(v.credentialSubject.representative,true);assert.equal(v.credentialSubject.diploma.code,d.code);assert.deepEqual(v.evidence,[]);
  assert.equal(d.hash,await chain.vcHash(d.jwt));
 }
 // Tampering breaks the signature.
 const [h,p,sig]=list[0].jwt.split('.');const forged=h+'.'+Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(p,'base64url')),name:'x'})).toString('base64url')+'.'+sig;
 await assert.rejects(vc.verifyIssuedCredential(forged,{origin,universityJwk:pub,type:'DiplomaCredential'}));
 // Nothing was stored.
 assert.equal(sql.prepare('SELECT count(*) AS n FROM credentials').get().n,before);
 const real=(await post(central,{action:'real'})).body.diplomas;assert.deepEqual(real,[{hash:await chain.vcHash(realJwt),revoked:false}]);
 assert.equal(JSON.stringify(real).includes('Zeynep'),false);
 // The browser packs the files into a zip that standard tools can open.
 const zip=makeZip(list.map(d=>({name:'temsili/'+d.code+'.jwt',data:d.jwt})));
 const dv=new DataView(zip.buffer),end=zip.length-22;assert.equal(dv.getUint32(0,true),0x04034b50);assert.equal(dv.getUint32(end,true),0x06054b50);assert.equal(dv.getUint16(end+10,true),5);
});
