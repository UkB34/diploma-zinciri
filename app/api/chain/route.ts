import {getAppUser} from '../../../lib/auth';
import {validOrigin} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody} from '../../../lib/server-utils';
import {chainConfig,createBenchDiplomas,prepareRun,prepareRevoke,submitBatch,cancelBatch,confirmBatch,unauthorizedTest,report,benchCount,availableCounts,recentRecords} from '../../../lib/chain-server';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 try{return json({config:chainConfig(),canAct:user.role==='central',benchCount:await benchCount(),available:await availableCounts(),runs:await report(),records:await recentRecords()});}
 catch(e){return json({error:e instanceof Error?e.message:'Blokzincir bilgisi alınamadı.'},503);}
}
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 if(user.role!=='central')return json({error:'Blokzincir işlemlerini yalnızca merkez yetkilisi yapabilir.'},403);
 try{
  const body=JSON.parse(new TextDecoder().decode(await limitedBody(req,4000)));
  const method=body.method==='anchor'?'anchor':body.method==='nft'?'nft':null;
  switch(body.action){
   case 'generate':return json({created:(await createBenchDiplomas(Number(body.count))).length,benchCount:await benchCount()});
   case 'prepare':if(!method)break;return json(await prepareRun(method,body.source==='issued'?'issued':'bench',Number(body.size),user.username));
   case 'revoke':if(!method||!/^TEST-[A-F0-9]{20}$/.test(body.code||''))break;return json(await prepareRevoke(method,body.code,user.username));
   case 'submit':await submitBatch(String(body.batchId||''),String(body.txHash||''));return json({ok:true});
   case 'cancel':await cancelBatch(String(body.batchId||''));return json({ok:true});
   case 'confirm':return json(await confirmBatch(String(body.batchId||'')));
   case 'auth-test':if(!method)break;return json(await unauthorizedTest(method));
  }
  return json({error:'Geçersiz işlem.'},400);
 }catch(e){return json({error:e instanceof Error?e.message:'İşlem tamamlanamadı.'},400);}
}
