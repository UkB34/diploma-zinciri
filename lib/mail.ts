import {env} from 'cloudflare:workers';
import {roles} from './workflow.mjs';
export function signatureConfig(user:{username:string,role:string}){
 let keys:any,emails:any;try{keys=JSON.parse(env.SIGNING_KEYS_JSON||'{}');emails=JSON.parse(env.ROLE_EMAILS_JSON||'{}');}catch{throw Error('İmza veya e-posta yapılandırması geçersiz.');}
 const email=emails[user.username];
 if(!keys[user.role]?.privateKey||!email||!env.BREVO_API_KEY||!env.MAIL_FROM||!env.APP_ORIGIN)throw Error('İmza ve e-posta kurulumu tamamlanmadı. Yönetici dört hesap adresini, test anahtarlarını ve gönderim servisini tanımlamalı.');
 const origin=new URL(env.APP_ORIGIN);if(origin.protocol!=='https:'||origin.pathname!=='/')throw Error('APP_ORIGIN geçerli bir HTTPS site adresi olmalı.');
 return {keys:keys[user.role],email,origin:origin.origin};
}
export async function sendInvitation(user:{username:string,role:string},caseId:string,token:string,requestId:string){
 const config=signatureConfig(user);
 const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY!,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({sender:{name:"Diploma Zinciri",email:env.MAIL_FROM},to:[{email:config.email}],subject:'Diploma Zinciri — test imzalama daveti',textContent:`${roles.find(r=>r.id===user.role)?.label}\n\n${caseId} dosyası için test dijital imzanız bekleniyor.\nHesap: ${user.username}\n\n${config.origin}/imzala#token=${token}\n\nBağlantı 20 dakika geçerlidir. Aynı hesapla giriş yaptıktan sonra belgeyi inceleyip imzalamayı ayrıca onaylayın. Bağlantıyı açmak tek başına imza atmaz.\nBu işlem sunucuda tutulan test anahtarı kullanır; nitelikli elektronik imza değildir.`})});
 if(!response.ok)throw Error('E-posta servisi gönderimi kabul etmedi. Gönderici adresi ve alıcı izinlerini kontrol edin. Dosya ilerletilmedi.');
}
