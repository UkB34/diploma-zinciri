import {env} from 'cloudflare:workers';
import {MEETING} from '../../../lib/shared-state';
import {currentVersion} from '../../../lib/workflow.mjs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const code=(new URL(req.url).searchParams.get('code')||'').trim().toUpperCase();const headers={'Cache-Control':'no-store'};
 if(!/^TEST-[A-F0-9]{20}$/.test(code))return Response.json({error:'Geçerli bir TEST doğrulama kodu girin.'},{status:400,headers});
 const row=await env.DB!.prepare('SELECT payload FROM workspaces WHERE owner=?').bind(MEETING).first<{payload:string}>();
 const c=row?JSON.parse(row.payload).cases.find((c:any)=>c.credential?.code===code):null;
 if(!c)return Response.json({error:'Kayıt bulunamadı.'},{status:404,headers});
 const v=currentVersion(c);return Response.json({name:v.content.name,university:v.content.university,program:v.content.program,version:v.number,status:c.status,created:c.credential.at,code:c.credential.code,nft:false},{headers});
}
