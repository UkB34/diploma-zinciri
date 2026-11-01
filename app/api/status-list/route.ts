import {currentStatusList} from '../../../lib/credentials';
export const dynamic='force-dynamic';
// Bitstring Status List credential (revocation) for every VC this site issues. Public by design.
export async function GET(){
 try{return new Response(await currentStatusList(),{headers:{'Content-Type':'application/vc+jwt','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'İptal listesi hazır değil.'},{status:503,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});}
}
