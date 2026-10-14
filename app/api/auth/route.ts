import {env} from 'cloudflare:workers';
import {getAccounts,getAppUser} from '../../../lib/auth';
import {hashToken,passwordHash,timingEqual,randomToken,validOrigin,sessionCookie,readSessionCookie} from '../../../lib/auth-crypto.mjs';
export const dynamic='force-dynamic';
const json=(d:unknown,s=200,extra:Record<string,string>={})=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store',...extra}});
export async function GET(){const user=await getAppUser();return json(user?{user}:{error:'Giriş yapmanız gerekiyor.'},user?200:401);}
export async function POST(req:Request){
 if(!validOrigin(req))return json({error:'İstek kaynağı doğrulanamadı.'},403);
 let body:any;try{const raw=await req.text();if(raw.length>2000)return json({error:'İstek çok büyük.'},413);body=JSON.parse(raw);}catch{return json({error:'Geçersiz istek.'},400);}
 if(body.action==='logout'){const token=readSessionCookie(req.headers.get('cookie'));if(token)await env.DB!.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(token)).run();return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});}
 const accounts=getAccounts();if(!accounts.length)return json({error:'Test hesapları henüz yapılandırılmadı.'},503);
 const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');
 if(username.length>60||password.length>128)return json({error:'Kullanıcı adı veya şifre hatalı.'},401);
 const now=Date.now(),window=Math.floor(now/900000),key=await hashToken((req.headers.get('cf-connecting-ip')||'shared')+':'+window);
 const limit=await env.DB!.prepare('INSERT INTO login_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+900000).first<{attempts:number}>();
 if((limit?.attempts||0)>40)return json({error:'Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.'},429,{'Retry-After':'900'});
 const account=accounts.find(a=>a.username===username);const hash=await passwordHash(password,account?.salt||accounts[0].salt);
 if(!account||!timingEqual(hash,account.hash))return json({error:'Kullanıcı adı veya şifre hatalı.'},401);
 const old=readSessionCookie(req.headers.get('cookie'));if(old)await env.DB!.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(old)).run();
 const token=randomToken();await env.DB!.batch([
 env.DB!.prepare('INSERT INTO sessions (token_hash,username,expires_at) VALUES (?,?,?)').bind(await hashToken(token),account.username,now+28800000),
 env.DB!.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
 env.DB!.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(now),
 ]);
 return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
}
