'use client';
// Browser wallet: the approver's P-256 private key is generated as non-extractable and kept in IndexedDB.
// It never leaves this browser; the server only ever sees the public key (did:jwk) and signed JWTs.
import {KEY_ALG,didJwk,publicJwk,enrollmentProof,createApprovalPresentation} from './vc.mjs';
const DB_NAME='diploma-zinciri-cuzdan',STORE='anahtarlar';
export type Wallet={privateKey:CryptoKey,publicJwk:any,did:string,createdAt:number};
function openDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(Error('Bu tarayıcı güvenli anahtar deposunu (IndexedDB) desteklemiyor.'));
  const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Anahtar deposu açılamadı. Gizli pencere kullanıyorsanız normal pencereye geçin.'));
 });
}
async function run<T>(mode:IDBTransactionMode,op:(s:IDBObjectStore)=>IDBRequest):Promise<T>{
 const db=await openDb();
 try{return await new Promise<T>((resolve,reject)=>{const t=db.transaction(STORE,mode);const r=op(t.objectStore(STORE));t.oncomplete=()=>resolve(r.result as T);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
 finally{db.close();}
}
export async function loadWallet(username:string):Promise<Wallet|null>{
 const w=await run<Wallet|undefined>('readonly',s=>s.get(username));
 return w&&w.privateKey&&w.did?w:null;
}
export async function createWallet(username:string):Promise<Wallet>{
 if(!globalThis.crypto?.subtle)throw Error('Tarayıcınız WebCrypto desteklemiyor. Güncel Chrome, Edge, Firefox veya Safari kullanın.');
 const pair=await crypto.subtle.generateKey(KEY_ALG,false,['sign','verify']) as CryptoKeyPair;
 const pub=publicJwk(await crypto.subtle.exportKey('jwk',pair.publicKey));
 const wallet:Wallet={privateKey:pair.privateKey,publicJwk:pub,did:didJwk(pub),createdAt:Date.now()};
 await run('readwrite',s=>s.put(wallet,username));
 return wallet;
}
async function post(url:string,body:any){
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d:any=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'İstek tamamlanamadı.');return d;
}
// Binds this browser's key to the account: the university issues an Authorized Approver VC to its DID.
export async function enrollThisBrowser(username:string){
 const wallet=(await loadWallet(username))||(await createWallet(username));
 const {nonce,audience}=await post('/api/wallet',{action:'challenge'});
 const proof=await enrollmentProof({privateKey:wallet.privateKey,did:wallet.did,nonce,audience,username});
 return post('/api/wallet',{action:'enroll',nonce,did:wallet.did,proof});
}
export async function signApproval(username:string,input:{approverJwt:string,holder:string,nonce:string,audience:string,approval:any}){
 const wallet=await loadWallet(username);
 if(!wallet)throw Error('Bu tarayıcıda dijital kimliğiniz yok. Panelde “Dijital kimliğim” bölümünden bu tarayıcıyı bağlayın, ardından yeni davet isteyin.');
 if(wallet.did!==input.holder)throw Error('Bu tarayıcıdaki dijital kimlik, davetin bağlı olduğu kimlikle eşleşmiyor. Kimliği kaydettiğiniz tarayıcıyı kullanın veya yeni davet isteyin.');
 return createApprovalPresentation({privateKey:wallet.privateKey,did:wallet.did,approverJwt:input.approverJwt,approval:input.approval,nonce:input.nonce,audience:input.audience});
}
