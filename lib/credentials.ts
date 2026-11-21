import {env} from 'cloudflare:workers';
import {importUniversityKey,issueCredential,statusListCredential,approverCredential,randomId,decodeJwt,STATUS_LIST_SIZE} from './vc.mjs';
import {roles} from './workflow.mjs';
type Row={id:string,kind:string,username:string|null,role:string|null,subject:string,status_index:number,jwt:string,revoked:number,created_at:number,revoked_at:number|null};
let cached:{raw:string,key:any}|null=null;
export function appOrigin(){
 if(!env.APP_ORIGIN)throw Error('Site adresi (APP_ORIGIN) tanımlanmadı.');
 const u=new URL(env.APP_ORIGIN);if(u.protocol!=='https:'||u.pathname!=='/')throw Error('APP_ORIGIN geçerli bir HTTPS site adresi olmalı.');
 return u.origin;
}
export async function universityKey(){
 const raw=env.UNIVERSITY_KEY_JSON;if(!raw)throw Error('Üniversite DID anahtarı (UNIVERSITY_KEY_JSON) tanımlanmadı. Yönetici V3 kurulumunu tamamlamalı.');
 if(!cached||cached.raw!==raw)cached={raw,key:await importUniversityKey(raw)};
 return cached.key as {privateKey:CryptoKey,publicJwk:any};
}
// Every issued VC gets a random, unique slot in the revocation list.
export async function issueStored(kind:'approver'|'diploma',username:string|null,role:string|null,subject:string,build:(statusIndex:number,id:string)=>any){
 const key=await universityKey(),origin=appOrigin();
 for(let attempt=0;attempt<6;attempt++){
  const statusIndex=crypto.getRandomValues(new Uint32Array(1))[0]%STATUS_LIST_SIZE,id=randomId();
  const jwt=await issueCredential(key,origin,build(statusIndex,id));
  try{await env.DB!.prepare('INSERT INTO credentials (id,kind,username,role,subject,status_index,jwt,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,kind,username,role,subject,statusIndex,jwt,Date.now()).run();return {id,jwt,statusIndex};}
  catch(e){if(!String(e).includes('UNIQUE'))throw e;}
 }
 throw Error('İptal listesinde boş yer bulunamadı.');
}
export async function activeApprover(username:string){
 const row=await env.DB!.prepare("SELECT * FROM credentials WHERE kind='approver' AND username=? AND revoked=0 ORDER BY created_at DESC LIMIT 1").bind(username).first<Row>();
 if(!row)return null;
 const vc=decodeJwt(row.jwt).payload;if(Date.parse(vc.validUntil)<Date.now())return null;
 return {id:row.id,jwt:row.jwt,holder:row.subject,role:row.role,issuedAt:vc.validFrom,validUntil:vc.validUntil};
}
export async function enrollApprover(user:{username:string,role:string},holder:string){
 const r=roles.find(x=>x.id===user.role);if(!r)throw Error('Bu hesap onay rolüne sahip değil.');
 const origin=appOrigin();
 const issued=await issueStored('approver',user.username,user.role,holder,(statusIndex,id)=>approverCredential({id,holder,username:user.username,role:user.role,roleLabel:r.label,unit:r.unit,statusIndex,origin}));
 // One active wallet per account: binding a new browser revokes the previous approver credential.
 await env.DB!.prepare("UPDATE credentials SET revoked=1,revoked_at=? WHERE kind='approver' AND username=? AND id<>? AND revoked=0").bind(Date.now(),user.username,issued.id).run();
 return issued;
}
export async function revokeCredential(id:string){
 await env.DB!.prepare('UPDATE credentials SET revoked=1,revoked_at=? WHERE id=? AND revoked=0').bind(Date.now(),id).run();
}
// Revoked "as of" a moment: a key revoked after an approval does not undo that approval.
export async function revokedAt(id:string,at:number){
 const row=await env.DB!.prepare('SELECT revoked,revoked_at FROM credentials WHERE id=?').bind(id).first<{revoked:number,revoked_at:number|null}>();
 return !row||(!!row.revoked&&(row.revoked_at??0)<=at);
}
export async function isRevoked(id:string){
 const row=await env.DB!.prepare('SELECT revoked FROM credentials WHERE id=?').bind(id).first<{revoked:number}>();
 return !row||!!row.revoked;
}
export async function currentStatusList(){
 const rows=await env.DB!.prepare('SELECT status_index FROM credentials WHERE revoked=1').all<{status_index:number}>();
 return statusListCredential(await universityKey(),appOrigin(),(rows.results||[]).map((r:{status_index:number})=>r.status_index));
}
