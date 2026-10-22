import {readFile} from 'node:fs/promises';
import {verifyApproval} from '../lib/signatures.mjs';
import {digest,verifyChain} from '../lib/workflow.mjs';
if(!process.argv[2])throw Error('Kullanım: node scripts/verify-signatures.mjs dosya-islem-gecmisi.json');
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
let valid=await verifyChain(c);
for(const a of c.approvals.filter(a=>a.proof)){
 const v=c.versions.find(v=>v.number===a.version),p=a.proof.payload;
 const ok=!!v&&await digest(v.content)===v.hash&&a.hash===v.hash&&p.documentHash===v.hash&&p.transcriptHash===v.content.transcript?.hash&&p.caseId===c.id&&p.version===v.number&&p.username===a.username&&p.role===a.role&&p.purpose==='diploma-approval-v2'&&await verifyApproval(a.proof);
 console.log(`${a.role} / ${a.username} / v${a.version}: ${ok?'İmza tutarlı':'GEÇERSİZ'}`);valid=valid&&ok;
}
console.log('Kontrol, dışa aktarılan test açık anahtarlarına dayanır; resmî kimlik veya bağımsız zaman damgası doğrulaması değildir.');
if(!valid)process.exitCode=1;
