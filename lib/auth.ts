import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {hashToken,readSessionCookie} from './auth-crypto.mjs';
export type Account={username:string;role:string;salt:string;hash:string};
export function getAccounts():Account[]{try{return JSON.parse(env.TEST_ACCOUNTS_JSON||'[]');}catch{return [];}}
export async function getAppUser(){
 const h=await headers();const token=readSessionCookie(h.get('cookie'));if(!token)return null;
 const row=await env.DB!.prepare('SELECT username,expires_at FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hashToken(token),Date.now()).first<{username:string,expires_at:number}>();
 if(!row)return null;const account=getAccounts().find(a=>a.username===row.username);return account?{username:account.username,role:account.role}:null;
}
