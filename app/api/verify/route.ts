import {env} from 'cloudflare:workers';
import {MEETING} from '../../../lib/shared-state';
import {currentVersion,roles} from '../../../lib/workflow.mjs';
import {keyId} from '../../../lib/signatures.mjs';
import {verifyVcJwt} from '../../../lib/vc.mjs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const code=(new URL(req.url).searchParams.get('code')||'').trim().toUpperCase();const headers={'Cache-Control':'no-store'};
 if(!/^TEST-[A-F0-9]{20}$/.test(code))return Response.json({error:'Geçerli bir TEST doğrulama kodu girin.'},{status:400,headers});
 const row=await env.DB!.prepare('SELECT payload FROM workspaces WHERE owner=?').bind(MEETING).first<{payload:string}>();
 const c=row?JSON.parse(row.payload).cases.find((c:any)=>c.credential?.code===code):null;
 if(!c)return Response.json({error:'Kayıt bulunamadı.'},{status:404,headers});
 if(!env.APP_ORIGIN||!env.SIGNING_KEYS_JSON)return Response.json({error:'VC doğrulama anahtarları yapılandırılmamış.'},{status:503,headers});
 const keys=JSON.parse(env.SIGNING_KEYS_JSON);const origin=new URL(env.APP_ORIGIN).origin;const v=currentVersion(c);
 const approvalChecks=await Promise.all(roles.map(async role=>{
  const approval=c.approvals.find((a:any)=>a.role===role.id&&a.version===v.number&&a.hash===v.hash);
  const material=keys[role.id];if(!approval||!material?.publicKey)return {role:role.id,verified:false};
  const issuer=origin+'/issuers/'+role.id;const kid=issuer+'#'+await keyId(material.publicKey);
  const result=await verifyVcJwt(approval.proof?.jwt,material.publicKey,issuer,kid);
  const s=result.credential?.credentialSubject;
  return {role:role.id,verified:result.verified&&s?.caseId===c.id&&s?.version===v.number&&s?.documentHash===v.hash&&s?.transcriptHash===v.content.transcript?.hash};
 }));
 const finalIssuer=origin+'/issuers/central';const central=keys.central;
 const finalJwt=c.credential?.vc;const finalKid=central?.publicKey?finalIssuer+'#'+await keyId(central.publicKey):'';
 const finalResult=central?.publicKey?await verifyVcJwt(finalJwt,central.publicKey,finalIssuer,finalKid):{verified:false};
 const subject=finalResult.credential?.credentialSubject;
 const finalMatches=finalResult.verified&&subject?.caseId===c.id&&subject?.version===v.number&&subject?.documentHash===v.hash&&subject?.transcriptHash===v.content.transcript?.hash;
 const verified=c.status==='issued'&&approvalChecks.every(x=>x.verified)&&finalMatches;
 return Response.json({name:v.content.name,university:v.content.university,program:v.content.program,version:v.number,status:c.status,created:c.credential.at,code:c.credential.code,nft:false,verified,verification:{format:'W3C VC-JWT test',approvals:approvalChecks,finalCredential:!!finalMatches,issuer:finalIssuer}}, {headers});
}
