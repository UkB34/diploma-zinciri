import {writeFile} from 'node:fs/promises';
import {generateSigningKey} from '../lib/signatures.mjs';
const roles=['registrar','faculty','rector','central'];
const keys=Object.fromEntries(await Promise.all(roles.map(async role=>[role,await generateSigningKey()])));
// Secrets stay local. Never print or commit private keys. wx refuses to overwrite keys.
await writeFile('signing-secrets.local.json',JSON.stringify({SIGNING_KEYS_JSON:JSON.stringify(keys)},null,2),{flag:'wx',mode:0o600});
console.log('Test anahtarları signing-secrets.local.json dosyasına kaydedildi. Bu dosyayı GitHub’a yüklemeyin. Mevcut anahtarları değiştirmeyin.');
