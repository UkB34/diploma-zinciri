import {digest,stages} from './workflow.mjs';
import {verifyApproval} from './signatures.mjs';
export async function publicDiploma(c){
 if(!c?.credential||!['issued','revoked'].includes(c.status))return null;
 const v=c.versions.find(v=>v.hash===c.credential.hash&&(!c.credential.version||v.number===c.credential.version));
 if(!v||await digest(v.content)!==v.hash)return null;
 const approvals=c.approvals.filter(a=>a.version===v.number&&a.hash===v.hash);
 const verified=c.protocol===2&&await Promise.all(stages.map(async role=>{
 const a=approvals.find(a=>a.role===role&&a.proof);const p=a?.proof?.payload;
 return !!p&&p.caseId===c.id&&p.version===v.number&&p.documentHash===v.hash&&p.transcriptHash===v.content.transcript?.hash&&p.role===role&&p.username===a.username&&p.purpose==='diploma-approval-v2'&&await verifyApproval(a.proof);
 })).then(results=>results.every(Boolean));
 if(c.protocol===2&&!verified)return null;
 return {name:v.content.name,university:v.content.university,faculty:v.content.faculty,program:v.content.program,version:v.number,status:c.status,created:c.credential.at,code:c.credential.code,nft:false,diplomaAvailable:!!verified,approvals:verified?stages.map(role=>({role,at:approvals.find(a=>a.role===role).at})):[]};
}
