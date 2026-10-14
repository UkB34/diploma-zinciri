export const roles = [
 {id:'registrar',label:'Öğrenci işleri',name:'Deniz Yılmaz',unit:'Merkez',initials:'DY'},
 {id:'department',label:'Bölüm yetkilisi',name:'Ece Demir',unit:'Endüstri Mühendisliği',initials:'ED'},
 {id:'faculty',label:'Fakülte yetkilisi',name:'Mert Kaya',unit:'Mühendislik Fakültesi',initials:'MK'},
 {id:'rector',label:'Rektörlük yetkilisi',name:'Selin Aras',unit:'Rektörlük',initials:'SA'},
 {id:'central',label:'Merkezi doğrulama',name:'Can Aksoy',unit:'Temsili merkez',initials:'CA'},
];
export const stages=['department','faculty','rector','central'];
export const statusLabels={draft:'Taslak',correction:'Düzeltme bekliyor',department:'Bölüm onayı',faculty:'Fakülte onayı',rector:'Rektörlük onayı',central:'Merkezi doğrulama',ready:'NFT için hazır',issued:'Test belgesi oluşturuldu',rejected:'Reddedildi',revoked:'İptal edildi'};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function currentVersion(c){return c.versions[c.versions.length-1];}
export async function event(c,role,action,from,to,note='',actor='demo-owner'){
 const r=roles.find(x=>x.id===role);const previous=c.events.at(-1)?.hash||'GENESIS';
 const e={id:crypto.randomUUID(),at:new Date().toISOString(),actor,person:r?.name||'Sistem',role:r?.label||'Sistem',unit:r?.unit||'Merkez',action,from,to,note,version:currentVersion(c).number,documentHash:currentVersion(c).hash,previous,source:'Web paneli / toplantı test hesabı'};
 e.hash=await digest(e);c.events.push(e);return e;
}
export async function makeCase(name,student,notes,role='registrar',actor='demo-owner'){
 const content={name,student,program:'Endüstri Mühendisliği',university:'Örnek Üniversite',faculty:'Mühendislik Fakültesi',notes};
 const c={id:'DZ-'+crypto.randomUUID().slice(0,8).toUpperCase(),status:'draft',created:new Date().toISOString(),versions:[{number:1,content,hash:await digest(content)}],events:[],approvals:[],credential:null};
 await event(c,role,'Dosya oluşturuldu','—','draft','Temsili mezuniyet verisi',actor);return c;
}
export async function initialState(){
 const cases=[];for(const [name,student,steps] of [['Ada Yıldız','20220041',0],['Emir Aydın','20220058',1],['Duru Erdem','20220073',2]]){
 const c=await makeCase(name,student,'Temsili transkript: 240 AKTS. Zorunlu dersler ve staj tamamlandı. Gerçek akademik kayıt değildir.');
 await changeCase(c,'registrar','submit');for(let i=0;i<steps;i++)await changeCase(c,stages[i],'approve');cases.push(c);
 }return {role:'registrar',cases};
}
export function canAct(c,role,action){
 if(action==='submit')return role==='registrar'&&c.status==='draft';
 if(action==='revise')return role==='registrar'&&c.status==='correction';
 if(['approve','correct','reject'].includes(action))return stages.includes(c.status)&&role===c.status;
 if(action==='issue')return role==='central'&&c.status==='ready';
 if(action==='revoke')return role==='central'&&c.status==='issued';
 return false;
}
export async function changeCase(c,role,action,input={},actor='demo-owner'){
 if(!canAct(c,role,action))throw new Error('Bu işlem için yetkiniz yok veya önceki onaylar tamamlanmadı.');
 const from=c.status;let note=String(input.note||'').trim();
 if(['correct','reject','revoke','revise'].includes(action)&&note.length<5)throw new Error('En az 5 karakterlik bir gerekçe yazın.');
 if(note.length>3000)throw new Error('Açıklama çok uzun.');
 let label='';
 if(action==='submit'){c.status='department';label='İncelemeye gönderildi';}
 if(action==='approve'){
 const v=currentVersion(c);const index=stages.indexOf(role);
 if(!stages.slice(0,index).every(r=>c.approvals.some(a=>a.role===r&&a.version===v.number&&a.hash===v.hash)))throw new Error('Önceki aşamaların aynı sürümdeki onayları eksik.');
 c.approvals.push({role,version:v.number,hash:v.hash,at:new Date().toISOString(),type:'TEST_ONAYI'});
 c.status=stages[index+1]||'ready';label='Test onayı verildi';note='Temsili onay kaydı; nitelikli elektronik imza değildir.';
 }
 if(action==='correct'){c.status='correction';label='Düzeltme istendi';}
 if(action==='reject'){c.status='rejected';label='Dosya reddedildi';}
 if(action==='revise'){
 const v=currentVersion(c);const content={...v.content,notes:note};c.versions.push({number:v.number+1,content,hash:await digest(content)});c.status='department';label='Yeni sürüm incelemeye gönderildi';
 }
 if(action==='issue'){c.status='issued';c.credential={code:'TEST-'+crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),at:new Date().toISOString(),hash:currentVersion(c).hash,network:null,token:null};label='Test doğrulama kaydı oluşturuldu';note='Blokzincir işlemi yapılmadı. NFT bağlantısı sonraki aşamada eklenecek.';}
 if(action==='revoke'){c.status='revoked';label='Test belgesi iptal edildi';}
 await event(c,role,label,from,c.status,note,actor);return c;
}
export async function verifyChain(c){let previous='GENESIS';for(const e of c.events){const {hash,...body}=e;if(body.previous!==previous||await digest(body)!==hash)return false;previous=hash;}return true;}
