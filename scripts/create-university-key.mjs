import {writeFile} from 'node:fs/promises';
import {generateUniversityKey,didDocument,universityDid} from '../lib/vc.mjs';
const origin=process.argv[2]||'https://diploma-zinciri.bllufuk04.workers.dev';
const key=await generateUniversityKey();
// Secret stays local. wx refuses to overwrite an existing key: replacing it invalidates every VC already issued.
await writeFile('university-secrets.local.json',JSON.stringify({UNIVERSITY_KEY_JSON:JSON.stringify(key)},null,2),{flag:'wx',mode:0o600});
const doc=await didDocument(origin,key.publicKey);
console.log('Üniversite anahtarı university-secrets.local.json dosyasına kaydedildi. GitHub’a yüklemeyin.');
console.log('DID:',universityDid(origin));console.log('Anahtar kimliği:',doc.verificationMethod[0].id);
console.log('Cloudflare’a yüklemek için: pnpm exec wrangler secret bulk university-secrets.local.json');
