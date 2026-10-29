import {env} from 'cloudflare:workers';
import {MEETING} from '../../../lib/shared-state';
import {publicDiploma} from '../../../lib/public-diploma.mjs';
import {publicDiplomaV3} from '../../../lib/diploma';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const code=(new URL(req.url).searchParams.get('code')||'').trim().toUpperCase();
 const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
 if(!/^TEST-[A-F0-9]{20}$/.test(code))return Response.json({error:'Geçerli bir TEST doğrulama kodu girin.'},{status:400,headers});
 const row=await env.DB!.prepare('SELECT payload FROM workspaces WHERE owner=?').bind(MEETING).first<{payload:string}>();
 const c=row?JSON.parse(row.payload).cases.find((c:any)=>c.credential?.code===code):null;
 let result:any=null;
 try{result=c?.protocol===3?await publicDiplomaV3(c):await publicDiploma(c);}catch{return Response.json({error:'Doğrulama altyapısı şu anda hazır değil.'},{status:503,headers});}
 if(!result)return Response.json({error:'Doğrulanabilir belge bulunamadı.'},{status:404,headers});
 return Response.json(result,{headers});
}
