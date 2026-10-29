import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passwordHash,readSessionCookie} from '../lib/auth-crypto.mjs';
import {generateSigningKey,signApproval} from '../lib/signatures.mjs';
import * as vc from '../lib/vc.mjs';
const origin='https://test.example';
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const DB={prepare(query){return {args:[],bind(...args){this.args=args.map(a=>a instanceof ArrayBuffer?new Uint8Array(a):a);return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){const r=sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const universityKey=await vc.generateUniversityKey();
globalThis.__env={DB,TEST_ACCOUNTS_JSON:JSON.stringify(await Promise.all([['ogrenci_isleri','registrar'],['fakulte','faculty'],['rektorluk','rector'],['merkez','central'],['bolum','department']].map(async([username,role])=>({username,role,salt:'integration-test-salt',hash:await passwordHash('test-only-password','integration-test-salt')})))),
 UNIVERSITY_KEY_JSON:JSON.stringify(universityKey),ROLE_EMAILS_JSON:JSON.stringify({ogrenci_isleri:'registrar@example.com',fakulte:'faculty@example.com',rektorluk:'rector@example.com',merkez:'central@example.com'}),BREVO_API_KEY:'test-only',MAIL_FROM:'test@example.com',APP_ORIGIN:origin};
globalThis.__headers=new Headers();
const cache=new Map();
function moduleUrl(file){file=resolve(file);if(cache.has(file))return cache.get(file);let source=readFileSync(file,'utf8');source=source.replace(/import\s*\{\s*env\s*\}\s*from\s*['"]cloudflare:workers['"];?/g,'const env=globalThis.__env;').replace(/import\s*\{\s*headers\s*\}\s*from\s*['"]next\/headers['"];?/g,'const headers=async()=>globalThis.__headers;');source=source.replace(/from\s*['"]([^'"]+)['"]/g,(full,spec)=>{if(!spec.startsWith('.'))return full;let dep=resolve(dirname(file),spec);if(!extname(dep))dep+='.ts';return 'from '+JSON.stringify(dep.endsWith('.ts')?moduleUrl(dep):pathToFileURL(dep).href);});const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');cache.set(file,url);return url;}
const auth=await import(moduleUrl('app/api/auth/route.ts'));
const workflow=await import(moduleUrl('app/api/workflow/route.ts'));
const signatures=await import(moduleUrl('app/api/signatures/route.ts'));
const transcripts=await import(moduleUrl('app/api/transcripts/route.ts'));
const walletApi=await import(moduleUrl('app/api/wallet/route.ts'));
const verify=await import(moduleUrl('app/api/verify/route.ts'));
const didApi=await import(moduleUrl('app/api/did/did.json/route.ts'));
const statusApi=await import(moduleUrl('app/api/status-list/route.ts'));
function request(body,cookie='',from=origin){globalThis.__headers=new Headers({cookie});return new Request(origin+'/api/x',{method:'POST',headers:{origin:from,host:'test.example',cookie,'Content-Type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify(body)});}
const get=async(cookie)=>{globalThis.__headers=new Headers({cookie});return workflow.GET();};
let mail=[],mailFails=false,notificationFails=false;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');if(mailFails||(notificationFails&&JSON.parse(options.body).subject.includes('incelemenizi')))return Response.json({error:'test'},{status:403});assert.equal(options.headers['api-key'],'test-only');const body=JSON.parse(options.body);assert.deepEqual(body.sender,{name:'Diploma Zinciri',email:'test@example.com'});mail.push(body);return Response.json({messageId:'<mail-test>'});};
const login=async username=>{const r=await auth.POST(request({username,password:'test-only-password'}));assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
const state=async cookie=>(await get(cookie)).json();
const act=async(cookie,body)=>{const s=await state(cookie);return workflow.POST(request({...body,revision:s.revision},cookie));};
const mailToken=()=>mail.filter(m=>m.textContent.includes('/imzala#token=')).at(-1).textContent.match(/token=([a-f0-9]{64})/)[1];
// Simulates the browser wallet: non-extractable key, only the public part leaves.
async function newWallet(){const pair=await crypto.subtle.generateKey(vc.KEY_ALG,false,['sign','verify']);return {privateKey:pair.privateKey,did:vc.didJwk(await crypto.subtle.exportKey('jwk',pair.publicKey))};}
async function enroll(cookie,username,wallet){
 const ch=await walletApi.POST(request({action:'challenge'},cookie));assert.equal(ch.status,200);const {nonce,audience}=await ch.json();
 const proof=await vc.enrollmentProof({privateKey:wallet.privateKey,did:wallet.did,nonce,audience,username});
 return walletApi.POST(request({action:'enroll',nonce,did:wallet.did,proof},cookie));
}
async function present(cookie,token,wallet,tweak=x=>x){
 const r=await signatures.POST(request({action:'inspect',token},cookie));assert.equal(r.status,200);const d=await r.json();
 const c=tweak(d.challenge);
 return vc.createApprovalPresentation({privateKey:wallet.privateKey,did:wallet.did,approverJwt:c.approverJwt,approval:c.approval,nonce:c.nonce,audience:c.audience});
}
const verifyCode=async code=>{globalThis.__headers=new Headers();return verify.GET(new Request(origin+'/api/verify?code='+code));};

test('VC ile dört onay: cüzdan kaydı, sunum doğrulama, diploma VC, iptal listesi',async()=>{
 assert.equal((await get('')).status,401);
 assert.equal((await auth.POST(request({username:'bolum',password:'test-only-password'}))).status,401);
 const cookies={registrar:await login('ogrenci_isleri'),faculty:await login('fakulte'),rector:await login('rektorluk'),central:await login('merkez')};
 const names={registrar:'ogrenci_isleri',faculty:'fakulte',rector:'rektorluk',central:'merkez'};
 assert.ok(readSessionCookie(cookies.registrar));
 // DID document is public and matches the configured key.
 const didDoc=await (await didApi.GET()).json();assert.equal(didDoc.id,'did:web:test.example:api:did');assert.deepEqual(await vc.keyFromDidDocument(didDoc,origin),universityKey.publicKey);
 const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nTest transcript\n%%EOF'],{type:'application/pdf'}),'test.pdf');
 globalThis.__headers=new Headers({cookie:cookies.registrar});const pdf=await (await transcripts.POST(new Request(origin+'/api/transcripts',{method:'POST',headers:{origin,host:'test.example'},body:form}))).json();
 const fields={program:'Bilgisayar Mühendisliği',faculty:'Mühendislik',university:'Örnek Üniversite',transcriptId:pdf.id};
 assert.equal((await act(cookies.registrar,{action:'create',name:'Test Öğrenci',student:'20220001',note:'Temsili transkript',...fields})).status,200);
 let s=await state(cookies.registrar),id=s.cases[0].id;assert.equal(s.cases[0].protocol,3);
 // No wallet yet: an invitation cannot be requested.
 assert.equal((await act(cookies.registrar,{action:'request-signature',id})).status,412);
 // Enrollment: proof of possession, single-use challenge, wrong-user proof rejected.
 const wallets={};
 for(const role of Object.keys(cookies)){
  wallets[role]=await newWallet();
  const bad=await enroll(cookies[role],'baska_hesap',wallets[role]);assert.equal(bad.status,400);
  const r=await enroll(cookies[role],names[role],wallets[role]);assert.equal(r.status,200);const d=await r.json();
  assert.equal(d.credential.holder,wallets[role].did);assert.equal(d.notice,'sent');
  const sub=vc.decodeJwt(d.credential.jwt).payload.credentialSubject;assert.equal(sub.role,role);assert.equal(sub.username,names[role]);
  assert.equal(JSON.stringify(d).includes('privateKey'),false);
 }
 assert.equal(mail.filter(m=>m.subject.includes('dijital kimliğiniz')).length,4);
 const attacker=await newWallet();
 assert.equal((await workflow.POST(request({action:'request-signature',id,revision:s.revision},cookies.registrar,'https://evil.example'))).status,403);
 for(const [role,next] of [['registrar','faculty'],['faculty','rector'],['rector','central'],['central','issued']]){
  const cookie=cookies[role];
  assert.equal((await act(cookie,{action:'request-signature',id})).status,200);
  s=await state(cookie);assert.ok(s.cases[0].pending);assert.equal('tokenHash' in s.cases[0].pending,false);assert.equal('challenge' in s.cases[0].pending,false);
  const token=mailToken();assert.match(mail.at(-1).subject,/VC onay daveti/);
  const other=role==='faculty'?cookies.registrar:cookies.faculty;
  assert.equal((await signatures.POST(request({action:'inspect',token},other))).status,403);
  // Attacker key presenting the stolen approver VC: holder mismatch.
  let vp=await present(cookie,token,attacker);assert.equal((await signatures.POST(request({action:'sign',token,consent:true,presentation:vp},cookie))).status,400);
  // Right key, wrong document hash.
  vp=await present(cookie,token,wallets[role],c=>({...c,approval:{...c.approval,documentHash:'f'.repeat(64)}}));assert.equal((await signatures.POST(request({action:'sign',token,consent:true,presentation:vp},cookie))).status,400);
  // Right key, wrong nonce (replay of another invitation).
  vp=await present(cookie,token,wallets[role],c=>({...c,nonce:'0'.repeat(64)}));assert.equal((await signatures.POST(request({action:'sign',token,consent:true,presentation:vp},cookie))).status,400);
  vp=await present(cookie,token,wallets[role]);
  assert.equal((await signatures.POST(request({action:'sign',token,consent:false,presentation:vp},cookie))).status,400);
  if(role==='faculty')notificationFails=true;
  const signed=await signatures.POST(request({action:'sign',token,consent:true,presentation:vp},cookie));assert.equal(signed.status,200);const result=await signed.json();
  assert.equal(result.status,next);assert.equal(result.holder,wallets[role].did);
  if(role==='faculty'){
   assert.equal(result.notification.status,'failed');notificationFails=false;
   const row=sql.prepare('SELECT owner,payload FROM workspaces').get();const payload=JSON.parse(row.payload);payload.cases.find(c=>c.id===id).notification.attemptAt=0;sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(payload),row.owner);
   assert.equal((await act(cookies.registrar,{action:'retry-notification',id})).status,403);
   assert.equal((await act(cookie,{action:'retry-notification',id})).status,200);
   assert.equal((await state(cookie)).cases[0].notification.status,'sent');
  }
  if(role!=='central'){const n=mail.at(-1);assert.equal(n.to[0].email,({faculty:'faculty@example.com',rector:'rector@example.com',central:'central@example.com'})[next]);assert.equal(n.textContent.includes('token='),false);}
  else assert.match(result.credentialCode,/^TEST-[A-F0-9]{20}$/);
  // Replay of the same invitation and presentation.
  assert.equal((await signatures.POST(request({action:'sign',token,consent:true,presentation:vp},cookie))).status,403);
 }
 assert.equal((await act(cookies.central,{action:'issue',id})).status,403);
 const issued=(await state(cookies.central)).cases[0];
 assert.equal(issued.approvals.filter(a=>a.presentation).length,4);
 // Public verification: every check recomputed from signed data.
 let r=await verifyCode(issued.credential.code);assert.equal(r.status,200);let d=await r.json();
 assert.equal(d.protocol,3);assert.equal(d.status,'issued');assert.ok(d.checks.every(c=>c.ok));assert.equal(d.checks.length,7);
 for(const field of ['student','notes','transcript','username','presentation'])assert.equal(JSON.stringify(d).includes('"'+field+'"'),false);
 const diplomaVc=await vc.verifyIssuedCredential(d.vc,{origin,universityJwk:universityKey.publicKey,type:'DiplomaCredential'});
 assert.equal(diplomaVc.credentialSubject.name,'Test Öğrenci');assert.equal(diplomaVc.credentialSubject.diploma.transcriptHash,pdf.hash);assert.equal(diplomaVc.evidence.length,4);
 assert.equal(JSON.stringify(diplomaVc).includes('20220001'),false);
 const list=async()=>(await statusApi.GET()).text();
 assert.equal(await vc.isRevokedByList(await list(),diplomaVc,{origin,universityJwk:universityKey.publicKey}),false);
 // A tampered VC fails even though it is otherwise well-formed.
 const [h,p,sig]=d.vc.split('.');const forged=JSON.parse(Buffer.from(p,'base64url'));forged.credentialSubject.name='Sahte İsim';
 await assert.rejects(vc.verifyIssuedCredential([h,Buffer.from(JSON.stringify(forged)).toString('base64url'),sig].join('.'),{origin,universityJwk:universityKey.publicKey,type:'DiplomaCredential'}));
 // Faculty moves to a new browser: old approver VC revoked, but approvals made before stay valid.
 const oldFacultyCred=issued.approvals.find(a=>a.role==='faculty').approverCredentialId;
 wallets.faculty=await newWallet();assert.equal((await enroll(cookies.faculty,'fakulte',wallets.faculty)).status,200);
 const oldCred=vc.decodeJwt(sql.prepare('SELECT jwt FROM credentials WHERE id=?').get(oldFacultyCred).jwt).payload;
 assert.equal(await vc.isRevokedByList(await list(),oldCred,{origin,universityJwk:universityKey.publicKey}),true);
 d=await (await verifyCode(issued.credential.code)).json();assert.ok(d.checks.every(c=>c.ok));
 // Tampering with stored data makes the record unverifiable.
 const row=sql.prepare('SELECT owner,payload FROM workspaces').get();const original=row.payload;const bad=JSON.parse(original);bad.cases.find(c=>c.id===id).versions[0].content.name='Değiştirilmiş';
 sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(bad),row.owner);assert.equal((await verifyCode(issued.credential.code)).status,404);
 sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(original,row.owner);
 // Revocation reaches both the record and the signed status list.
 assert.equal((await act(cookies.central,{action:'revoke',id,note:'Test iptal gerekçesi'})).status,200);
 d=await (await verifyCode(issued.credential.code)).json();assert.equal(d.status,'revoked');assert.equal(d.checks.at(-1).ok,false);
 assert.equal(await vc.isRevokedByList(await list(),diplomaVc,{origin,universityJwk:universityKey.publicKey}),true);
 // A pending invitation dies when the wallet is re-bound.
 assert.equal((await act(cookies.registrar,{action:'create',name:'İkinci Öğrenci',student:'20220002',note:'Temsili transkript',...fields})).status,200);
 id=(await state(cookies.registrar)).cases[0].id;
 assert.equal((await act(cookies.registrar,{action:'request-signature',id})).status,200);const pendingToken=mailToken();
 const before=await present(cookies.registrar,pendingToken,wallets.registrar);
 wallets.registrar=await newWallet();assert.equal((await enroll(cookies.registrar,'ogrenci_isleri',wallets.registrar)).status,200);
 assert.equal((await signatures.POST(request({action:'sign',token:pendingToken,consent:true,presentation:before},cookies.registrar))).status,409);
 // Mail failure leaves no usable invitation; a new version invalidates an old one; expiry is enforced.
 const row2=sql.prepare('SELECT owner,payload,revision FROM workspaces').get();const st=JSON.parse(row2.payload);st.cases.find(c=>c.id===id).pending=null;sql.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(st),row2.owner);
 mailFails=true;assert.equal((await act(cookies.registrar,{action:'request-signature',id})).status,502);mailFails=false;s=await state(cookies.registrar);assert.equal(s.cases[0].status,'draft');assert.equal(s.cases[0].pending,null);
 assert.equal((await act(cookies.registrar,{action:'request-signature',id})).status,200);const stale=mailToken();const staleVp=await present(cookies.registrar,stale,wallets.registrar);
 assert.equal((await act(cookies.registrar,{action:'revise',id,note:'Yeni sürüm açıklaması',...fields})).status,200);
 assert.equal((await signatures.POST(request({action:'sign',token:stale,consent:true,presentation:staleVp},cookies.registrar))).status,403);
 assert.equal((await act(cookies.registrar,{action:'request-signature',id})).status,200);const expired=mailToken();const expiredVp=await present(cookies.registrar,expired,wallets.registrar);
 const row3=sql.prepare('SELECT owner,payload,revision FROM workspaces').get();const stored=JSON.parse(row3.payload);stored.cases.find(c=>c.id===id).pending.expiresAt=0;sql.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(stored),row3.owner);
 assert.equal((await signatures.POST(request({action:'sign',token:expired,consent:true,presentation:expiredVp},cookies.registrar))).status,403);
 assert.equal((await workflow.POST(request({action:'request-signature',id,revision:row3.revision},cookies.registrar))).status,409);
 // Sign-out invalidates the session.
 assert.equal((await auth.POST(request({action:'logout'},cookies.registrar))).status,200);assert.equal((await get(cookies.registrar)).status,401);assert.equal((await get(cookies.faculty)).status,200);
 sql.exec('UPDATE sessions SET expires_at=0');assert.equal((await get(cookies.faculty)).status,401);
});

test('eski V2 diplomaları VC geçişinden sonra da doğrulanır',async()=>{
 const {makeCase,currentVersion,changeCase}=await import('../lib/workflow.mjs');
 const keys=await generateSigningKey();
 const c=await makeCase('Eski Mezun','20190001','Eski kayıt','registrar','ogrenci_isleri',{program:'Fizik',faculty:'Fen',university:'Örnek Üniversite',transcript:{id:'old',hash:'c'.repeat(64)}});
 c.protocol=2;const v=currentVersion(c);
 for(const role of ['registrar','faculty','rector','central'])c.approvals.push({role,username:role,version:1,hash:v.hash,at:new Date().toISOString(),proof:await signApproval({purpose:'diploma-approval-v2',caseId:c.id,version:1,documentHash:v.hash,transcriptHash:v.content.transcript.hash,username:role,role,requestId:crypto.randomUUID(),signedAt:new Date().toISOString()},keys)});
 c.status='ready';await changeCase(c,'central','issue',{},'merkez');assert.equal(c.status,'issued');
 const row=sql.prepare('SELECT owner,payload FROM workspaces').get();const payload=JSON.parse(row.payload);payload.cases.push(c);sql.prepare('UPDATE workspaces SET payload=? WHERE owner=?').run(JSON.stringify(payload),row.owner);
 const r=await verifyCode(c.credential.code);assert.equal(r.status,200);const d=await r.json();assert.equal(d.protocol,2);assert.equal(d.diplomaAvailable,true);
});
