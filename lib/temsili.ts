import {env} from 'cloudflare:workers';
import {universityKey,appOrigin} from './credentials';
import {issueCredential,diplomaCredential,randomId,STATUS_LIST_SIZE} from './vc.mjs';
import {sha256Hex,vcHash} from './chain.mjs';
import {newDiplomaCode} from './workflow.mjs';

// Representative diplomas for the yearly NFT test. They are signed with the university key but NEVER stored:
// the D1 record limit cannot hold a year's worth of diplomas, so the files live on the user's own computer.
export const TEMSILI_MAX=1000,TEMSILI_BATCH=25;
export async function signTemsili(start:number,count:number){
 if(!Number.isInteger(start)||!Number.isInteger(count)||start<1||count<1||count>TEMSILI_BATCH||start+count-1>TEMSILI_MAX)throw Error(`Tek seferde 1–${TEMSILI_BATCH} temsili diploma imzalanabilir (en fazla ${TEMSILI_MAX}).`);
 const key=await universityKey(),origin=appOrigin(),out=[];
 for(let no=start;no<start+count;no++){
  const code=newDiplomaCode(),label=String(no).padStart(4,'0');
  const rand=(tag:string)=>sha256Hex(tag+':'+code+':'+randomId());
  const statusIndex=crypto.getRandomValues(new Uint32Array(1))[0]%STATUS_LIST_SIZE;
  const vc:any=diplomaCredential({id:randomId(),code,content:{name:'Temsili Diploma '+label,university:'Örnek Üniversite',faculty:'Temsili Fakülte',program:'Temsili Program',transcript:{hash:await rand('t')}},version:1,documentHash:await rand('d'),approvals:[],statusIndex,origin});
  vc.name='Temsili diploma (test prototipi)';vc.credentialSubject.representative=true;
  const jwt=await issueCredential(key,origin,vc);
  out.push({no,code,jwt,hash:await vcHash(jwt)});
 }
 return out;
}
// Hashes of the real (fully approved) diploma VCs, so they can sit in the same yearly list. No names leave the server.
export async function realDiplomaHashes(){
 const rows=(await env.DB!.prepare("SELECT jwt,revoked FROM credentials WHERE kind='diploma' ORDER BY created_at").all<{jwt:string,revoked:number}>()).results||[];
 return Promise.all(rows.map(async(r:{jwt:string,revoked:number})=>({hash:await vcHash(r.jwt),revoked:!!r.revoked})));
}
