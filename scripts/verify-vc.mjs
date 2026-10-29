// Offline diploma VC check: node scripts/verify-vc.mjs DIPLOMA.vc.jwt did.json [SITE_ADRESI]
// did.json: https://<site>/api/did/did.json adresinden bir kez indirilir. İptal durumu çevrimdışı kontrol edilemez.
import {readFile} from 'node:fs/promises';
import {decodeJwt,verifyIssuedCredential,keyFromDidDocument,isRevokedByList} from '../lib/vc.mjs';
const [vcFile,didFile,origin='https://diploma-zinciri.bllufuk04.workers.dev',listFile]=process.argv.slice(2);
if(!vcFile||!didFile)throw Error('Kullanım: node scripts/verify-vc.mjs DIPLOMA.vc.jwt did.json [SITE_ADRESI] [status-list.jwt]');
const jwt=(await readFile(vcFile,'utf8')).trim();
try{
 const key=await keyFromDidDocument(JSON.parse(await readFile(didFile,'utf8')),origin);
 const vc=await verifyIssuedCredential(jwt,{origin,universityJwk:key,type:'DiplomaCredential'});
 const d=vc.credentialSubject.diploma;
 console.log('✓ İmza geçerli — düzenleyen:',vc.issuer.id);
 console.log('  Mezun:',vc.credentialSubject.name,'·',d.program,'·',d.faculty,'·',d.university);
 console.log('  Belge kodu:',d.code,'· Sürüm',d.version,'· Düzenlenme:',vc.validFrom);
 for(const e of vc.evidence||[])console.log('  Onay kanıtı:',e.role,e.approvedAt,e.approver.slice(0,40)+'…');
 if(listFile){const revoked=await isRevokedByList((await readFile(listFile,'utf8')).trim(),vc,{origin,universityJwk:key});console.log(revoked?'✗ Belge İPTAL EDİLMİŞ':'✓ İptal listesinde iptal kaydı yok');if(revoked)process.exitCode=1;}
 else console.log('! İptal durumu kontrol edilmedi. /api/status-list çıktısını dördüncü argüman olarak verin.');
}catch(e){console.error('✗ Doğrulama başarısız:',e.message);console.error('  Başlık:',JSON.stringify(decodeJwt(jwt).header));process.exitCode=1;}
