import {nftImage} from '../../../../lib/chain-server';
export const dynamic='force-dynamic';
// Badge image referenced by the NFT metadata (image field). Contains no personal data.
export async function GET(req:Request){
 const id=(new URL(req.url).pathname.split('/').pop()||'').replace(/\.svg$/,'');
 if(!/^[0-9]{1,30}$/.test(id))return new Response('Geçersiz token.',{status:400});
 try{const svg=await nftImage(id);if(!svg)return new Response('Kayıt bulunamadı.',{status:404});
  return new Response(svg,{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});}
 catch{return new Response('Görsel üretilemedi.',{status:400});}
}
