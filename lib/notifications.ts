import {readState} from './shared-state';
import {saveState} from './server-utils';
import {sendStageNotification} from './mail';
// Claim before sending: duplicate sign/retry requests cannot send the same notification concurrently.
export async function deliverNotification(caseId:string){
 const s=await readState();const c=s.data.cases.find((x:any)=>x.id===caseId),n=c?.notification;
 if(!n||c.status!==n.role||n.status==='sent')return {status:'not-needed'};
 if(n.attemptAt&&Date.now()-n.attemptAt<60000)return {status:n.status};
 n.status='sending';n.attemptAt=Date.now();const attempt=n.attemptAt,id=n.id;
 if(!await saveState(s.data,s.revision))return {status:'pending'};
 let status='sent';try{await sendStageNotification(c);}catch{status='failed';}
 // Merge delivery result into the newest workspace without overwriting other cases or signatures.
 for(let i=0;i<3;i++){
  const fresh=await readState();const current=fresh.data.cases.find((x:any)=>x.id===caseId);
  if(current?.notification?.id!==id||current.notification.attemptAt!==attempt)break;
  current.notification.status=status;
  if(await saveState(fresh.data,fresh.revision))return {status};
 }
 return {status:status==='sent'?'unknown':'failed'};
}
