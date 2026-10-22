import {verifyApproval} from './signatures.mjs';
export const roles = [
 {id:'registrar',label:'Öğrenci işleri',name:'Öğrenci işleri yetkilisi',unit:'Öğrenci işleri',initials:'Öİ'},
 {id:'faculty',label:'Fakülte yetkilisi',name:'Fakülte yetkilisi',unit:'Fakülte',initials:'FK'},
 {id:'rector',label:'Rektörlük yetkilisi',name:'Rektörlük yetkilisi',unit:'Rektörlük',initials:'RK'},
 {id:'central',label:'Merkezi doğrulama',name:'Merkez yetkilisi',unit:'Temsili merkez',initials:'MR'},
];
export const stages=['registrar','faculty','rector','central'];
export const statusLabels={draft:'Öğrenci işleri',correction:'Düzeltme bekliyor',faculty:'Fakülte onayı',rector:'Rektörlük onayı',central:'Merkezi doğrulama',ready:'İmzalar tamamlandı',issued:'Test belgesi oluşturuldu',rejected:'Eski sürüm: reddedildi',revoked:'İptal edildi'};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function currentVersion(c){return c.versions.at(-1);}
export async function event(c,role,action,from,to,note='',actor='system'){
 const r=roles.find(x=>x.id===role);const previous=c.events.at(-1)?.hash||'GENESIS';
 const e={id:crypto.randomUUID(),at:new Date().toISOString(),actor,person:actor,role:r?.label||'Sistem',unit:r?.unit||'Merkez',action,from,to,note,version:currentVersion(c).number,documentHash:currentVersion(c).hash,previous,source:'Web paneli / V2 test hesabı'};
 e.hash=await digest(e);c.events.push(e);return e;
}
export async function makeCase(name,student,notes,role='registrar',actor='system',fields={}){
 const content={name,student,program:fields.program||'',university:fields.university||'',faculty:fields.faculty||'',notes,transcript:fields.transcript||null};
 const c={id:'DZ-'+crypto.randomUUID().slice(0,8).toUpperCase(),protocol:2,status:'draft',created:new Date().toISOString(),versions:[{number:1,content,hash:await digest(content)}],events:[],approvals:[],credential:null,pending:null};
 await event(c,role,'Dosya oluşturuldu','—','draft','',actor);return c;
}
export async function initialState(){return {role:'registrar',cases:[]};}
export async function migrateState(data){
 let changed=false;
 for(const c of data.cases){if(c.protocol)continue;changed=true;
 if(['issued','revoked','rejected'].includes(c.status)){c.protocol=1;continue;}
 const from=c.status;c.protocol=2;c.pending=null;c.status='draft';
 await event(c,'registrar','V2 imzalı sürece geçiş',from,'draft','Eski kayıtlar korundu. PDF ve öğrenci bilgileri tamamlandıktan sonra dört test imzası yeniden alınacak.');
 }return changed;
}
export function canAct(c,role,action){
 if(c.protocol!==2)return action==='revoke'&&role==='central'&&c.status==='issued';
 if(action==='request-signature')return (role==='registrar'&&c.status==='draft')||(role===c.status&&stages.includes(role));
 if(action==='revise')return role==='registrar'&&['draft','correction'].includes(c.status);
 if(action==='correct')return role===c.status&&['faculty','rector','central'].includes(role);
 if(action==='issue')return role==='central'&&c.status==='ready';
 if(action==='revoke')return role==='central'&&c.status==='issued';
 return false;
}
export function assertReady(c){const v=currentVersion(c);if(!v.content.transcript||!['program','faculty','university'].every(k=>v.content[k]?.trim()))throw Error('Öğrenci bilgilerini tamamlayın ve PDF transkript yükleyin.');}
export async function completeSignature(c,user,proof){
 if(!canAct(c,user.role,'request-signature'))throw Error('İşlem sırası bu hesapta değil.');
 assertReady(c);const v=currentVersion(c),p=proof.payload,index=stages.indexOf(user.role);
 if(await digest(v.content)!==v.hash||p.caseId!==c.id||p.version!==v.number||p.documentHash!==v.hash||p.transcriptHash!==v.content.transcript.hash||p.username!==user.username||p.role!==user.role||p.purpose!=='diploma-approval-v2'||!await verifyApproval(proof))throw Error('İmza belge veya hesapla eşleşmiyor.');
 if(!stages.slice(0,index).every(r=>c.approvals.some(a=>a.role===r&&a.version===v.number&&a.hash===v.hash&&a.proof)))throw Error('Önceki imzalar eksik.');
 const from=c.status;c.approvals.push({role:user.role,username:user.username,version:v.number,hash:v.hash,at:p.signedAt,proof,type:proof.type});c.pending=null;c.status=stages[index+1]||'ready';
 await event(c,user.role,'Test dijital imzası doğrulandı',from,c.status,'Sunucuda tutulan test anahtarıyla imzalandı; nitelikli e-imza değildir.',user.username);
}
export async function changeCase(c,role,action,input={},actor='system'){
 if(!canAct(c,role,action)||action==='request-signature')throw Error('Bu işlem için yetkiniz yok veya önceki imzalar tamamlanmadı.');
 const from=c.status;const note=String(input.note||'').trim();
 if(['correct','revoke','revise'].includes(action)&&(note.length<5||note.length>3000))throw Error('5–3000 karakter arasında açıklama yazın.');
 let label='';
 if(action==='correct'){c.status='correction';c.pending=null;label='Düzeltme istendi';}
 if(action==='revise'){const v=currentVersion(c);const content={...v.content,...input.fields,notes:note};c.versions.push({number:v.number+1,content,hash:await digest(content)});c.status='draft';c.pending=null;label='Yeni sürüm oluşturuldu';}
 if(action==='issue'){if(!stages.every(r=>c.approvals.some(a=>a.role===r&&a.version===currentVersion(c).number&&a.hash===currentVersion(c).hash&&a.proof)))throw Error('Dört imza tamamlanmadı.');c.status='issued';c.credential={code:'TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),at:new Date().toISOString(),hash:currentVersion(c).hash,network:null,token:null};label='Test doğrulama kaydı oluşturuldu';}
 if(action==='revoke'){c.status='revoked';label='Test belgesi iptal edildi';}
 await event(c,role,label,from,c.status,note,actor);return c;
}
export async function verifyChain(c){let previous='GENESIS';for(const e of c.events){const {hash,...body}=e;if(body.previous!==previous||await digest(body)!==hash)return false;previous=hash;}return true;}
export function publicState(data){return {...data,cases:data.cases.map(c=>({...c,pending:c.pending?{username:c.pending.username,role:c.pending.role,expiresAt:c.pending.expiresAt}:null}))};}
