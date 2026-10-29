import {env} from 'cloudflare:workers';
import {getAppUser} from '../../../lib/auth';
import {validOrigin,randomToken,hashToken} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody} from '../../../lib/server-utils';
import {activeApprover,enrollApprover,appOrigin} from '../../../lib/credentials';
import {sendWalletNotice} from '../../../lib/mail';
import {verifyEnrollmentProof,universityDid} from '../../../lib/vc.mjs';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 try{const origin=appOrigin();return json({username:user.username,role:user.role,issuer:universityDid(origin),credential:await activeApprover(user.username)});}
 catch(e){return json({error:e instanceof Error?e.message:'Cüzdan bilgisi alınamadı.'},503);}
}
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 try{
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,4000)));const origin=appOrigin();const now=Date.now();
  if(body.action==='challenge'){
   const nonce=randomToken();
   await env.DB!.batch([
    env.DB!.prepare('DELETE FROM wallet_challenges WHERE expires_at<? OR username=?').bind(now,user.username),
    env.DB!.prepare('INSERT INTO wallet_challenges (nonce_hash,username,expires_at) VALUES (?,?,?)').bind(await hashToken(nonce),user.username,now+300000),
   ]);
   return json({nonce,audience:origin});
  }
  if(body.action==='enroll'){
   if(typeof body.nonce!=='string'||!/^[a-f0-9]{64}$/.test(body.nonce))return json({error:'Geçersiz kayıt isteği.'},400);
   // Single use: the challenge row is consumed before the proof is checked.
   const challenge=await env.DB!.prepare('DELETE FROM wallet_challenges WHERE nonce_hash=? AND username=? AND expires_at>? RETURNING username').bind(await hashToken(body.nonce),user.username,now).first();
   if(!challenge)return json({error:'Kayıt isteğinin süresi doldu. Tekrar deneyin.'},403);
   await verifyEnrollmentProof(String(body.proof||''),{did:String(body.did||''),nonce:body.nonce,audience:origin,username:user.username});
   const issued=await enrollApprover(user,body.did);
   let notice='sent';try{await sendWalletNotice(user,body.did);}catch{notice='failed';}
   return json({ok:true,notice,credential:await activeApprover(user.username),issuedId:issued.id});
  }
  return json({error:'Geçersiz işlem.'},400);
 }catch(e){return json({error:e instanceof Error?e.message:'Dijital kimlik oluşturulamadı.'},400);}
}
