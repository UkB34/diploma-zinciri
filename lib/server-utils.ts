import {env} from 'cloudflare:workers';
import {MEETING} from './shared-state';
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function limitedBody(req:Request,limit:number){
 const reader=req.body?.getReader();if(!reader)throw Error('İstek boş.');let size=0;const chunks:Uint8Array[]=[];
 while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit){await reader.cancel();throw Error('Dosya veya istek boyutu sınırı aşıldı.');}chunks.push(r.value);}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
export async function saveState(data:any,revision:number){
 const payload=JSON.stringify(data);if(new TextEncoder().encode(payload).length>1800000)throw Error('Prototip kayıt kapasitesine ulaşıldı.');
 const result=await env.DB!.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?').bind(payload,MEETING,revision).run();
 return result.meta.changes===1;
}
export async function transcriptFields(body:any,user:{username:string},existing:any=null){
 const fields:any={};for(const k of ['program','faculty','university']){const value=String(body[k]||'').trim();if(value.length<2||value.length>150)throw Error('Üniversite, fakülte ve program bilgilerini tamamlayın.');fields[k]=value;}
 if(existing&&body.transcriptId===existing.id){fields.transcript=existing;return fields;}
 const file=await env.DB!.prepare('SELECT id,filename,sha256,size FROM transcripts WHERE id=? AND uploader=?').bind(String(body.transcriptId||''),user.username).first<any>();
 if(!file)throw Error('Bu hesaptan yüklenmiş bir PDF transkript seçin.');
 fields.transcript={id:file.id,name:file.filename,hash:file.sha256,size:file.size};return fields;
}
