import {env} from 'cloudflare:workers';
import {CHAIN_ID,EXPLORER,DEFAULT_RPC,isAddress,isTxHash,strip0x,rpc,ethCall,sha256Hex,vcHash,tokenIdFromCode,codeFromTokenId,encodeMintBatch,encodeRevoke,encodeNftVerify,decodeNftVerify,hexToBigInt} from './chain.mjs';
import {appOrigin} from './credentials';
import {decodeJwt} from './vc.mjs';

// Diplomas are recorded on Sepolia as soulbound NFTs (DiplomaNFT). Only the SHA-256 of the diploma VC goes on chain.
type Item={code:string,hash:string};
export function chainConfig(){
 const nft=env.NFT_CONTRACT,issuer=env.CHAIN_ISSUER;
 if(!isAddress(nft)||!isAddress(issuer))throw Error('Blokzincir ayarları (sözleşme ve cüzdan adresleri) eksik.');
 return {chainId:CHAIN_ID,rpc:env.CHAIN_RPC||DEFAULT_RPC,nft:nft!,issuer:issuer!,explorer:EXPLORER};
}
const call=(method:string,params:any[])=>rpc(chainConfig().rpc,method,params);
const now=()=>Date.now();
async function insertBatch(action:'diploma'|'revoke',item:Item,data:string,user:string){
 const id=crypto.randomUUID();
 await env.DB!.prepare('INSERT INTO chain_batches (id,run_id,run_size,method,action,size,data_hash,payload,root,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,id,1,'nft',action,1,await sha256Hex(strip0x(data)),JSON.stringify([item]),null,'prepared',user,now()).run();
 return {batchId:id,to:chainConfig().nft,data,count:1};
}
// Registers one fully approved diploma (protocol 3, all four VC approvals) as an NFT.
export async function prepareDiploma(code:string,user:string){
 const cred=await env.DB!.prepare("SELECT jwt FROM credentials WHERE kind='diploma' AND subject=? AND revoked=0").bind(code).first<{jwt:string}>();
 if(!cred)throw Error('Bu kodla düzenlenmiş geçerli bir diploma VC’si yok.');
 if(await env.DB!.prepare("SELECT 1 FROM chain_records WHERE method='nft' AND code=?").bind(code).first())throw Error('Bu diploma zaten zincire kaydedilmiş.');
 const open=await env.DB!.prepare("SELECT payload FROM chain_batches WHERE method='nft' AND action='diploma' AND status IN ('prepared','submitted') AND created_at>?").bind(now()-1800000).all<{payload:string}>();
 if((open.results||[]).some((r:{payload:string})=>(JSON.parse(r.payload) as Item[]).some(i=>i.code===code)))throw Error('Bu diploma için bekleyen bir işlem var. Birkaç dakika sonra tekrar deneyin.');
 const hash=await vcHash(cred.jwt);
 return {transactions:[await insertBatch('diploma',{code,hash},encodeMintBatch([tokenIdFromCode(code)],[hash]),user)]};
}
export async function prepareRevoke(code:string,user:string){
 const rec=await env.DB!.prepare("SELECT vc_hash,revoked_batch FROM chain_records WHERE method='nft' AND code=?").bind(code).first<{vc_hash:string,revoked_batch:string|null}>();
 if(!rec)throw Error('Bu diploma zincire kaydedilmemiş.');
 if(rec.revoked_batch)throw Error('Bu diploma zincirde zaten iptal edilmiş.');
 return {transactions:[await insertBatch('revoke',{code,hash:rec.vc_hash},encodeRevoke(tokenIdFromCode(code)),user)]};
}
export async function submitBatch(batchId:string,txHash:string){
 if(!isTxHash(txHash))throw Error('Geçersiz işlem numarası.');
 const r=await env.DB!.prepare("UPDATE chain_batches SET status='submitted',tx_hash=?,submitted_at=? WHERE id=? AND status='prepared'").bind(txHash.toLowerCase(),now(),batchId).run();
 if(r.meta.changes!==1)throw Error('İşlem bulunamadı veya zaten gönderilmiş.');
}
export async function cancelBatch(batchId:string){
 await env.DB!.prepare("UPDATE chain_batches SET status='cancelled' WHERE id=? AND status='prepared'").bind(batchId).run();
}
// Reads the receipt from Sepolia; the stored record only counts if the mined tx matches the prepared calldata.
export async function confirmBatch(batchId:string){
 const b=await env.DB!.prepare('SELECT * FROM chain_batches WHERE id=?').bind(batchId).first<any>();
 if(!b)throw Error('İşlem bulunamadı.');
 if(b.status!=='submitted')return {status:b.status};
 const receipt=await call('eth_getTransactionReceipt',[b.tx_hash]);
 if(!receipt)return {status:'submitted'};
 const tx=await call('eth_getTransactionByHash',[b.tx_hash]);
 const block=await call('eth_getBlockByNumber',[receipt.blockNumber,false]);
 const matches=!!tx&&String(tx.to).toLowerCase()===chainConfig().nft.toLowerCase()&&await sha256Hex(strip0x(tx.input||''))===b.data_hash;
 const ok=matches&&receipt.status==='0x1';
 const error=!matches?'Zincirdeki işlem hazırlanan işlemle eşleşmiyor.':ok?null:'İşlem zincirde geri çevrildi (revert).';
 const stmts=[env.DB!.prepare("UPDATE chain_batches SET status=?,from_address=?,block_number=?,block_time=?,gas_used=?,gas_price=?,error=?,confirmed_at=? WHERE id=? AND status='submitted'")
  .bind(ok?'confirmed':'failed',String(tx?.from||'').toLowerCase(),Number(hexToBigInt(receipt.blockNumber)),Number(hexToBigInt(block?.timestamp))*1000,hexToBigInt(receipt.gasUsed).toString(),hexToBigInt(receipt.effectiveGasPrice).toString(),error,now(),batchId)];
 if(ok){
  for(const it of JSON.parse(b.payload) as Item[]){
   if(b.action!=='revoke')stmts.push(env.DB!.prepare('INSERT OR IGNORE INTO chain_records (method,code,vc_hash,batch_id,proof) VALUES (?,?,?,?,?)').bind('nft',it.code,it.hash,b.id,null));
   else stmts.push(env.DB!.prepare('UPDATE chain_records SET revoked_batch=? WHERE method=? AND code=?').bind(b.id,'nft',it.code));
  }
 }
 await env.DB!.batch(stmts);
 return {status:ok?'confirmed':'failed',error};
}
// On-chain status of a diploma, read directly from the NFT contract.
export async function chainStatus(query:{code?:string,hash?:string}){
 const cfg=chainConfig();
 const where=query.code?'r.code=?':'r.vc_hash=?';
 const rows=(await env.DB!.prepare(`SELECT r.*,b.tx_hash,b.block_time FROM chain_records r JOIN chain_batches b ON b.id=r.batch_id WHERE r.method='nft' AND ${where}`).bind(query.code||query.hash).all<any>()).results||[];
 const records=[];
 for(const r of rows){
  const hash=query.hash||r.vc_hash;
  let onChain:any=null,error=null;
  try{onChain=decodeNftVerify(await ethCall(cfg.rpc,cfg.nft,encodeNftVerify(tokenIdFromCode(r.code),hash)));}
  catch(e){error=e instanceof Error?e.message:'Zincir okunamadı.';}
  records.push({method:'nft',code:r.code,vcHash:r.vc_hash,txHash:r.tx_hash,blockTime:r.block_time,contract:cfg.nft,tokenId:tokenIdFromCode(r.code).toString(),onChain,error});
 }
 return {chain:{chainId:cfg.chainId,rpc:cfg.rpc,explorer:cfg.explorer,nft:cfg.nft,issuer:cfg.issuer},records};
}
async function nftInfo(tokenId:string){
 const code=codeFromTokenId(BigInt(tokenId));
 const rec=await env.DB!.prepare("SELECT vc_hash,revoked_batch FROM chain_records WHERE method='nft' AND code=?").bind(code).first<{vc_hash:string,revoked_batch:string|null}>();
 if(!rec)return null;
 const cred=await env.DB!.prepare("SELECT kind,jwt,revoked FROM credentials WHERE kind='diploma' AND subject=?").bind(code).first<{kind:string,jwt:string,revoked:number}>();
 const vc:any=cred?decodeJwt(cred.jwt).payload:null;
 return {code,vcHash:rec.vc_hash,revoked:!!rec.revoked_batch||!!cred?.revoked,issuer:vc?.issuer?.id||null,university:String(vc?.credentialSubject?.diploma?.university||'Diploma Zinciri'),issuedAt:vc?.validFrom||null};
}
export async function nftMetadata(tokenId:string){
 const n=await nftInfo(tokenId);if(!n)return null;
 return {name:'Diploma '+n.code,description:'Diploma Zinciri: devredilemez (soulbound) diploma kaydı. Zincirde yalnızca diploma VC’sinin SHA-256 özeti tutulur; kişisel veri içermez. Test ağı (Sepolia) prototipi.',
  image:appOrigin()+'/api/nft-image/'+BigInt(tokenId).toString(),
  external_url:appOrigin()+'/diploma/'+n.code,
  attributes:[{trait_type:'Diploma kodu',value:n.code},{trait_type:'Üniversite',value:n.university},{trait_type:'VC SHA-256',value:n.vcHash},{trait_type:'Düzenleyen (DID)',value:n.issuer},{trait_type:'Durum',value:n.revoked?'İptal edildi':'Geçerli'}]};
}
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'} as any)[c]);
// Badge image for wallets/explorers. No personal data: university, code, status and the VC hash prefix only.
export async function nftImage(tokenId:string){
 const n=await nftInfo(tokenId);if(!n)return null;
 const uni=n.university.length>34?n.university.slice(0,33)+'…':n.university;
 const [c1,c2]=n.revoked?['#7f1d1d','#b91c1c']:['#0f4f49','#177c71'];
 const status=n.revoked?'İPTAL EDİLDİ':'GEÇERLİ';
 const year=n.issuedAt?new Date(n.issuedAt).getUTCFullYear():'';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="600" height="600" rx="36" fill="url(#g)"/>
<rect x="28" y="28" width="544" height="544" rx="26" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="2"/>
<g transform="translate(300 165)" fill="none" stroke="#ffffff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
<path d="M0 -62 L52 -42 V8 C52 42 28 62 0 74 C-28 62 -52 42 -52 8 V-42 Z" fill="#ffffff" fill-opacity=".12"/><path d="M-22 6 L-6 22 L26 -12"/></g>
<text x="300" y="292" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="56" font-weight="700" fill="#ffffff" letter-spacing="6">DİPLOMA</text>
<text x="300" y="336" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#ffffff" fill-opacity=".92">${esc(uni)}</text>
<rect x="150" y="372" width="300" height="44" rx="22" fill="#ffffff" fill-opacity=".16"/>
<text x="300" y="401" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#ffffff" letter-spacing="3">${status}${year?' · '+year:''}</text>
<text x="300" y="466" text-anchor="middle" font-family="'Courier New', monospace" font-size="21" fill="#ffffff">${esc(n.code)}</text>
<text x="300" y="498" text-anchor="middle" font-family="'Courier New', monospace" font-size="14" fill="#ffffff" fill-opacity=".7">VC SHA-256 ${esc(n.vcHash.slice(0,16))}…</text>
<text x="300" y="540" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#ffffff" fill-opacity=".75" letter-spacing="2">DIPLOMA ZİNCİRİ · SOULBOUND · SEPOLIA TEST</text>
</svg>`;
}
