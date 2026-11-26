import {env} from 'cloudflare:workers';
import {decodeJwt} from './vc.mjs';
import {vcHash} from './solana.mjs';

// Issued diploma credentials grouped for the "Mezunlar" page. Only central staff receive the credential files,
// because they are the input of the local minting tool (tools/solana/diploma_nft.py).
export async function listGraduates(includeJwt:boolean){
 const rows=(await env.DB!.prepare("SELECT subject,jwt,revoked,created_at FROM credentials WHERE kind='diploma' ORDER BY created_at DESC").all<{subject:string,jwt:string,revoked:number,created_at:number}>()).results||[];
 const out=[];
 for(const r of rows){
  let vc:any;try{vc=decodeJwt(r.jwt).payload;}catch{continue;}
  const s=vc.credentialSubject||{},d=s.diploma||{},issued=vc.validFrom||new Date(r.created_at).toISOString();
  out.push({code:r.subject,name:String(s.name||''),program:String(d.program||''),faculty:String(d.faculty||''),issuedAt:issued,year:new Date(issued).getUTCFullYear(),
   revoked:!!r.revoked,hash:await vcHash(r.jwt),...(includeJwt?{jwt:r.jwt}:{})});
 }
 return out;
}
