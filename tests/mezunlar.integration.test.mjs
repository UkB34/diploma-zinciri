import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passwordHash} from '../lib/auth-crypto.mjs';
import * as vc from '../lib/vc.mjs';
import * as sol from '../lib/solana.mjs';
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
const api=await import(moduleUrl('app/api/mezunlar/route.ts'));
const req=(body,cookie)=>{globalThis.__headers=new Headers({cookie});return new Request(origin+'/api/auth',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'1.1.1.1'},body:JSON.stringify(body)});};
const login=async u=>(await auth.POST(req({username:u,password:'pw'},''))).headers.get('set-cookie').split(';')[0];
const get=async cookie=>{globalThis.__headers=new Headers({cookie});const r=await api.GET();return {status:r.status,body:await r.json()};};

test('Mezunlar listesi yıllara göre gelir; VC dosyaları yalnızca merkez yetkilisine verilir',async()=>{
 const uni=await vc.importUniversityKey(JSON.parse(globalThis.__env.UNIVERSITY_KEY_JSON));
 const issue=async(code,name,validFrom,revoked=0)=>{
  const c=vc.diplomaCredential({id:vc.randomId(),code,content:{name,university:'Örnek',faculty:'Müh',program:'Bilg',transcript:{hash:'c'.repeat(64)}},version:1,documentHash:'d'.repeat(64),approvals:[],statusIndex:7,origin});
  c.validFrom=validFrom;const jwt=await vc.issueCredential(uni,origin,c);
  sql.prepare("INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at,revoked) VALUES (?,'diploma',NULL,NULL,?,?,?,?,?)").run('urn:'+code,code,Math.floor(Math.random()*1e6),jwt,Date.parse(validFrom),revoked);
  return jwt;};
 const j1=await issue('TEST-'+'A'.repeat(20),'Zeynep Deniz','2026-06-30T10:00:00Z');
 await issue('TEST-'+'B'.repeat(20),'Kenan Yıldız','2025-07-01T10:00:00Z',1);
 sql.prepare("INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at) VALUES ('urn:x','approver','fakulte','faculty','did:jwk:x',1,'x',1)").run();
 assert.equal((await get('')).status,401);
 const central=await get(await login('merkez'));
 assert.equal(central.body.canMint,true);assert.equal(central.body.graduates.length,2);
 const z=central.body.graduates.find(g=>g.name==='Zeynep Deniz');
 assert.equal(z.year,2026);assert.equal(z.program,'Bilg');assert.equal(z.jwt,j1);assert.equal(z.hash,await sol.vcHash(j1));assert.equal(z.revoked,false);
 const k=central.body.graduates.find(g=>g.name==='Kenan Yıldız');assert.equal(k.year,2025);assert.equal(k.revoked,true);
 const faculty=await get(await login('fakulte'));
 assert.equal(faculty.body.canMint,false);assert.equal(faculty.body.graduates.length,2);
 assert.ok(faculty.body.graduates.every(g=>!('jwt' in g)&&g.hash.length===64));
});
