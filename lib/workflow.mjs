import {verifyApproval} from './signatures.mjs';
import {verifyVcJwt} from './vc.mjs';
export const roles = [
 {id:'registrar',label:'Öğrenci işleri',name:'Öğrenci işleri yetkilisi',unit:'Öğrenci işleri',initials:'Öİ'},
 {id:'faculty',label:'Fakülte yetkilisi',name:'Fakülte yetkilisi',unit:'Fakülte',initials:'FK'},
 {id:'rector',label:'Rektörlük yetkilisi',name:'Rektörlük yetkilisi',unit:'Rektörlük',initials:'RK'},
 {id:'central',label:'Merkezi doğrulama',name:'Merkez yetkilisi',unit:'Temsili merkez',initials:'MR'},
];
export const stages=['registrar','faculty','rector','central'];
export const statusLabels={draft:'Öğrenci işleri',correction:'Düzeltme bekliyor',faculty:'Fakülte onayı',rector:'Rektörlük onayı',central:'Merkez onayı',ready:'Birim VC onayları tamamlandı',issued:'Test diploma VC’si oluşturuldu',rejected:'Eski sürüm: reddedildi',revoked:'İptal edildi'};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function currentVersion(c){return c.versions.at(-1);}
export async function event(c,role,action,from,to,note='',actor='system'){
 const r=roles.find(x=>x.id===role);const previous=c.events.at(-1)?.hash||'GENESIS';
 const e={id:crypto.randomUUID(),at:new Date().toISOString(),actor,person:actor,role:r?.label||'Sistem',unit:r?.unit||'Merkez',action,from,to,note,version:currentVersion(c).number,documentHash:currentVersion(c).hash,previous,source:'Web paneli / V2.1 test hesabı'};
 e.hash=await digest(e);c.events.push(e);return e;
}
export async function makeCase(name,student,notes,role='registrar',actor='system',fields={}){
 const content={name,student,program:fields.program||'',university:fields.university||'',faculty:fields.faculty||'',notes,transcript:fields.transcript||null};
 const c={id:'DZ-'+crypto.randomUUID().slice(0,8).toUpperCase(),protocol:3,status:'draft',created:new Date().toISOString(),versions:[{number:1,content,hash:await digest(content)}],events:[],approvals:[],credential:null,pending:null};
 await event(c,role,'Dosya oluşturuldu','—','draft','',actor);return c;
}
export async function initialState(){return {role:'registrar',cases:[]};}
export async function migrateState(data){
 let changed=false;
 for(const c of data.cases){
  if(c.protocol===3)continue;
  if(c.protocol===2&&!['issued','revoked','rejected'].includes(c.status)){
   changed=true;c.legacyApprovals=[...(c.legacyApprovals||[]),...(c.approvals||[])];c.approvals=[];c.pending=null;
   const from=c.status;c.protocol=3;c.status='draft';
   await event(c,'registrar','VC onay sürecine geçiş',from,'draft','Önceki test imzaları geçmişte korundu; güncel sürüm için dört rolün VC onayı yeniden alınacak.');
   continue;
  }
  if(c.protocol)continue;
  changed=true;
  if(['issued','revoked','rejected'].includes(c.status)){c.protocol=1;continue;}
  const from=c.status;c.protocol=3;c.pending=null;c.approvals=[];
  await event(c,'registrar','VC onay sürecine geçiş',from,'draft','Eski kayıt geçmişte korundu. Belge bilgileri tamamlandıktan sonra dört VC onayı alınacak.');
  c.status='draft';
 }
 return changed;
}
export function canAct(c,role,action){
 if(c.protocol!==3)return action==='revoke'&&role==='central'&&c.status==='issued';
 if(action==='request-signature')return (role==='registrar'&&c.status==='draft')||(role===c.status&&stages.includes(role));
 if(action==='revise')return role==='registrar'&&['draft','correction'].includes(c.status);
 if(action==='correct')return role===c.status&&['faculty','rector','central'].includes(role);
 if(action==='issue')return role==='central'&&c.status==='ready';
 if(action==='revoke')return role==='central'&&c.status==='issued';
 return false;
}
export function assertReady(c){const v=currentVersion(c);if(!v.content.transcript||!['program','faculty','university'].every(k=>v.content[k]?.trim()))throw Error('Öğrenci bilgilerini tamamlayın ve PDF transkript yükleyin.');}
export async function completeSignature(c,user,proof,trust={}){
 if(!canAct(c,user.role,'request-signature'))throw Error('İşlem sırası bu hesapta değil.');
 assertReady(c);const v=currentVersion(c),index=stages.indexOf(user.role);
 let p,verified=false,at;
 if(proof.type==='W3C_VC_JWT_TEST'){
  p=proof.payload?.credentialSubject;at=proof.payload?.validFrom;
  const expectedIssuer=trust.origin?trust.origin+'/issuers/'+user.role:'';
  const result=await verifyVcJwt(proof.jwt,trust.publicKey,expectedIssuer,expectedIssuer+'#'+proof.keyId);
  verified=result.verified&&JSON.stringify(result.credential)===JSON.stringify(proof.payload);
  if(proof.issuer!==expectedIssuer)verified=false;
 }else{
  p=proof.payload;at=p?.signedAt;verified=await verifyApproval(proof,trust.publicKey);
 }
 const requestId=proof.type==='W3C_VC_JWT_TEST'?p?.approvalRequestId:p?.requestId;
 const roleClaim=proof.type==='W3C_VC_JWT_TEST'?p?.approver?.role:p?.role;
 const usernameClaim=proof.type==='W3C_VC_JWT_TEST'?decodeURIComponent((p?.approver?.id||'').replace('urn:diploma-zinciri:account:','')):p?.username;
 const requestBound=proof.type==='W3C_VC_JWT_TEST'?!!c.pending&&requestId===c.pending.requestId:(!c.pending||requestId===c.pending.requestId);
 if(await digest(v.content)!==v.hash||p?.caseId!==c.id||p?.version!==v.number||p?.documentHash!==v.hash||p?.transcriptHash!==v.content.transcript.hash||usernameClaim!==user.username||roleClaim!==user.role||!requestBound||!verified)throw Error('VC belge, düzenleyen, hesap veya imzayla eşleşmiyor.');
 if(proof.type==='W3C_VC_JWT_TEST'&&(!Array.isArray(proof.payload.type)||!proof.payload.type.includes('VerifiableCredential')||!proof.payload.type.includes('DiplomaApprovalCredential')))throw Error('Onay VC türü geçersiz.');
 if(!stages.slice(0,index).every(r=>c.approvals.some(a=>a.role===r&&a.version===v.number&&a.hash===v.hash&&a.proof)))throw Error('Önceki onaylar eksik.');
 const from=c.status;c.approvals.push({role:user.role,username:user.username,version:v.number,hash:v.hash,at,proof,type:proof.type});c.pending=null;c.status=stages[index+1]||'ready';
 const vc=proof.type==='W3C_VC_JWT_TEST';
 await event(c,user.role,vc?'Test onay VC’si imzalandı ve doğrulandı':'Test dijital imzası doğrulandı',from,c.status,vc?'W3C VC-JWT test kimlik bilgisi, güvenilen rol anahtarıyla doğrulandı.':'Sunucuda tutulan test anahtarıyla imzalandı; nitelikli e-imza değildir.',user.username);
}
export async function changeCase(c,role,action,input={},actor='system'){
 if(!canAct(c,role,action)||action==='request-signature')throw Error('Bu işlem için yetkiniz yok veya önceki imzalar tamamlanmadı.');
 const from=c.status;const note=String(input.note||'').trim();
 if(['correct','revoke','revise'].includes(action)&&(note.length<5||note.length>3000))throw Error('5–3000 karakter arasında açıklama yazın.');
 let label='';
 if(action==='correct'){c.status='correction';c.pending=null;label='Düzeltme istendi';}
 if(action==='revise'){const v=currentVersion(c);const content={...v.content,...input.fields,notes:note};c.versions.push({number:v.number+1,content,hash:await digest(content)});c.status='draft';c.pending=null;label='Yeni sürüm oluşturuldu';}
 if(action==='issue'){if(!stages.every(r=>c.approvals.some(a=>a.role===r&&a.version===currentVersion(c).number&&a.hash===currentVersion(c).hash&&a.proof)))throw Error('Dört rolün VC onayı tamamlanmadı.');c.status='issued';c.credential={code:'TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),at:new Date().toISOString(),hash:currentVersion(c).hash,network:null,token:null,vc:input.vc?.jwt||null,issuer:input.vc?.issuer||null};label='Test VC diploma kaydı oluşturuldu';}
 if(action==='revoke'){c.status='revoked';label='Test belgesi iptal edildi';}
 await event(c,role,label,from,c.status,note,actor);return c;
}
export async function verifyChain(c){let previous='GENESIS';for(const e of c.events){const {hash,...body}=e;if(body.previous!==previous||await digest(body)!==hash)return false;previous=hash;}return true;}
export function publicState(data){return {...data,cases:data.cases.map(c=>({...c,pending:c.pending?{username:c.pending.username,role:c.pending.role,expiresAt:c.pending.expiresAt}:null}))};}
