import {env} from 'cloudflare:workers';
import {roles} from '../../../../lib/workflow.mjs';
import {keyId} from '../../../../lib/signatures.mjs';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'public, max-age=300'};
 try{
  if(!env.APP_ORIGIN||!env.SIGNING_KEYS_JSON)throw Error();
  const keys=JSON.parse(env.SIGNING_KEYS_JSON);
  const issuers=await Promise.all(roles.map(async role=>{
   const publicKey=keys[role.id]?.publicKey;if(!publicKey)throw Error();
   const issuer=env.APP_ORIGIN!.replace(/\\/$/,'')+'/issuers/'+role.id;
   return {issuer,key:{kty:'EC',crv:'P-256',x:publicKey.x,y:publicKey.y,alg:'ES256',use:'sig',kid:issuer+'#'+await keyId(publicKey)}};
  }));
  return Response.json({type:'test-vc-issuer-keys',issuers},{headers});
 }catch{return Response.json({error:'VC issuer anahtarları yapılandırılmamış.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
