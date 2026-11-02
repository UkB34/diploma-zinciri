import {chainStatus} from '../../../../lib/chain-server';
export const dynamic='force-dynamic';
// Public: anyone can ask which on-chain records exist for a diploma code or VC hash.
export async function GET(req:Request){
 const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'};
 const u=new URL(req.url),code=(u.searchParams.get('code')||'').trim().toUpperCase(),hash=(u.searchParams.get('hash')||'').trim().toLowerCase();
 if(!/^TEST-[A-F0-9]{20}$/.test(code)&&!/^[0-9a-f]{64}$/.test(hash))return Response.json({error:'Geçerli bir diploma kodu veya VC özeti girin.'},{status:400,headers});
 try{return Response.json(await chainStatus(code?{code}:{hash}),{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Zincir bilgisi alınamadı.'},{status:503,headers});}
}
