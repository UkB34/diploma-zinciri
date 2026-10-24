import {getAppUser} from '../../../lib/auth';
import {readState} from '../../../lib/shared-state';
import {validOrigin,hashToken} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody,saveState} from '../../../lib/server-utils';
import {signatureConfig} from '../../../lib/mail';
import {challengeMatches,keyId} from '../../../lib/signatures.mjs';
import {approvalCredential,createVcJwt,verifyVcJwt} from '../../../lib/vc.mjs';
import {currentVersion,completeSignature} from '../../../lib/workflow.mjs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Davetin gönderildiği hesapla giriş yapın.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 try{
 const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,2000)));if(!/^[a-f0-9]{64}$/.test(body.token||''))return json({error:'Geçersiz davet.'},400);
 const tokenHash=await hashToken(body.token);const {data,revision}=await readState();const c=data.cases.find((x:any)=>challengeMatches(x.pending,x,user,tokenHash));
 if(!c)return json({error:'Davetin süresi dolmuş, kullanılmış veya başka bir hesaba ait. Doğru hesapla giriş yapın ya da panelden yeni davet isteyin.'},403);
 const v=currentVersion(c);
 if(body.action==='inspect')return json({caseId:c.id,version:v.number,content:v.content,hash:v.hash,username:user.username,role:user.role,expiresAt:c.pending.expiresAt});
 if(body.action!=='sign'||body.consent!==true)return json({error:'Belgeyi inceleyip onay VC’si oluşturmayı onaylayın.'},400);
 const config=signatureConfig(user);if(await keyId(config.keys.publicKey)!==c.pending.keyId)throw Error('VC issuer anahtarı değişti. Yeni davet isteyin.');
 const approvedAt=new Date().toISOString();const {credential,issuer}=approvalCredential({origin:config.origin,role:user.role,username:user.username,caseId:c.id,version:v.number,documentHash:v.hash,transcriptHash:v.content.transcript.hash,requestId:c.pending.requestId,approvedAt});
 const vcKeyId=issuer+'#'+await keyId(config.keys.publicKey);const jwt=await createVcJwt(credential,config.keys,vcKeyId);
 const proof={type:'W3C_VC_JWT_TEST',algorithm:'ES256',jwt,payload:credential,publicKey:config.keys.publicKey,keyId:await keyId(config.keys.publicKey),issuer,at:approvedAt};
 const check=await verifyVcJwt(jwt,config.keys.publicKey,issuer,vcKeyId);if(!check.verified)throw Error(check.error||'VC doğrulanamadı.');
 await completeSignature(c,user,proof,{origin:config.origin,publicKey:config.keys.publicKey});
 if(!await saveState(data,revision))return json({error:'Dosya güncellendi. Sayfayı yenileyip tekrar deneyin.'},409);
 return json({ok:true,status:c.status,proof});
 }catch(e){return json({error:e instanceof Error?e.message:'VC onayı tamamlanamadı.'},400);}
}
