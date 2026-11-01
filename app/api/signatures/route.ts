import {getAppUser} from '../../../lib/auth';
import {readState} from '../../../lib/shared-state';
import {validOrigin,hashToken} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody,saveState} from '../../../lib/server-utils';
import {activeApprover,appOrigin,universityKey,isRevoked,revokeCredential} from '../../../lib/credentials';
import {issueDiplomaVc} from '../../../lib/diploma';
import {verifyApprovalPresentation} from '../../../lib/vc.mjs';
import {currentVersion,completeSignature,changeCase,challengeMatches,approvalClaims} from '../../../lib/workflow.mjs';
import {deliverNotification} from '../../../lib/notifications';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Davetin gönderildiği hesapla giriş yapın.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 let diploma:any=null;
 try{
 const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,24000)));if(!/^[a-f0-9]{64}$/.test(body.token||''))return json({error:'Geçersiz davet.'},400);
 const tokenHash=await hashToken(body.token);const {data,revision}=await readState();const c=data.cases.find((x:any)=>challengeMatches(x.pending,x,user,tokenHash));
 if(!c)return json({error:'Davetin süresi dolmuş, kullanılmış veya başka bir hesaba ait. Doğru hesapla giriş yapın ya da panelden yeni davet isteyin.'},403);
 const origin=appOrigin(),approver=await activeApprover(user.username);
 if(!approver||approver.id!==c.pending.approverCredentialId||approver.holder!==c.pending.holder)return json({error:'Dijital kimliğiniz davetten sonra değişti veya iptal edildi. Panelden yeni davet isteyin.'},409);
 const v=currentVersion(c),claims=approvalClaims(c,user.role);
 if(body.action==='inspect')return json({caseId:c.id,version:v.number,content:v.content,hash:v.hash,username:user.username,role:user.role,expiresAt:c.pending.expiresAt,
  challenge:{nonce:c.pending.challenge,audience:origin,holder:c.pending.holder,approverJwt:approver.jwt,approval:claims}});
 if(body.action!=='sign'||body.consent!==true||typeof body.presentation!=='string')return json({error:'Belgeyi inceleyip onaylamayı kabul edin.'},400);
 const verified=await verifyApprovalPresentation(body.presentation,{origin,universityJwk:(await universityKey()).publicJwk,isRevoked:(id:string)=>isRevoked(id),
  expected:{...claims,nonce:c.pending.challenge,username:user.username,holder:c.pending.holder,approverCredentialId:c.pending.approverCredentialId}});
 const nonce=c.pending.challenge;
 await completeSignature(c,user,{...verified,nonce,presentation:body.presentation});
 // Fourth approval: the university issues the diploma VC in the same state update.
 if(c.status==='ready'){try{diploma=await issueDiplomaVc(c);await changeCase(c,'central','issue',{diploma},user.username);}catch{diploma=null;}}
 if(!await saveState(data,revision)){if(diploma)await revokeCredential(diploma.id);return json({error:'Dosya güncellendi. Sayfayı yenileyip tekrar deneyin.'},409);}
 let notification={status:'not-needed'};try{notification=await deliverNotification(c.id);}catch{notification={status:'failed'};}
 return json({ok:true,status:c.status,holder:verified.holder,notification,credentialCode:c.credential?.code||null});
 }catch(e){return json({error:e instanceof Error?e.message:'Onay tamamlanamadı.'},400);}
}
