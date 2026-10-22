import {env} from 'cloudflare:workers';
import {getAppUser} from '../../../lib/auth';
import {readState} from '../../../lib/shared-state';
import {validOrigin} from '../../../lib/auth-crypto.mjs';
import {json,limitedBody} from '../../../lib/server-utils';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);if(user.role!=='registrar'||!validOrigin(req))return json({error:'Yetkisiz istek.'},403);
 try{
 const bytes=await limitedBody(req,1550000);const form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();const file=form.get('file');
 if(!file||typeof file==='string'||file.size>1500000||file.size<8||!file.name.toLowerCase().endsWith('.pdf'))return json({error:'En fazla 1,5 MB boyutunda PDF yükleyin.'},400);
 const buffer=await file.arrayBuffer();if(!new TextDecoder().decode(buffer.slice(0,5)).startsWith('%PDF-'))return json({error:'Dosya PDF biçiminde değil.'},400);
 const count=await env.DB!.prepare('SELECT count(*) AS n FROM transcripts').first<{n:number}>();if((count?.n||0)>=300)return json({error:'Prototipin 300 dosyalık yükleme sınırına ulaşıldı.'},409);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');const id=crypto.randomUUID();const name=file.name.replace(/[^a-zA-Z0-9._\- çğıöşüÇĞİÖŞÜ]/g,'_').slice(0,160);
 await env.DB!.prepare('INSERT INTO transcripts (id,uploader,filename,sha256,size,data,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,user.username,name,hash,file.size,buffer,Date.now()).run();
 return json({id,name,hash,size:file.size});
 }catch{return json({error:'PDF yüklenemedi. Boyutu, dosya biçimini ve veritabanı kurulumunu kontrol edin.'},400);}
}
export async function GET(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);const id=new URL(req.url).searchParams.get('id')||'';
 const {data}=await readState();const linked=data.cases.some((c:any)=>c.versions.some((v:any)=>v.content.transcript?.id===id));
 const file=await env.DB!.prepare('SELECT uploader,data FROM transcripts WHERE id=?').bind(id).first<{uploader:string,data:ArrayBuffer}>();
 if(!file||(!linked&&file.uploader!==user.username))return json({error:'Dosya bulunamadı.'},404);
 return new Response(file.data,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="transkript.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
}
