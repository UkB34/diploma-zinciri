import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateSigningKey,verifyApproval} from '../lib/signatures.mjs';
import {passwordHash,readSessionCookie} from '../lib/auth-crypto.mjs';
const sql=new DatabaseSync(':memory:');
for(const name of ['0000_luxuriant_aaron_stack.sql','0001_cute_lilith.sql','0002_transcripts.sql'])sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args.map(a=>a instanceof ArrayBuffer?new Uint8Array(a):a);return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['ogrenci_isleri','registrar'],['fakulte','faculty'],['rektorluk','rector'],['merkez','central'],['bolum','department']].map(async([username,role])=>({username,role,salt:'integration-test-salt',hash:await passwordHash('test-only-password','integration-test-salt')}))))};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const workflow=await import(moduleUrl('app/api/workflow/route.ts'));
function request(body,cookie='',origin='https://test.example'){globalThis.__headers=new Headers({cookie});return new Request('https://test.example/api/auth',{method:'POST',headers:{origin,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify(body)});}
const get=async(cookie)=>{globalThis.__headers=new Headers({cookie});return workflow.GET();};

const signatures=await import(moduleUrl('app/api/signatures/route.ts'));
const transcripts=await import(moduleUrl('app/api/transcripts/route.ts'));
const signingKeys=Object.fromEntries(await Promise.all(['registrar','faculty','rector','central'].map(async r=>[r,await generateSigningKey()])));
Object.assign(globalThis.__env,{SIGNING_KEYS_JSON:JSON.stringify(signingKeys),ROLE_EMAILS_JSON:JSON.stringify({ogrenci_isleri:'registrar@example.com',fakulte:'faculty@example.com',rektorluk:'rector@example.com',merkez:'central@example.com'}),BREVO_API_KEY:'test-only',MAIL_FROM:'test@example.com',APP_ORIGIN:'https://test.example'});
let mail=[],mailFails=false;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');if(mailFails)return Response.json({error:'test'},{status:403});assert.equal(options.headers['api-key'],'test-only');const body=JSON.parse(options.body);assert.deepEqual(body.sender,{name:'Diploma Zinciri',email:'test@example.com'});assert.equal(typeof body.to[0].email,'string');assert.ok(body.textContent.includes('/imzala#token='));mail.push(body);return Response.json({id:'mail-test'});};
const login=async username=>{const r=await auth.POST(request({username,password:'test-only-password'}));assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
const state=async cookie=>(await get(cookie)).json();
const act=async(cookie,body)=>{const s=await state(cookie);return workflow.POST(request({...body,revision:s.revision},cookie));};
const mailToken=()=>mail.at(-1).textContent.match(/token=([a-f0-9]{64})/)[1];
test('PDF, dört hesap, e-posta daveti, tek kullanım ve imzasız geçiş engeli',async()=>{
 assert.equal((await get('')).status,401);
 assert.equal((await auth.POST(request({username:'bolum',password:'test-only-password'}))).status,401);
 const registrar=await login('ogrenci_isleri'),faculty=await login('fakulte'),rector=await login('rektorluk'),central=await login('merkez');
 assert.notEqual(registrar,faculty);assert.ok(readSessionCookie(registrar));
 const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nTest transcript\n%%EOF'],{type:'application/pdf'}),'test.pdf');
 globalThis.__headers=new Headers({cookie:registrar});const uploaded=await transcripts.POST(new Request('https://test.example/api/transcripts',{method:'POST',headers:{origin:'https://test.example',host:'test.example'},body:form}));assert.equal(uploaded.status,200);const pdf=await uploaded.json();
 const fields={program:'Bilgisayar Mühendisliği',faculty:'Mühendislik',university:'Örnek Üniversite',transcriptId:pdf.id};
 assert.equal((await act(registrar,{action:'create',name:'Test Öğrenci',student:'20220001',note:'Temsili transkript',...fields})).status,200);
 let s=await state(registrar),id=s.cases[0].id;assert.equal(s.cases[0].status,'draft');
 assert.equal((await act(registrar,{action:'approve',id})).status,403);
 assert.equal((await act(registrar,{action:'reject',id})).status,403);
 assert.equal((await act(faculty,{action:'request-signature',id})).status,403);
 assert.equal((await act(registrar,{action:'role',role:'rector'})).status,403);
 assert.equal((await workflow.POST(request({action:'request-signature',id,revision:s.revision},registrar,'https://evil.example'))).status,403);
 for(const [cookie,role,next] of [[registrar,'registrar','faculty'],[faculty,'faculty','rector'],[rector,'rector','central'],[central,'central','ready']]){
 const before=await state(cookie);assert.equal((await act(cookie,{action:'request-signature',id})).status,200);
 s=await state(cookie);assert.equal(s.cases[0].status,before.cases[0].status);assert.ok(s.cases[0].pending);assert.equal('tokenHash' in s.cases[0].pending,false);
 const token=mailToken();assert.equal((await signatures.POST(request({action:'inspect',token},cookie))).status,200);
 assert.equal((await signatures.POST(request({action:'sign',token,consent:true},cookie===faculty?registrar:faculty))).status,403);
 assert.equal((await signatures.POST(request({action:'sign',token,consent:false},cookie))).status,400);
 const signed=await signatures.POST(request({action:'sign',token,consent:true},cookie));assert.equal(signed.status,200);const result=await signed.json();assert.equal(await verifyApproval(result.proof,signingKeys[role].publicKey),true);assert.equal(result.status,next);
 assert.equal((await signatures.POST(request({action:'sign',token,consent:true},cookie))).status,403);
 }
 assert.equal(mail.length,4);assert.equal((await act(central,{action:'issue',id})).status,200);
 s=await state(central);assert.equal(s.cases[0].approvals.length,4);assert.equal(s.cases[0].status,'issued');
 // New case: provider failure must not advance or leave a usable pending challenge.
 assert.equal((await act(registrar,{action:'create',name:'İkinci Öğrenci',student:'20220002',note:'Temsili transkript',...fields})).status,200);
 id=(await state(registrar)).cases[0].id;mailFails=true;assert.equal((await act(registrar,{action:'request-signature',id})).status,502);mailFails=false;s=await state(registrar);assert.equal(s.cases[0].status,'draft');assert.equal(s.cases[0].pending,null);
 // A new version invalidates an outstanding invitation.
 assert.equal((await act(registrar,{action:'request-signature',id})).status,200);const stale=mailToken();assert.equal((await act(registrar,{action:'revise',id,note:'Yeni sürüm açıklaması',...fields})).status,200);assert.equal((await signatures.POST(request({action:'sign',token:stale,consent:true},registrar))).status,403);
 // Expired invitation fails without advancing; unrelated stale revisions cannot overwrite it.
 assert.equal((await act(registrar,{action:'request-signature',id})).status,200);const expired=mailToken();
 const row=sql.prepare('SELECT owner,payload,revision FROM workspaces').get();const stored=JSON.parse(row.payload);stored.cases.find(c=>c.id===id).pending.expiresAt=0;sql.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(stored),row.owner);
 assert.equal((await signatures.POST(request({action:'sign',token:expired,consent:true},registrar))).status,403);
 assert.equal((await workflow.POST(request({action:'request-signature',id,revision:row.revision},registrar))).status,409);
 // Sign-out invalidates the session.
 assert.equal((await auth.POST(request({action:'logout'},registrar))).status,200);assert.equal((await get(registrar)).status,401);assert.equal((await get(faculty)).status,200);
 sql.exec("UPDATE sessions SET expires_at=0");assert.equal((await get(faculty)).status,401);
});
