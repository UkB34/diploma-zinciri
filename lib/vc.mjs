const enc=new TextEncoder();
const VC_CONTEXT='https://www.w3.org/ns/credentials/v2';
const APPROVAL_TYPE='DiplomaApprovalCredential';
const DIPLOMA_TYPE='DiplomaCredential';
const toB64Url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const fromB64Url=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const jsonPart=value=>toB64Url(enc.encode(JSON.stringify(value)));
const parsePart=value=>JSON.parse(new TextDecoder().decode(fromB64Url(value)));
export async function createVcJwt(credential,keys,keyId){
 const header={alg:'ES256',typ:'vc+jwt',cty:'vc',kid:keyId};
 const signingInput=jsonPart(header)+'.'+jsonPart(credential);
 const key=await crypto.subtle.importKey('jwk',keys.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(signingInput));
 return signingInput+'.'+toB64Url(signature);
}
export async function verifyVcJwt(jwt,publicKey,expectedIssuer,expectedKeyId){
 try{
  if(typeof jwt!=='string'||jwt.length>200000)return {verified:false,error:'VC-JWT biçimi geçersiz.'};
  const parts=jwt.split('.');if(parts.length!==3)return {verified:false,error:'VC-JWT üç bölüm içermeli.'};
  const header=parsePart(parts[0]),credential=parsePart(parts[1]);
  if(header.alg!=='ES256'||header.typ!=='vc+jwt'||header.cty!=='vc'||header.kid!==expectedKeyId)return {verified:false,error:'VC-JWT başlığı veya anahtar kimliği beklenen değerle eşleşmiyor.'};
  if(credential.issuer!==expectedIssuer||!Array.isArray(credential['@context'])||!credential['@context'].includes(VC_CONTEXT)||!Array.isArray(credential.type)||!credential.type.includes('VerifiableCredential'))return {verified:false,error:'VC düzenleyeni veya veri modeli beklenen değerle eşleşmiyor.'};
  const key=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64Url(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
  return {verified:ok,credential,error:ok?undefined:'VC-JWT imzası doğrulanamadı.'};
 }catch{return {verified:false,error:'VC-JWT doğrulanamadı.'};}
}
export function approvalCredential({origin,role,username,caseId,version,documentHash,transcriptHash,requestId,approvedAt}){
 const issuer=origin+'/issuers/'+role;
 const terms=origin+'/terms#';
 return {credential:{
  '@context':[VC_CONTEXT,{'@vocab':terms}],
  id:origin+'/credentials/'+encodeURIComponent(requestId),
  type:['VerifiableCredential',APPROVAL_TYPE],
  issuer,
  validFrom:approvedAt,
  credentialSubject:{
   id:'urn:diploma-zinciri:case:'+encodeURIComponent(caseId),
   type:'DiplomaApproval',
   caseId,version,documentHash,transcriptHash,
   approver:{id:'urn:diploma-zinciri:account:'+encodeURIComponent(username),role},
   approvalRequestId:requestId,
   approvedAt
  }
 },issuer};
}
export function diplomaCredential({origin,caseRecord,version,approvedAt}){
 const issuer=origin+'/issuers/central';
 return {credential:{
  '@context':[VC_CONTEXT,{'@vocab':origin+'/terms#'}],
  id:origin+'/credentials/'+encodeURIComponent(caseRecord.id)+'/'+version.number,
  type:['VerifiableCredential',DIPLOMA_TYPE],
  issuer,
  validFrom:approvedAt,
  credentialSubject:{
   id:'urn:diploma-zinciri:student:'+encodeURIComponent(version.content.student),
   type:'Diploma',
   caseId:caseRecord.id,
   studentName:version.content.name,
   studentNumber:version.content.student,
   university:version.content.university,
   faculty:version.content.faculty,
   program:version.content.program,
   version:version.number,
   documentHash:version.hash,
   transcriptHash:version.content.transcript.hash,
   approvalCredentialIds:caseRecord.approvals.map(a=>a.proof.payload.id)
  }
 },issuer};
}
