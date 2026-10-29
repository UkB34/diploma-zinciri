import {issueStored,appOrigin,universityKey,revokedAt,isRevoked} from './credentials';
import {diplomaCredential,verifyIssuedCredential,verifyApprovalPresentation,universityDid} from './vc.mjs';
import {currentVersion,stages,newDiplomaCode,digest} from './workflow.mjs';
const approvalFor=(c:any,role:string,v:any)=>c.approvals.find((a:any)=>a.role===role&&a.version===v.number&&a.hash===v.hash&&a.presentation);
// Called once the fourth (central) VC approval is stored; the university signs the student's diploma VC.
export async function issueDiplomaVc(c:any){
 const v=currentVersion(c),code=newDiplomaCode(),origin=appOrigin();
 const approvals=stages.map(r=>{const a=approvalFor(c,r,v);if(!a)throw Error('Dört onay tamamlanmadı.');return a;});
 const issued=await issueStored('diploma',null,null,code,(statusIndex,id)=>diplomaCredential({id,code,content:v.content,version:v.number,documentHash:v.hash,approvals,statusIndex,origin}));
 return {code,id:issued.id,jwt:issued.jwt};
}
type Check={id:string,label:string,ok:boolean,detail?:string};
// Re-verifies everything from stored signed data on every request. Returns null when the record cannot be trusted.
export async function publicDiplomaV3(c:any){
 if(!c?.credential?.vc||!['issued','revoked'].includes(c.status))return null;
 const v=c.versions.find((x:any)=>x.hash===c.credential.hash&&x.number===c.credential.version);
 if(!v||await digest(v.content)!==v.hash)return null;
 const origin=appOrigin(),universityJwk=(await universityKey()).publicJwk;
 let vc:any;
 try{vc=await verifyIssuedCredential(c.credential.vc,{origin,universityJwk,type:'DiplomaCredential'});}catch{return null;}
 const d=vc.credentialSubject?.diploma||{};
 const contentOk=vc.id===c.credential.vcId&&vc.credentialSubject.name===v.content.name&&d.code===c.credential.code&&d.university===v.content.university&&d.faculty===v.content.faculty&&d.program===v.content.program&&d.version===v.number&&d.documentHash===v.hash&&d.transcriptHash===v.content.transcript?.hash;
 if(!contentOk)return null;
 const approvals:any[]=[],checks:Check[]=[
  {id:'signature',label:'Diploma VC’sinin imzası üniversitenin DID anahtarıyla doğrulandı',ok:true},
  {id:'content',label:'Belge içeriği değiştirilmemiş',ok:true},
 ];
 for(const role of stages){
  const a=approvalFor(c,role,v),evidence=(vc.evidence||[]).find((e:any)=>e.role===role);
  try{
   if(!a||!evidence)throw Error('Onay kaydı yok.');
   const r=await verifyApprovalPresentation(a.presentation,{origin,universityJwk,fresh:false,isRevoked:(id:string,at:number)=>revokedAt(id,at),
    expected:{caseId:c.id,version:v.number,documentHash:v.hash,transcriptHash:v.content.transcript.hash,role,nonce:a.nonce,username:a.username,holder:a.holder,approverCredentialId:a.approverCredentialId}});
   if(r.presentationDigest!==evidence.presentationDigest||r.holder!==evidence.approver)throw Error('Diploma VC’sindeki kanıt eşleşmiyor.');
   approvals.push({role,at:r.at,holder:r.holder});checks.push({id:role,label:role,ok:true});
  }catch{return null;}
 }
 const revoked=c.status==='revoked'||await isRevoked(c.credential.vcId);
 checks.push({id:'status',label:revoked?'Belge iptal edilmiş':'Belge iptal edilmemiş',ok:!revoked});
 return {protocol:3,name:v.content.name,university:v.content.university,faculty:v.content.faculty,program:v.content.program,version:v.number,status:revoked?'revoked':c.status,created:c.credential.at,code:c.credential.code,issuer:universityDid(origin),vc:c.credential.vc,nft:false,diplomaAvailable:true,checks,approvals};
}
