import {getAppUser} from '../../../lib/auth';
import {readState} from '../../../lib/shared-state';
import {validOrigin,randomToken,hashToken} from '../../../lib/auth-crypto.mjs';
import {makeCase,changeCase,event,verifyChain,currentVersion,canAct,assertReady,publicState} from '../../../lib/workflow.mjs';
import {json,limitedBody,saveState,transcriptFields} from '../../../lib/server-utils';
import {mailConfig,sendInvitation} from '../../../lib/mail';
import {activeApprover,universityKey,revokeCredential} from '../../../lib/credentials';
import {issueDiplomaVc} from '../../../lib/diploma';
import {deliverNotification} from '../../../lib/notifications';
export const dynamic='force-dynamic';
export async function GET(){const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);const s=await readState();return json({...publicState(s.data),...user,revision:s.revision});}
export async function POST(req:Request){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 let body:any;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(req,18000)));}catch{return json({error:'Geçersiz veya büyük istek.'},400);}
 const {data,revision}=await readState();if(body.revision!==revision)return json({error:'Dosya güncellendi. Yenileyip tekrar deneyin.'},409);
 if(body.role!==undefined||body.action==='role')return json({error:'Hesap yetkisi değiştirilemez.'},403);
 let issued:any=null,revoke:string|null=null;
 try{
 if(body.action==='create'){
 if(user.role!=='registrar')return json({error:'Dosyayı yalnızca öğrenci işleri oluşturabilir.'},403);
 const name=String(body.name||'').trim(),student=String(body.student||'').trim(),notes=String(body.note||'').trim();
 if(name.length<3||name.length>90||!/^\d{4,15}$/.test(student)||notes.length<5||notes.length>3000)throw Error('Öğrenci bilgilerini kontrol edin.');
 if(data.cases.some((c:any)=>currentVersion(c).content.student===student))throw Error('Bu öğrenci numarası zaten kayıtlı.');if(data.cases.length>=100)throw Error('Prototipte en fazla 100 dosya oluşturulabilir.');
 data.cases.unshift(await makeCase(name,student,notes,user.role,user.username,await transcriptFields(body,user)));
 }else{
 const c=data.cases.find((x:any)=>x.id===body.id);if(!c)return json({error:'Dosya bulunamadı.'},404);
 if(body.action==='retry-notification'){
 if(!c.notification||![c.notification.role,c.notification.fromRole].includes(user.role))return json({error:'Bu bildirim için yetkiniz yok.'},403);
 const delivery=await deliverNotification(c.id);const fresh=await readState();
 return json({...publicState(fresh.data),...user,revision:fresh.revision,message:delivery.status==='sent'?'Bildirim e-posta servisine iletildi.':'Bildirim henüz gönderilemedi. Bir dakika sonra tekrar deneyebilirsiniz.'});
 }
 if(body.action==='check')return json({valid:await verifyChain(c)});
 if(body.action==='request-signature'){
 if(!canAct(c,user.role,body.action))return json({error:'Onay sırası bu hesapta değil.'},403);assertReady(c);
 mailConfig(user.username);await universityKey();const now=Date.now();if(c.pending&&now-c.pending.createdAt<60000)return json({error:'Tekrar göndermek için bir dakika bekleyin. E-postanızı kontrol edin.'},429);
 const approver=await activeApprover(user.username);
 if(!approver)return json({error:'Önce panelde “Dijital kimliğim” bölümünden dijital kimliğinizi oluşturun. Onaylar, üniversitenin size verdiği Yetkili Onaycı VC’si ile yapılır.'},412);
 const token=randomToken(),requestId=crypto.randomUUID(),v=currentVersion(c);
 c.pending={requestId,tokenHash:await hashToken(token),username:user.username,role:user.role,version:v.number,hash:v.hash,stage:c.status,createdAt:now,expiresAt:now+1200000,challenge:randomToken(),holder:approver.holder,approverCredentialId:approver.id};
 await event(c,user.role,'VC onay daveti istendi',c.status,c.status,'Dosya henüz sonraki aşamaya geçmedi.',user.username);
 if(!await saveState(data,revision))return json({error:'Eşzamanlı işlem. Yenileyip deneyin.'},409);
 try{await sendInvitation(user,c.id,token);}catch(e){const fresh=await readState();const current=fresh.data.cases.find((x:any)=>x.id===c.id);if(current?.pending?.requestId===requestId){current.pending=null;await event(current,user.role,'E-posta gönderimi başarısız',current.status,current.status,'Yeni davet isteyebilirsiniz.',user.username);await saveState(fresh.data,fresh.revision);}return json({error:e instanceof Error?e.message:'E-posta gönderilemedi.'},502);}
 return json({...publicState(data),...user,revision:revision+1,message:'Onay daveti hesabınıza tanımlı e-posta adresine gönderildi. Bağlantıyı dijital kimliğinizin bulunduğu tarayıcıda açın.'});
 }
 if(!canAct(c,user.role,body.action))return json({error:'Bu işlem için yetkiniz yok.'},403);
 const fields=body.action==='revise'?await transcriptFields(body,user,currentVersion(c).content.transcript):undefined;
 if(body.action==='issue'&&c.protocol===3)issued=await issueDiplomaVc(c);
 await changeCase(c,user.role,body.action,{note:body.note,fields,diploma:issued},user.username);
 if(body.action==='revoke'&&c.credential?.vcId)revoke=c.credential.vcId;
 }
 if(!await saveState(data,revision)){if(issued)await revokeCredential(issued.id);return json({error:'Eşzamanlı işlem algılandı. Yenileyin.'},409);}
 // The status list is updated only after the record itself is saved as revoked.
 if(revoke)await revokeCredential(revoke);
 return json({...publicState(data),...user,revision:revision+1});
 }catch(e){if(issued)await revokeCredential(issued.id).catch(()=>{});return json({error:e instanceof Error?e.message:'İşlem tamamlanamadı.'},400);}
}
