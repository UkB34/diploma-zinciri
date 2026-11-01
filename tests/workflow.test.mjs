import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCase,changeCase,verifyChain,currentVersion,completeSignature,migrateState,publicState,canAct,challengeMatches,approvalClaims,hasApproval} from '../lib/workflow.mjs';
import {generateSigningKey,signApproval,verifyApproval} from '../lib/signatures.mjs';
import * as vc from '../lib/vc.mjs';
const origin='https://test.example';
const fields={program:'Bilgisayar Mühendisliği',faculty:'Mühendislik',university:'Örnek Üniversite',transcript:{id:'pdf-1',hash:'a'.repeat(64)}};
const make=()=>makeCase('Örnek Öğrenci','20220001','Test transkript bilgileri','registrar','ogrenci_isleri',fields);
const university=await vc.importUniversityKey(await vc.generateUniversityKey());
const wallets={};
for(const role of ['registrar','faculty','rector','central']){
 const pair=await crypto.subtle.generateKey(vc.KEY_ALG,false,['sign','verify']);const did=vc.didJwk(await crypto.subtle.exportKey('jwk',pair.publicKey));
 const id=vc.randomId();
 wallets[role]={privateKey:pair.privateKey,did,id,jwt:await vc.issueCredential(university,origin,vc.approverCredential({id,holder:did,username:role,role,roleLabel:role,unit:role,statusIndex:Object.keys(wallets).length,origin}))};
}
async function approve(c,role,{wallet=wallets[role],claims=approvalClaims(c,role)}={}){
 const nonce=crypto.randomUUID();
 const presentation=await vc.createApprovalPresentation({privateKey:wallet.privateKey,did:wallet.did,approverJwt:wallets[role].jwt,approval:claims,nonce,audience:origin});
 const verified=await vc.verifyApprovalPresentation(presentation,{origin,universityJwk:university.publicJwk,expected:{...approvalClaims(c,role),nonce,username:role,holder:wallets[role].did,approverCredentialId:wallets[role].id}});
 return completeSignature(c,{username:role,role},{...verified,nonce,presentation});
}
const diploma=c=>({code:'TEST-'+'A'.repeat(20),id:vc.randomId(),jwt:'x.y.z'});

test('dört VC onayı sırayla, tarayıcı anahtarıyla; diploma ancak dört onaydan sonra',async()=>{
 const c=await make();assert.equal(c.protocol,3);
 await assert.rejects(approve(c,'faculty'));
 for(const r of ['registrar','faculty','rector'])await approve(c,r);
 assert.equal(c.status,'central');assert.equal(c.notification.role,'central');
 await approve(c,'central');assert.equal(c.status,'ready');
 await assert.rejects(changeCase(c,'central','issue',{}));
 await changeCase(c,'central','issue',{diploma:diploma(c)});assert.equal(c.status,'issued');assert.ok(c.credential.vc);
 for(const a of c.approvals){assert.equal(a.type,'VC_PRESENTATION');assert.match(a.holder,/^did:jwk:/);}
 await changeCase(c,'central','revoke',{note:'Test iptali'});assert.equal(c.status,'revoked');assert.equal(await verifyChain(c),true);
});
test('başkasının anahtarı, yanlış sürüm ve başka rolün VC’si reddedilir',async()=>{
 const c=await make();
 await assert.rejects(approve(c,'registrar',{wallet:wallets.faculty}),/dijital kimliğiyle|anahtarla/);
 await assert.rejects(approve(c,'registrar',{claims:{...approvalClaims(c,'registrar'),version:2}}),/sürümüyle eşleşmiyor/);
 await assert.rejects(approve(c,'registrar',{claims:{...approvalClaims(c,'registrar'),documentHash:'f'.repeat(64)}}),/eşleşmiyor/);
 assert.equal(c.approvals.length,0);assert.equal(c.status,'draft');
});
test('düzeltme tüm güncel onayları yeniden gerektirir, geçmiş korunur',async()=>{
 const c=await make();await approve(c,'registrar');
 await changeCase(c,'faculty','correct',{note:'Transkript düzeltilecek'});
 await changeCase(c,'registrar','revise',{note:'Yeni transkript',fields:{...fields,transcript:{id:'pdf-2',hash:'b'.repeat(64)}}});
 assert.equal(c.status,'draft');assert.equal(c.approvals.length,1);assert.equal(hasApproval(c,'registrar'),false);
 await assert.rejects(approve(c,'faculty'));assert.equal(currentVersion(c).number,2);assert.equal(await verifyChain(c),true);
});
test('eski API işlemleri ve bölüm rolü onay veremez',async()=>{const c=await make();for(const a of ['submit','approve','reject'])await assert.rejects(changeCase(c,'registrar',a));assert.equal(canAct(c,'department','request-signature'),false);});
test('davet hesap, rol, sürüm, aşama ve süreye bağlıdır; hash dışarı çıkmaz',async()=>{const c=await make(),user={username:'registrar',role:'registrar'};c.pending={username:'registrar',role:'registrar',tokenHash:'secret-hash',challenge:'secret-nonce',version:1,hash:currentVersion(c).hash,expiresAt:200,stage:'draft'};assert.equal(challengeMatches(c.pending,c,user,'secret-hash',100),true);assert.equal(challengeMatches(c.pending,c,user,'secret-hash',201),false);assert.equal(challengeMatches(c.pending,c,{...user,username:'other'},'secret-hash',100),false);const out=JSON.stringify(publicState({cases:[c]}));assert.equal(out.includes('secret-hash'),false);assert.equal(out.includes('secret-nonce'),false);c.status='faculty';assert.equal(challengeMatches(c.pending,c,user,'secret-hash',100),false);});
test('V1 ve yarım kalan V2 dosyaları VC sürecine taşınır; eski imzalar sayılmaz',async()=>{
 const v1=await make();delete v1.protocol;v1.status='department';const before=JSON.stringify(v1.events[0]);
 const keys=await generateSigningKey();const v2=await make();v2.protocol=2;v2.status='faculty';
 const v=currentVersion(v2);v2.approvals.push({role:'registrar',username:'registrar',version:1,hash:v.hash,proof:await signApproval({purpose:'diploma-approval-v2',caseId:v2.id},keys)});
 const issued=await make();issued.protocol=2;issued.status='issued';
 assert.equal(await migrateState({cases:[v1,v2,issued]}),true);
 assert.equal(v1.protocol,3);assert.equal(v1.status,'draft');assert.equal(JSON.stringify(v1.events[0]),before);
 assert.equal(v2.protocol,3);assert.equal(v2.status,'draft');assert.equal(v2.approvals.length,1);assert.equal(hasApproval(v2,'registrar'),false);
 assert.equal(issued.protocol,2);assert.equal(canAct(issued,'central','revoke'),true);assert.equal(canAct(issued,'central','request-signature'),false);
 assert.equal(await verifyApproval(v2.approvals[0].proof),true);
 const count=v1.events.length;assert.equal(await migrateState({cases:[v1,v2,issued]}),false);assert.equal(v1.events.length,count);
 for(const c of [v1,v2,issued])assert.equal(await verifyChain(c),true);
});
test('iptal listesi: gzip bit dizisi, imzalı ve kurcalanamaz',async()=>{
 const list=await vc.statusListCredential(university,origin,[0,5,131071]);
 const entry=i=>({credentialStatus:vc.statusEntry(origin,i)});
 for(const [i,expected] of [[0,true],[1,false],[5,true],[131071,true],[77,false]])assert.equal(await vc.isRevokedByList(list,entry(i),{origin,universityJwk:university.publicJwk}),expected);
 const [h,p,s]=list.split('.');const tampered=[h,p.slice(0,-2)+(p.at(-2)==='A'?'B':'A')+p.at(-1),s].join('.');
 await assert.rejects(vc.isRevokedByList(tampered,entry(0),{origin,universityJwk:university.publicJwk}));
 const other=await vc.importUniversityKey(await vc.generateUniversityKey());
 await assert.rejects(vc.isRevokedByList(await vc.statusListCredential(other,origin,[]),entry(0),{origin,universityJwk:university.publicJwk}));
});
test('DID belgeleri: did:jwk kanonik, did:web adresi ve anahtar kimliği tutarlı',async()=>{
 assert.equal(vc.universityDid('https://diploma-zinciri.bllufuk04.workers.dev'),'did:web:diploma-zinciri.bllufuk04.workers.dev:api:did');
 assert.equal(vc.universityDid('https://localhost:8443'),'did:web:localhost%3A8443:api:did');
 const doc=await vc.didDocument(origin,university.publicJwk);assert.deepEqual(await vc.keyFromDidDocument(doc,origin),university.publicJwk);
 await assert.rejects(vc.keyFromDidDocument({...doc,id:'did:web:evil.example:api:did'},origin));
 assert.throws(()=>vc.resolveDidJwk(wallets.registrar.did+'x'));
 assert.throws(()=>vc.publicJwk({...university.publicJwk,d:'secret'}));
});
