import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passwordHash,readSessionCookie} from '../lib/auth-crypto.mjs';
const sql=new DatabaseSync(':memory:');
for(const name of ['0000_luxuriant_aaron_stack.sql','0001_cute_lilith.sql'])sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['bolum','department'],['fakulte','faculty']].map(async([username,role])=>({username,role,salt:'integration-test-salt',hash:await passwordHash('test-only-password','integration-test-salt')}))))};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const workflow=await import(moduleUrl('app/api/workflow/route.ts'));
function request(body,cookie='',origin='https://test.example'){globalThis.__headers=new Headers({cookie});return new Request('https://test.example/api/auth',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify(body)});}
const get=async(cookie)=>{globalThis.__headers=new Headers({cookie});return workflow.GET();};
test('ayrı oturumlar, yetki değişikliği engeli, ortak veritabanı ve çıkış',async()=>{
 assert.equal((await get('')).status,401);
 assert.equal((await auth.POST(request({username:'bolum',password:'wrong'}))).status,401);
 assert.equal((await auth.POST(request({username:'bolum',password:'test-only-password'},'','https://other.example'))).status,403);
 const login=await auth.POST(request({username:'bolum',password:'test-only-password'}));assert.equal(login.status,200);const deptCookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.ok(readSessionCookie(deptCookie));
 const facultyLogin=await auth.POST(request({username:'fakulte',password:'test-only-password'}));const facultyCookie=facultyLogin.headers.get('set-cookie').split(';')[0];assert.notEqual(facultyCookie,deptCookie);
 let state=await (await get(deptCookie)).json();assert.equal(state.role,'department');const c=state.cases.find(c=>c.status==='department');
 let response=await workflow.POST(request({action:'role',role:'rector',revision:state.revision},deptCookie));assert.equal(response.status,403);
 response=await workflow.POST(request({action:'approve',id:c.id,revision:state.revision},facultyCookie));assert.equal(response.status,403);
 state=await (await get(deptCookie)).json();assert.equal(state.cases.find(x=>x.id===c.id).status,'department');
 response=await workflow.POST(request({action:'approve',id:c.id,revision:state.revision},deptCookie));assert.equal(response.status,200);
 const next=await (await get(facultyCookie)).json();assert.equal(next.role,'faculty');assert.equal(next.cases.find(x=>x.id===c.id).status,'faculty');assert.equal(next.cases.find(x=>x.id===c.id).events.at(-1).actor,'bolum');
 response=await workflow.POST(request({action:'approve',id:c.id,revision:state.revision},facultyCookie));assert.equal(response.status,409);
 response=await workflow.POST(request({action:'approve',id:c.id,revision:next.revision},facultyCookie));assert.equal(response.status,200);assert.equal((await response.json()).cases.find(x=>x.id===c.id).status,'rector');
 assert.equal((await get('dz_session='+'f'.repeat(64))).status,401);
 await auth.POST(request({action:'logout'},deptCookie));assert.equal((await get(deptCookie)).status,401);assert.equal((await get(facultyCookie)).status,200);
});
test('oturum süresi dolunca erişim kesilir',async()=>{const r=await auth.POST(request({username:'bolum',password:'test-only-password'}));const cookie=r.headers.get('set-cookie').split(';')[0];sql.exec("UPDATE sessions SET expires_at=0 WHERE username='bolum'");assert.equal((await get(cookie)).status,401);});
