export const roles = [
 {id:'registrar',label:'Öğrenci işleri',name:'Öğrenci işleri yetkilisi',unit:'Öğrenci işleri',initials:'Öİ'},
 {id:'faculty',label:'Fakülte yetkilisi',name:'Fakülte yetkilisi',unit:'Fakülte',initials:'FK'},
 {id:'rector',label:'Rektörlük yetkilisi',name:'Rektörlük yetkilisi',unit:'Rektörlük',initials:'RK'},
 {id:'central',label:'Merkezi doğrulama',name:'Merkez yetkilisi',unit:'Temsili merkez',initials:'MR'},
];
export const stages=['registrar','faculty','rector','central'];
export const statusLabels={draft:'Öğrenci işleri',correction:'Düzeltme bekliyor',faculty:'Fakülte onayı',rector:'Rektörlük onayı',central:'Merkezi doğrulama',ready:'Onaylar tamamlandı',issued:'Diploma VC’si düzenlendi',rejected:'Eski sürüm: reddedildi',revoked:'İptal edildi'};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function currentVersion(c){return c.versions.at(-1);}
export async function event(c,role,action,from,to,note='',actor='system'){
 const r=roles.find(x=>x.id===role);const previous=c.events.at(-1)?.hash||'GENESIS';
 const e={id:crypto.randomUUID(),at:new Date().toISOString(),actor,person:actor,role:r?.label||'Sistem',unit:r?.unit||'Merkez',action,from,to,note,version:currentVersion(c).number,documentHash:currentVersion(c).hash,previous,source:'Web paneli / V3 VC onayı'};
 e.hash=await digest(e);c.events.push(e);return e;
}
export const PROTOCOL=3;
// Protocol 3: unit approvals are W3C VC presentations signed in the approver's browser wallet.
// Protocol 2 (server-held test signatures) is kept read-only for already issued legacy records.
export async function makeCase(name,student,notes,role='registrar',actor='system',fields={}){
 const content={name,student,program:fields.program||'',university:fields.university||'',faculty:fields.faculty||'',notes,transcript:fields.transcript||null};
 const c={id:'DZ-'+crypto.randomUUID().slice(0,8).toUpperCase(),protocol:PROTOCOL,status:'draft',created:new Date().toISOString(),versions:[{number:1,content,hash:await digest(content)}],events:[],approvals:[],credential:null,pending:null};
 await event(c,role,'Dosya oluşturuldu','—','draft','',actor);return c;
}
export async function initialState(){return {role:'registrar',cases:[]};}
export async function migrateState(data){
 let changed=false;
 for(const c of data.cases){
  if(c.protocol===PROTOCOL)continue;
  if(!c.protocol){changed=true;
   if(['issued','revoked','rejected'].includes(c.status)){c.protocol=1;continue;}
   const from=c.status;c.protocol=PROTOCOL;c.pending=null;c.status='draft';
   await event(c,'registrar','VC sürecine geçiş',from,'draft','Eski kayıtlar korundu. PDF ve öğrenci bilgileri tamamlandıktan sonra dört VC onayı alınacak.');continue;
  }
  // Unfinished V2 files move to VC approvals; their server-held signatures stay in history but no longer count.
  if(c.protocol===2&&!['issued','revoked','rejected','ready'].includes(c.status)){changed=true;
   const from=c.status;c.protocol=PROTOCOL;c.pending=null;c.notification=null;c.status='draft';
   await event(c,'registrar','VC sürecine geçiş',from,'draft','Sunucu anahtarlı test imzaları geçmişte korundu; geçerli sayılmaz. Dört birimin VC ile yeniden onaylaması gerekir.');
  }
 }return changed;
}
export function canAct(c,role,action){
 if(c.protocol!==PROTOCOL){
  if(c.protocol===2&&action==='issue')return role==='central'&&c.status==='ready';
  return action==='revoke'&&role==='central'&&c.status==='issued';
 }
 if(action==='request-signature')return (role==='registrar'&&c.status==='draft')||(role===c.status&&stages.includes(role));
 if(action==='revise')return role==='registrar'&&['draft','correction'].includes(c.status);
 if(action==='correct')return role===c.status&&['faculty','rector','central'].includes(role);
 if(action==='issue')return role==='central'&&c.status==='ready';
 if(action==='revoke')return role==='central'&&c.status==='issued';
 return false;
}
export function hasApproval(c,role,v=currentVersion(c)){return c.approvals.some(a=>a.role===role&&a.version===v.number&&a.hash===v.hash&&(c.protocol===PROTOCOL?!!a.presentation:!!a.proof));}
export function assertReady(c){const v=currentVersion(c);if(!v.content.transcript||!['program','faculty','university'].every(k=>v.content[k]?.trim()))throw Error('Öğrenci bilgilerini tamamlayın ve PDF transkript yükleyin.');}
// Values a unit approval must commit to. The browser wallet signs exactly these.
export function approvalClaims(c,role){const v=currentVersion(c);return {caseId:c.id,version:v.number,documentHash:v.hash,transcriptHash:v.content.transcript.hash,role};}
// `approval` comes from verifyApprovalPresentation (already cryptographically checked by the caller).
export async function completeSignature(c,user,approval){
 if(c.protocol!==PROTOCOL||!canAct(c,user.role,'request-signature'))throw Error('İşlem sırası bu hesapta değil.');
 assertReady(c);const v=currentVersion(c),index=stages.indexOf(user.role);
 if(await digest(v.content)!==v.hash||!approval?.presentation||!approval.holder)throw Error('Onay sunumu belge veya hesapla eşleşmiyor.');
 if(!stages.slice(0,index).every(r=>hasApproval(c,r,v)))throw Error('Önceki onaylar eksik.');
 const from=c.status;
 c.approvals.push({role:user.role,username:user.username,version:v.number,hash:v.hash,at:approval.at,type:'VC_PRESENTATION',holder:approval.holder,approverCredentialId:approval.approverCredentialId,approvalCredentialId:approval.approvalCredentialId,presentationDigest:approval.presentationDigest,nonce:approval.nonce,presentation:approval.presentation});
 c.pending=null;c.notification=null;c.status=stages[index+1]||'ready';
 await event(c,user.role,'VC onayı doğrulandı',from,c.status,'Onay beyanı yetkilinin tarayıcı cüzdanında imzalandı; Yetkili Onaycı VC’si doğrulandı. Nitelikli e-imza değildir.',user.username);
 if(c.status!=='ready')c.notification={id:crypto.randomUUID(),role:c.status,fromRole:user.role,status:'pending',attemptAt:0};
}
export async function changeCase(c,role,action,input={},actor='system'){
 if(!canAct(c,role,action)||action==='request-signature')throw Error('Bu işlem için yetkiniz yok veya önceki onaylar tamamlanmadı.');
 const from=c.status;const note=String(input.note||'').trim();
 if(['correct','revoke','revise'].includes(action)&&(note.length<5||note.length>3000))throw Error('5–3000 karakter arasında açıklama yazın.');
 let label='';
 if(action==='correct'){c.status='correction';c.pending=null;label='Düzeltme istendi';}
 if(action==='revise'){const v=currentVersion(c);const content={...v.content,...input.fields,notes:note};c.versions.push({number:v.number+1,content,hash:await digest(content)});c.status='draft';c.pending=null;label='Yeni sürüm oluşturuldu';}
 if(action==='issue'){
  const v=currentVersion(c);if(!stages.every(r=>hasApproval(c,r,v)))throw Error('Dört onay tamamlanmadı.');
  if(c.protocol===PROTOCOL){
   const d=input.diploma;if(!d?.code||!d.id||!d.jwt)throw Error('Diploma VC’si düzenlenemedi.');
   c.credential={code:d.code,at:new Date().toISOString(),hash:v.hash,version:v.number,vcId:d.id,vc:d.jwt,network:null,token:null};label='Diploma VC’si düzenlendi';
  }else{c.credential={code:newDiplomaCode(),at:new Date().toISOString(),hash:v.hash,version:v.number,network:null,token:null};label='Test doğrulama kaydı oluşturuldu';}
  c.status='issued';
 }
 if(action==='revoke'){c.status='revoked';label=c.protocol===PROTOCOL?'Diploma VC’si iptal edildi':'Test belgesi iptal edildi';}
 await event(c,role,label,from,c.status,note,actor);return c;
}
export function newDiplomaCode(){return 'TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase();}
export async function verifyChain(c){let previous='GENESIS';for(const e of c.events){const {hash,...body}=e;if(body.previous!==previous||await digest(body)!==hash)return false;previous=hash;}return true;}
export function publicState(data){return {...data,cases:data.cases.map(c=>({...c,pending:c.pending?{username:c.pending.username,role:c.pending.role,expiresAt:c.pending.expiresAt,holder:c.pending.holder}:null}))};}
// An e-mailed invitation is bound to account, role, document version, stage and time.
export function challengeMatches(pending,c,user,tokenHash,now=Date.now()) {
 const v=c.versions.at(-1);
 return !!pending && pending.tokenHash===tokenHash && pending.username===user.username && pending.role===user.role && pending.version===v.number && pending.hash===v.hash && pending.expiresAt>now && pending.stage===c.status;
}
