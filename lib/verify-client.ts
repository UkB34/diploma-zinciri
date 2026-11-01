'use client';
// Independent, in-browser verification of a diploma VC: only the public DID document and status list are fetched.
import {decodeJwt,verifyIssuedCredential,keyFromDidDocument,isRevokedByList,universityDid,didDocumentUrl,statusListUrl} from './vc.mjs';
export type Step={label:string,ok:boolean,detail?:string};
export async function verifyDiplomaInBrowser(jwt:string){
 const steps:Step[]=[];const origin=location.origin;let vc:any=null;
 const add=(label:string,ok:boolean,detail?:string)=>{steps.push({label,ok,detail});return ok;};
 try{decodeJwt(jwt.trim());add('Dosya geçerli bir vc+jwt biçiminde',true);}catch(e:any){add('Dosya geçerli bir vc+jwt biçiminde',false,e.message);return {steps,vc,valid:false};}
 let key:any;
 try{const r=await fetch(didDocumentUrl(origin),{cache:'no-store'});if(!r.ok)throw Error('DID belgesi alınamadı.');key=await keyFromDidDocument(await r.json(),origin);add('Üniversitenin DID belgesi çözüldü ('+universityDid(origin)+')',true);}
 catch(e:any){add('Üniversitenin DID belgesi çözüldü',false,e.message);return {steps,vc,valid:false};}
 try{vc=await verifyIssuedCredential(jwt.trim(),{origin,universityJwk:key,type:'DiplomaCredential'});add('İmza üniversitenin anahtarıyla doğrulandı; içerik değiştirilmemiş',true);}
 catch(e:any){add('İmza üniversitenin anahtarıyla doğrulandı',false,e.message);return {steps,vc,valid:false};}
 add('Dört birim onayının kanıtı belgede kayıtlı',Array.isArray(vc.evidence)&&['registrar','faculty','rector','central'].every(r=>vc.evidence.some((e:any)=>e.role===r&&e.approver?.startsWith('did:jwk:'))));
 try{const r=await fetch(statusListUrl(origin),{cache:'no-store'});if(!r.ok)throw Error('İptal listesi alınamadı.');const revoked=await isRevokedByList(await r.text(),vc,{origin,universityJwk:key});add(revoked?'Belge İPTAL EDİLMİŞ':'Belge iptal edilmemiş (imzalı iptal listesine göre)',!revoked);}
 catch(e:any){add('İptal durumu kontrol edildi',false,e.message);}
 return {steps,vc,valid:steps.every(s=>s.ok)};
}
