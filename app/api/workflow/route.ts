import { env } from 'cloudflare:workers';
import {getAppUser} from '../../../lib/auth';
import {readState,MEETING} from '../../../lib/shared-state';
import {validOrigin} from '../../../lib/auth-crypto.mjs';
import { initialState, roles, makeCase, changeCase, event, verifyChain, currentVersion } from '../../../lib/workflow.mjs';
export const dynamic = 'force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 const s=await readState();return json({...s.data,role:user.role,username:user.username,revision:s.revision});
}
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 let body:any;try{const raw=await req.text();if(raw.length>18000)return json({error:'İstek çok büyük.'},413);body=JSON.parse(raw);}catch{return json({error:'Geçersiz istek.'},400);}
 const {data,revision}=await readState();if(body.revision!==revision)return json({error:'Dosya başka bir işlemle güncellendi. Yenileyip tekrar deneyin.'},409);
 let failure='';
 try{
 if(body.action==='role'||body.role!==undefined)return json({error:'Hesap yetkisi değiştirilemez. Farklı hesap için çıkış yapın.'},403);
 if(body.action==='create'){
  if(user.role!=='registrar')throw new Error('Dosyayı yalnızca öğrenci işleri oluşturabilir.');
  const name=String(body.name||'').trim(),student=String(body.student||'').trim(),notes=String(body.note||'').trim();
  if(name.length<3||name.length>90||!/^\d{4,15}$/.test(student)||notes.length<5||notes.length>3000)throw new Error('Ad, öğrenci numarası ve belge içeriğini kontrol edin.');
  if(data.cases.some((c:any)=>currentVersion(c).content.student===student))throw new Error('Bu öğrenci numarasıyla zaten bir dosya var.');
  if(data.cases.length>=100)throw new Error('Prototipte en fazla 100 dosya oluşturulabilir.');
  data.cases.unshift(await makeCase(name,student,notes,user.role,user.username));
 }else{
  const c=data.cases.find((x:any)=>x.id===body.id);if(!c)throw new Error('Dosya bulunamadı.');
  if(body.action==='check')return json({valid:await verifyChain(c)});
  try{await changeCase(c,user.role,body.action,{note:body.note},user.username);}catch(e){failure=e instanceof Error?e.message:'İşlem başarısız.';await event(c,user.role,'İşlem engellendi',c.status,c.status,failure,user.username);}
 }
 const result=await env.DB!.prepare('UPDATE workspaces SET payload=?, revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(data),MEETING,revision).run();
 if(result.meta.changes!==1)return json({error:'Eşzamanlı işlem algılandı. Sayfayı yenileyin.'},409);
 return json({...data,role:user.role,username:user.username,revision:revision+1,...(failure?{error:failure}:{})},failure?403:200);
 }catch(e){return json({error:e instanceof Error?e.message:'İşlem tamamlanamadı.'},400);}
}
