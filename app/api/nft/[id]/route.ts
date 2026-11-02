import {nftMetadata} from '../../../../lib/chain-server';
export const dynamic='force-dynamic';
// tokenURI target for DiplomaNFT. Contains no personal data.
export async function GET(req:Request){
 const id=new URL(req.url).pathname.split('/').pop()||'';
 const headers={'Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*'};
 if(!/^[0-9]{1,30}$/.test(id))return Response.json({error:'Geçersiz token.'},{status:400,headers});
 try{const meta=await nftMetadata(id);return meta?Response.json(meta,{headers}):Response.json({error:'Kayıt bulunamadı.'},{status:404,headers});}
 catch{return Response.json({error:'Kayıt okunamadı.'},{status:400,headers});}
}
