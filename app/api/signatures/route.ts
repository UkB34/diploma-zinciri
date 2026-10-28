import {getAppUser} from '../../../lib/auth';
import {readState} from '../../../lib/shared-state';
import {validOrigin,hashToken} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody,saveState} from '../../../lib/server-utils';
import {signatureConfig} from '../../../lib/mail';
import {challengeMatches,signApproval,verifyApproval,keyId} from '../../../lib/signatures.mjs';
import {currentVersion,completeSignature} from '../../../lib/workflow.mjs';
import {deliverNotification} from '../../../lib/notifications';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Davetin gönderildiği hesapla giriş yapın.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 try{
 const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,2000)));if(!/^[a-f0-9]{64}$/.test(body.token||''))return json({error:'Geçersiz davet.'},400);
 const tokenHash=await hashToken(body.token);const {data,revision}=await readState();const c=data.cases.find((x:any)=>challengeMatches(x.pending,x,user,tokenHash));
 if(!c)return json({error:'Davetin süresi dolmuş, kullanılmış veya başka bir hesaba ait. Doğru hesapla giriş yapın ya da panelden yeni davet isteyin.'},403);
 const v=currentVersion(c);
 if(body.action==='inspect')return json({caseId:c.id,version:v.number,content:v.content,hash:v.hash,username:user.username,role:user.role,expiresAt:c.pending.expiresAt});
 if(body.action!=='sign'||body.consent!==true)return json({error:'Belgeyi inceleyip imzalamayı onaylayın.'},400);
 const config=signatureConfig(user);if(await keyId(config.keys.publicKey)!==c.pending.keyId)throw Error('İmza anahtarı değişti. Yeni davet isteyin.');
 const proof=await signApproval({purpose:'diploma-approval-v2',caseId:c.id,version:v.number,documentHash:v.hash,transcriptHash:v.content.transcript.hash,username:user.username,role:user.role,requestId:c.pending.requestId,signedAt:new Date().toISOString()},config.keys);
 if(!await verifyApproval(proof,config.keys.publicKey))throw Error('İmza doğrulanamadı.');
 await completeSignature(c,user,proof);
 if(!await saveState(data,revision))return json({error:'Dosya güncellendi. Sayfayı yenileyip tekrar deneyin.'},409);
 let notification={status:'not-needed'};try{notification=await deliverNotification(c.id);}catch{notification={status:'failed'};}
 return json({ok:true,status:c.status,proof,notification,credentialCode:c.credential?.code||null});
 }catch(e){return json({error:e instanceof Error?e.message:'İmza tamamlanamadı.'},400);}
}
