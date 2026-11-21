import {getAppUser} from '../../../lib/auth';
import {validOrigin} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody} from '../../../lib/server-utils';
import {signTemsili,realDiplomaHashes,TEMSILI_MAX,TEMSILI_BATCH} from '../../../lib/temsili';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 return json({canAct:user.role==='central',max:TEMSILI_MAX,batch:TEMSILI_BATCH});
}
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 if(user.role!=='central')return json({error:'Temsili diplomaları yalnızca merkez yetkilisi üretebilir.'},403);
 try{
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,1000)));
  if(body.action==='sign')return json({diplomas:await signTemsili(Number(body.start),Number(body.count))});
  if(body.action==='real')return json({diplomas:await realDiplomaHashes()});
  return json({error:'Geçersiz işlem.'},400);
 }catch(e){return json({error:e instanceof Error?e.message:'İşlem tamamlanamadı.'},400);}
}
