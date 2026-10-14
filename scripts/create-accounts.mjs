import {readFile,writeFile} from 'node:fs/promises';
import {passwordHash,randomToken} from '../lib/auth-crypto.mjs';
// Input: a local JSON array of {username,role,password}. Never commit this file.
const path=process.argv[2];
if(!path)throw new Error('Kullanım: pnpm accounts accounts.local.json');
const rows=JSON.parse(await readFile(path,'utf8'));
const roles=['registrar','department','faculty','rector','central'];
const seen=new Set();
const accounts=[];
for(const a of rows){
 if(!/^[a-z0-9_]{3,60}$/.test(a.username)||seen.has(a.username)||!roles.includes(a.role)||typeof a.password!=='string'||a.password.length<12||a.password.length>128)throw new Error('Geçersiz veya yinelenen hesap. Şifre 12–128 karakter olmalı.');
 seen.add(a.username);const salt=randomToken();accounts.push({username:a.username,role:a.role,salt,hash:await passwordHash(a.password,salt)});
}
if(accounts.length!==5||new Set(accounts.map(a=>a.role)).size!==5)throw new Error('Her rol için bir hesap gerekli.');
await writeFile('.dev.vars',`TEST_ACCOUNTS_JSON='${JSON.stringify(accounts)}'\n`,{mode:0o600});
console.log('Hesap özetleri .dev.vars içine kaydedildi. Bu dosyayı GitHub’a yüklemeyin.');
