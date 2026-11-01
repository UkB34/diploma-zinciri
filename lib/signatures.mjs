// Legacy V2 (protocol 2) server-held test signatures. Kept only to re-verify diplomas issued before the VC migration.
const encoder = new TextEncoder();
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export async function keyId(publicKey) {
 const canonical = JSON.stringify({crv:publicKey.crv,kty:publicKey.kty,x:publicKey.x,y:publicKey.y});
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonical))), b=>b.toString(16).padStart(2,'0')).join('');
}
// Test helpers only: produce legacy records in tests.
export async function generateSigningKey() {
 const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 return {privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey,keyId:await keyId(publicKey)};
}
export async function signApproval(payload, keys) {
 const key=await crypto.subtle.importKey('jwk',keys.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const body=JSON.stringify(payload);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(body));
 return {payload,body,signature:encode(signature),publicKey:keys.publicKey,keyId:await keyId(keys.publicKey),algorithm:'ECDSA-P256-SHA256',type:'SERVER_HELD_TEST_SIGNATURE'};
}
export async function verifyApproval(proof, trustedPublicKey=proof?.publicKey) {
 try {
 if(proof.type!=='SERVER_HELD_TEST_SIGNATURE'||proof.algorithm!=='ECDSA-P256-SHA256'||JSON.stringify(proof.payload)!==proof.body)return false;
 if(await keyId(trustedPublicKey)!==proof.keyId||await keyId(proof.publicKey)!==proof.keyId)return false;
 const key=await crypto.subtle.importKey('jwk',trustedPublicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode(proof.signature),encoder.encode(proof.body));
 }catch{return false;}
}
