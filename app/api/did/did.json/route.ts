import {appOrigin,universityKey} from '../../../../lib/credentials';
import {didDocument} from '../../../../lib/vc.mjs';
export const dynamic='force-dynamic';
// did:web:<host>:api:did resolves here. Public: any verifier may fetch the university's public key.
export async function GET(){
 const headers={'Content-Type':'application/did+json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'};
 try{return new Response(JSON.stringify(await didDocument(appOrigin(),(await universityKey()).publicJwk),null,2),{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'DID belgesi hazır değil.'},{status:503,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});}
}
