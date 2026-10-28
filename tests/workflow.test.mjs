import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCase,changeCase,verifyChain,currentVersion,completeSignature,migrateState,publicState,canAct} from '../lib/workflow.mjs';
import {generateSigningKey,signApproval,verifyApproval,challengeMatches} from '../lib/signatures.mjs';
const fields={program:'Bilgisayar Mühendisliği',faculty:'Mühendislik',university:'Örnek Üniversite',transcript:{id:'pdf-1',hash:'a'.repeat(64)}};
const make=()=>makeCase('Örnek Öğrenci','20220001','Test transkript bilgileri','registrar','ogrenci_isleri',fields);
const keys=await generateSigningKey();
const proof=async(c,role)=>signApproval({purpose:'diploma-approval-v2',caseId:c.id,version:currentVersion(c).number,documentHash:currentVersion(c).hash,transcriptHash:currentVersion(c).content.transcript.hash,username:role,role,requestId:crypto.randomUUID(),signedAt:new Date().toISOString()},keys);
const sign=async(c,role)=>completeSignature(c,{username:role,role},await proof(c,role));
test('dört gerçek kriptografik test imzası ve sıralı geçiş',async()=>{const c=await make();await assert.rejects(sign(c,'faculty'));for(const r of ['registrar','faculty','rector','central'])await sign(c,r);assert.equal(c.status,'issued');assert.equal(c.approvals.length,4);for(const a of c.approvals)assert.equal(await verifyApproval(a.proof,keys.publicKey),true);await assert.rejects(changeCase(c,'central','issue'));await changeCase(c,'central','revoke',{note:'Test iptali'});assert.equal(c.status,'revoked');assert.equal(await verifyChain(c),true);});
test('eski API işlemleri ve bölüm rolü onay veremez',async()=>{const c=await make();for(const a of ['submit','approve','reject'])await assert.rejects(changeCase(c,'registrar',a));assert.equal(canAct(c,'department','request-signature'),false);});
test('düzeltme tüm güncel imzaları yeniden gerektirir, geçmiş korunur',async()=>{const c=await make();await sign(c,'registrar');const stale=await proof(c,'faculty');await changeCase(c,'faculty','correct',{note:'Transkript düzeltilecek'});await changeCase(c,'registrar','revise',{note:'Yeni transkript',fields:{...fields,transcript:{id:'pdf-2',hash:'b'.repeat(64)}}});assert.equal(c.status,'draft');assert.equal(c.approvals.length,1);await assert.rejects(completeSignature(c,{username:'faculty',role:'faculty'},stale));assert.equal(currentVersion(c).number,2);assert.equal(await verifyChain(c),true);});
test('değişen içerik, sahte anahtar ve değiştirilmiş imza tespit edilir',async()=>{const c=await make(),p=await proof(c,'registrar');assert.equal(await verifyApproval(p),true);assert.equal(await verifyApproval(p,(await generateSigningKey()).publicKey),false);p.payload.username='attacker';assert.equal(await verifyApproval(p),false);const q=await proof(c,'registrar');q.signature=q.signature.replace(/^./,q.signature[0]==='A'?'B':'A');assert.equal(await verifyApproval(q),false);c.events[0].note='bozuldu';assert.equal(await verifyChain(c),false);});
test('davet hesap, rol, sürüm, aşama ve süreye bağlıdır; hash dışarı çıkmaz',async()=>{const c=await make(),user={username:'registrar',role:'registrar'};c.pending={username:'registrar',role:'registrar',tokenHash:'secret-hash',version:1,hash:currentVersion(c).hash,expiresAt:200,stage:'draft'};assert.equal(challengeMatches(c.pending,c,user,'secret-hash',100),true);assert.equal(challengeMatches(c.pending,c,user,'secret-hash',201),false);assert.equal(challengeMatches(c.pending,c,{...user,username:'other'},'secret-hash',100),false);assert.equal(JSON.stringify(publicState({cases:[c]})).includes('secret-hash'),false);c.status='faculty';assert.equal(challengeMatches(c.pending,c,user,'secret-hash',100),false);});
test('V1 geçişi eski olayları değiştirmez ve imza uydurmaz',async()=>{const c=await make();delete c.protocol;c.status='department';const before=JSON.stringify(c.events[0]);await migrateState({cases:[c]});assert.equal(c.protocol,2);assert.equal(c.status,'draft');assert.equal(JSON.stringify(c.events[0]),before);assert.equal(c.approvals.length,0);assert.equal(await verifyChain(c),true);const count=c.events.length;assert.equal(await migrateState({cases:[c]}),false);assert.equal(c.events.length,count);});

test('otomatik diploma benzersizdir ve yalnızca onaylı genel bilgileri paylaşır',async()=>{
 const {publicDiploma}=await import('../lib/public-diploma.mjs');
 const a=await make(),b=await make();assert.equal(await publicDiploma(a),null);
 for(const c of [a,b])for(const r of ['registrar','faculty','rector','central'])await sign(c,r);
 assert.notEqual(a.credential.code,b.credential.code);assert.equal(a.credential.version,1);
 const d=await publicDiploma(a);assert.equal(d.diplomaAvailable,true);assert.equal(d.approvals.length,4);
 for(const field of ['student','notes','transcript','events','proof','username'])assert.equal(JSON.stringify(d).includes('"'+field+'"'),false);
 await changeCase(a,'central','revoke',{note:'Test iptali'});assert.equal((await publicDiploma(a)).status,'revoked');
 a.versions[0].content.name='Değiştirilmiş isim';assert.equal(await publicDiploma(a),null);
});
