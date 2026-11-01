import {env} from 'cloudflare:workers';
import {roles} from './workflow.mjs';
import {appOrigin} from './credentials';
const usernames:Record<string,string>={registrar:'ogrenci_isleri',faculty:'fakulte',rector:'rektorluk',central:'merkez'};
function roleEmails():Record<string,string>{try{return JSON.parse(env.ROLE_EMAILS_JSON||'{}');}catch{throw Error('E-posta yapılandırması (ROLE_EMAILS_JSON) geçersiz.');}}
export function mailConfig(username:string){
 const email=roleEmails()[username];
 if(!email||!env.BREVO_API_KEY||!env.MAIL_FROM)throw Error('E-posta kurulumu tamamlanmadı. Yönetici hesap adreslerini ve gönderim servisini tanımlamalı.');
 return {email,origin:appOrigin()};
}
async function brevoSend(to:string,subject:string,textContent:string,failure:string){
 const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY!,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({sender:{name:'Diploma Zinciri',email:env.MAIL_FROM},to:[{email:to}],subject,textContent})});
 if(!response.ok)throw Error(failure);
}
export async function sendInvitation(user:{username:string,role:string},caseId:string,token:string){
 const config=mailConfig(user.username);
 await brevoSend(config.email,'Diploma Zinciri — VC onay daveti',`${roles.find(r=>r.id===user.role)?.label}\n\n${caseId} dosyası için Doğrulanabilir Kimlik Bilgisi (VC) ile onayınız bekleniyor.\nHesap: ${user.username}\n\n${config.origin}/imzala#token=${token}\n\nBağlantı 20 dakika geçerlidir. Dijital kimliğinizi kaydettiğiniz tarayıcıda, aynı hesapla açın. Belgeyi inceleyip onayı ayrıca verin; onay beyanı tarayıcınızdaki anahtarla imzalanır, anahtar sunucuya gönderilmez. Bağlantıyı açmak tek başına onay vermez.\nDiploma Zinciri — test prototipi; nitelikli elektronik imza değildir.`,'E-posta servisi gönderimi kabul etmedi. Gönderici adresi ve alıcı izinlerini kontrol edin. Dosya ilerletilmedi.');
}
export async function sendStageNotification(c:any){
 const n=c.notification;const config=mailConfig(usernames[n.role]);
 const from=roles.find(r=>r.id===n.fromRole)?.unit,to=roles.find(r=>r.id===n.role)?.unit;
 await brevoSend(config.email,'Diploma Zinciri — incelemenizi bekleyen dosya',`${to} birimine,\n\n${c.id} dosyası ${from} tarafından Doğrulanabilir Kimlik Bilgisi (VC) ile onaylandı. Dosya şimdi sizin incelemenizi bekliyor.\n\n${config.origin}/?case=${encodeURIComponent(c.id)}\n\nKendi hesabınızla giriş yapın, dosyayı inceleyin ve panelden kendi onay davetinizi isteyin. Bu bildirim onay yetkisi veya onay bağlantısı içermez.\nDiploma Zinciri — test prototipi.`,'Bildirim servisi isteği kabul etmedi.');
}
export async function sendWalletNotice(user:{username:string,role:string},holder:string){
 const config=mailConfig(user.username);
 await brevoSend(config.email,'Diploma Zinciri — dijital kimliğiniz yeni bir tarayıcıya bağlandı',`${roles.find(r=>r.id===user.role)?.label}\n\n${user.username} hesabı için yeni bir Yetkili Onaycı VC’si düzenlendi ve bir tarayıcı cüzdanına bağlandı. Önceki kimlik bilgisi varsa iptal edildi.\n\nYeni dijital kimlik (DID):\n${holder}\n\nBu işlemi siz yapmadıysanız hesap şifrenizi hemen değiştirin ve yöneticinize bildirin.\nDiploma Zinciri — test prototipi.`,'Kimlik bildirimi gönderilemedi.');
}
