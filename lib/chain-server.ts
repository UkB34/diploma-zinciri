import {env} from 'cloudflare:workers';
import {CHAIN_ID,EXPLORER,DEFAULT_RPC,MAX_NFT_BATCH,isAddress,isTxHash,strip0x,rpc,ethCall,sha256Hex,vcHash,buildMerkleTree,tokenIdFromCode,encodeMintBatch,encodeAnchor,encodeRevoke,encodeRevokeLeaf,encodeNftVerify,encodeAnchorVerify,decodeNftVerify,decodeAnchorVerify,hexToBigInt} from './chain.mjs';
import {issueStored,appOrigin} from './credentials';
import {diplomaCredential,decodeJwt,randomId} from './vc.mjs';
import {newDiplomaCode} from './workflow.mjs';

export type Method='nft'|'anchor';
type Item={code:string,hash:string,proof?:string[]};
export function chainConfig(){
 const nft=env.NFT_CONTRACT,anchor=env.ANCHOR_CONTRACT,issuer=env.CHAIN_ISSUER;
 if(!isAddress(nft)||!isAddress(anchor)||!isAddress(issuer))throw Error('Blokzincir ayarları (sözleşme ve cüzdan adresleri) eksik.');
 return {chainId:CHAIN_ID,rpc:env.CHAIN_RPC||DEFAULT_RPC,nft:nft!,anchor:anchor!,issuer:issuer!,explorer:EXPLORER};
}
export const contractFor=(method:Method)=>method==='nft'?chainConfig().nft:chainConfig().anchor;
const call=(method:string,params:any[])=>rpc(chainConfig().rpc,method,params);
const now=()=>Date.now();

// ---- Benchmark diplomas: real VC structure, clearly marked as measurement data, no approvals attached ----
export async function createBenchDiplomas(count:number){
 if(!Number.isInteger(count)||count<1||count>10)throw Error('Tek seferde 1–10 test diploması üretilebilir.');
 const existing=(await env.DB!.prepare("SELECT count(*) AS n FROM credentials WHERE kind='bench'").first<{n:number}>())?.n||0;
 if(existing+count>1000)throw Error('Ölçüm için en fazla 1000 test diploması üretilebilir.');
 const origin=appOrigin(),created:string[]=[];
 for(let i=0;i<count;i++){
  const code=newDiplomaCode(),no=String(existing+i+1).padStart(4,'0');
  const random=async(tag:string)=>sha256Hex(tag+':'+code+':'+randomId());
  const content={name:'Test Mezun '+no,university:'Örnek Üniversite',faculty:'Ölçüm Fakültesi',program:'Blokzincir ölçüm testi',transcript:{hash:await random('t')}};
  const documentHash=await random('d');
  await issueStored('bench',null,null,code,(statusIndex,id)=>{const vc:any=diplomaCredential({id,code,content,version:1,documentHash,approvals:[],statusIndex,origin});vc.name='Ölçüm amaçlı test diploması';vc.credentialSubject.benchmark=true;return vc;});
  created.push(code);
 }
 return created;
}

// Diplomas not yet registered with the method and not part of an open (prepared/submitted) batch.
async function candidates(method:Method,source:'bench'|'issued',limit:number,withHash=true){
 const kind=source==='bench'?'bench':'diploma';
 const open=await env.DB!.prepare("SELECT payload FROM chain_batches WHERE method=? AND action IN ('register','diploma') AND status IN ('prepared','submitted') AND created_at>?").bind(method,now()-1800000).all<{payload:string}>();
 const busy=new Set((open.results||[]).flatMap((r:{payload:string})=>(JSON.parse(r.payload) as Item[]).map(i=>i.code)));
 const rows=await env.DB!.prepare("SELECT c.subject AS code, c.jwt AS jwt FROM credentials c LEFT JOIN chain_records r ON r.method=? AND r.code=c.subject WHERE c.kind=? AND c.revoked=0 AND r.code IS NULL ORDER BY c.created_at").bind(method,kind).all<{code:string,jwt:string}>();
 const out:Item[]=[];
 for(const r of rows.results||[]){if(busy.has(r.code))continue;out.push({code:r.code,hash:withHash?await vcHash(r.jwt):''});if(out.length===limit)break;}
 return out;
}
export async function availableCounts(){
 const res:any={};
 for(const method of ['nft','anchor'] as Method[])for(const source of ['bench','issued'] as const)res[method+'_'+source]=(await candidates(method,source,100000,false)).length;
 return res;
}
async function insertBatch(runId:string,runSize:number,method:Method,action:'register'|'diploma'|'revoke',items:Item[],data:string,root:string|null,user:string){
 const id=crypto.randomUUID();
 await env.DB!.prepare('INSERT INTO chain_batches (id,run_id,run_size,method,action,size,data_hash,payload,root,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,runId,runSize,method,action,items.length,await sha256Hex(strip0x(data)),JSON.stringify(items),root,'prepared',user,now()).run();
 return {batchId:id,to:contractFor(method),data,count:items.length};
}
// Builds the transactions for one measurement run. NFT runs over 150 diplomas are split into several transactions.
export async function prepareRun(method:Method,source:'bench'|'issued',size:number,user:string){
 if(!['nft','anchor'].includes(method))throw Error('Geçersiz yöntem.');
 if(!Number.isInteger(size)||size<1||size>500)throw Error('Paket boyutu 1–500 olmalı.');
 const items=await candidates(method,source,size);
 if(items.length<size)throw Error(`Bu yöntem için kayıt bekleyen yalnızca ${items.length} diploma var. Önce test diploması üretin.`);
 const runId=crypto.randomUUID(),txs=[];
 if(method==='nft'){
  for(let i=0;i<items.length;i+=MAX_NFT_BATCH){
   const chunk=items.slice(i,i+MAX_NFT_BATCH);
   txs.push(await insertBatch(runId,size,method,'register',chunk,encodeMintBatch(chunk.map(x=>tokenIdFromCode(x.code)),chunk.map(x=>x.hash)),null,user));
  }
 }else{
  const tree=await buildMerkleTree(items.map(x=>x.hash));
  items.forEach((x,i)=>x.proof=tree.proofs[i]);
  txs.push(await insertBatch(runId,size,method,'register',items,encodeAnchor(tree.root,items.length),tree.root,user));
 }
 return {runId,transactions:txs};
}
// Registers one specific, fully approved diploma (protocol 3, all four VC approvals) with the chosen method.
// Merkle: a batch of one, so the root is the diploma's own VC hash and the proof is empty.
export async function prepareDiploma(method:Method,code:string,user:string){
 if(!['nft','anchor'].includes(method))throw Error('Geçersiz yöntem.');
 const cred=await env.DB!.prepare("SELECT jwt FROM credentials WHERE kind='diploma' AND subject=? AND revoked=0").bind(code).first<{jwt:string}>();
 if(!cred)throw Error('Bu kodla düzenlenmiş geçerli bir diploma VC’si yok.');
 if(await env.DB!.prepare('SELECT 1 FROM chain_records WHERE method=? AND code=?').bind(method,code).first())throw Error('Bu diploma bu yöntemle zaten zincire kaydedilmiş.');
 const open=await env.DB!.prepare("SELECT payload FROM chain_batches WHERE method=? AND action IN ('register','diploma') AND status IN ('prepared','submitted') AND created_at>?").bind(method,now()-1800000).all<{payload:string}>();
 if((open.results||[]).some((r:{payload:string})=>(JSON.parse(r.payload) as Item[]).some(i=>i.code===code)))throw Error('Bu diploma için bekleyen bir işlem var. Birkaç dakika sonra tekrar deneyin.');
 const hash=await vcHash(cred.jwt),item:Item={code,hash,proof:[]},runId=crypto.randomUUID();
 const data=method==='nft'?encodeMintBatch([tokenIdFromCode(code)],[hash]):encodeAnchor(hash,1);
 return {runId,transactions:[await insertBatch(runId,1,method,'diploma',[item],data,method==='anchor'?hash:null,user)]};
}
export async function prepareRevoke(method:Method,code:string,user:string){
 const rec=await env.DB!.prepare('SELECT vc_hash,revoked_batch FROM chain_records WHERE method=? AND code=?').bind(method,code).first<{vc_hash:string,revoked_batch:string|null}>();
 if(!rec)throw Error('Bu diploma bu yöntemle zincire kaydedilmemiş.');
 if(rec.revoked_batch)throw Error('Bu diploma zincirde zaten iptal edilmiş.');
 const data=method==='nft'?encodeRevoke(tokenIdFromCode(code)):encodeRevokeLeaf(rec.vc_hash);
 const runId=crypto.randomUUID();
 return {runId,transactions:[await insertBatch(runId,1,method,'revoke',[{code,hash:rec.vc_hash}],data,null,user)]};
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
 const matches=!!tx&&String(tx.to).toLowerCase()===contractFor(b.method).toLowerCase()&&await sha256Hex(strip0x(tx.input||''))===b.data_hash;
 const ok=matches&&receipt.status==='0x1';
 const error=!matches?'Zincirdeki işlem hazırlanan işlemle eşleşmiyor.':ok?null:'İşlem zincirde geri çevrildi (revert).';
 const stmts=[env.DB!.prepare("UPDATE chain_batches SET status=?,from_address=?,block_number=?,block_time=?,gas_used=?,gas_price=?,error=?,confirmed_at=? WHERE id=? AND status='submitted'")
  .bind(ok?'confirmed':'failed',String(tx?.from||'').toLowerCase(),Number(hexToBigInt(receipt.blockNumber)),Number(hexToBigInt(block?.timestamp))*1000,hexToBigInt(receipt.gasUsed).toString(),hexToBigInt(receipt.effectiveGasPrice).toString(),error,now(),batchId)];
 if(ok){
  for(const it of JSON.parse(b.payload) as Item[]){
   if(b.action!=='revoke')stmts.push(env.DB!.prepare('INSERT OR IGNORE INTO chain_records (method,code,vc_hash,batch_id,proof) VALUES (?,?,?,?,?)').bind(b.method,it.code,it.hash,b.id,it.proof?JSON.stringify(it.proof):null));
   else stmts.push(env.DB!.prepare('UPDATE chain_records SET revoked_batch=? WHERE method=? AND code=?').bind(b.id,b.method,it.code));
  }
 }
 await env.DB!.batch(stmts);
 return {status:ok?'confirmed':'failed',error};
}
// T5: a wallet that is not an issuer tries to register. Simulated with eth_call, so it costs no gas.
export async function unauthorizedTest(method:Method){
 const fake='0x'+Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');
 const h=await sha256Hex('yetkisiz-test-'+randomId());
 const data=method==='nft'?encodeMintBatch([BigInt(1)],[h]):encodeAnchor(h,1);
 try{await ethCall(chainConfig().rpc,contractFor(method),data,fake);return {rejected:false,from:fake,message:'Sözleşme yetkisiz cüzdanı reddetmedi!'};}
 catch(e){const m=e instanceof Error?e.message:String(e);return {rejected:/yetkisiz|revert/i.test(m),from:fake,message:m};}
}
// On-chain status of a diploma for both methods, read directly from the contracts.
export async function chainStatus(query:{code?:string,hash?:string}){
 const cfg=chainConfig();
 let rows:any[]=[];
 if(query.code)rows=(await env.DB!.prepare('SELECT r.*,b.tx_hash,b.block_time FROM chain_records r JOIN chain_batches b ON b.id=r.batch_id WHERE r.code=?').bind(query.code).all<any>()).results||[];
 else if(query.hash)rows=(await env.DB!.prepare('SELECT r.*,b.tx_hash,b.block_time FROM chain_records r JOIN chain_batches b ON b.id=r.batch_id WHERE r.vc_hash=?').bind(query.hash).all<any>()).results||[];
 const records=[];
 for(const r of rows){
  const hash=query.hash||r.vc_hash,proof=r.proof?JSON.parse(r.proof):[];
  let onChain:any=null,error=null;
  try{
   onChain=r.method==='nft'?decodeNftVerify(await ethCall(cfg.rpc,cfg.nft,encodeNftVerify(tokenIdFromCode(r.code),hash))):decodeAnchorVerify(await ethCall(cfg.rpc,cfg.anchor,encodeAnchorVerify(hash,proof)));
  }catch(e){error=e instanceof Error?e.message:'Zincir okunamadı.';}
  records.push({method:r.method,code:r.code,vcHash:r.vc_hash,proof,txHash:r.tx_hash,blockTime:r.block_time,contract:r.method==='nft'?cfg.nft:cfg.anchor,tokenId:r.method==='nft'?tokenIdFromCode(r.code).toString():null,onChain,error});
 }
 return {chain:{chainId:cfg.chainId,rpc:cfg.rpc,explorer:cfg.explorer,nft:cfg.nft,anchor:cfg.anchor,issuer:cfg.issuer},records};
}
// Measurement report: one row per run (NFT runs may contain several transactions).
export async function report(){
 const rows=(await env.DB!.prepare('SELECT id,run_id,run_size,method,action,size,status,tx_hash,from_address,block_number,block_time,gas_used,gas_price,error,created_at,submitted_at,confirmed_at FROM chain_batches ORDER BY created_at DESC LIMIT 300').all<any>()).results||[];
 const runs=new Map<string,any>();
 for(const b of rows){
  const r=runs.get(b.run_id)||{runId:b.run_id,method:b.method,action:b.action,size:b.run_size,transactions:[],createdAt:b.created_at};
  r.transactions.push(b);r.createdAt=Math.min(r.createdAt,b.created_at);runs.set(b.run_id,r);
 }
 const list=[...runs.values()].map(r=>{
  const txs=r.transactions,done=txs.filter((t:any)=>t.status==='confirmed');
  const gas=done.reduce((s:bigint,t:any)=>s+BigInt(t.gas_used||0),BigInt(0)),fee=done.reduce((s:bigint,t:any)=>s+BigInt(t.gas_used||0)*BigInt(t.gas_price||0),BigInt(0));
  const status=txs.every((t:any)=>t.status==='confirmed')?'confirmed':txs.some((t:any)=>t.status==='failed')?'failed':txs.some((t:any)=>['prepared','submitted'].includes(t.status))?'pending':'cancelled';
  const start=Math.min(...txs.map((t:any)=>t.submitted_at||t.created_at)),end=Math.max(...done.map((t:any)=>t.block_time||0));
  return {...r,status,txCount:txs.length,gasUsed:gas.toString(),feeWei:fee.toString(),gasPerDiploma:r.size?(gas/BigInt(r.size)).toString():'0',seconds:done.length===txs.length&&end?Math.max(0,Math.round((end-start)/1000)):null};
 });
 return list;
}
export const benchCount=async()=>(await env.DB!.prepare("SELECT count(*) AS n FROM credentials WHERE kind='bench'").first<{n:number}>())?.n||0;
export async function nftMetadata(tokenId:string){
 const {codeFromTokenId}=await import('./chain.mjs');
 const code=codeFromTokenId(BigInt(tokenId));
 const rec=await env.DB!.prepare("SELECT vc_hash,revoked_batch FROM chain_records WHERE method='nft' AND code=?").bind(code).first<{vc_hash:string,revoked_batch:string|null}>();
 if(!rec)return null;
 const cred=await env.DB!.prepare('SELECT kind,jwt FROM credentials WHERE subject=?').bind(code).first<{kind:string,jwt:string}>();
 const issuer=cred?decodeJwt(cred.jwt).payload.issuer?.id:null;
 return {name:'Diploma '+code,description:'Diploma Zinciri: devredilemez (soulbound) diploma kaydı. Zincirde yalnızca diploma VC’sinin SHA-256 özeti tutulur; kişisel veri içermez. Test ağı (Sepolia) prototipi.',
  external_url:appOrigin()+(cred?.kind==='diploma'?'/diploma/'+code:'/dogrula'),
  attributes:[{trait_type:'Diploma kodu',value:code},{trait_type:'VC SHA-256',value:rec.vc_hash},{trait_type:'Düzenleyen (DID)',value:issuer},{trait_type:'Durum',value:rec.revoked_batch?'İptal edildi':'Geçerli'},{trait_type:'Tür',value:cred?.kind==='bench'?'Ölçüm testi':'Diploma'}]};
}
// Diplomas on chain (latest first), one row per code with the status of each method.
export async function recentRecords(limit=300){
 const rows=(await env.DB!.prepare("SELECT r.code,r.method,r.revoked_batch,b.tx_hash,b.block_time,c.kind FROM chain_records r JOIN chain_batches b ON b.id=r.batch_id LEFT JOIN credentials c ON c.subject=r.code ORDER BY b.block_time DESC LIMIT ?").bind(limit*2).all<any>()).results||[];
 const by=new Map<string,any>();
 for(const r of rows){const x=by.get(r.code)||{code:r.code,kind:r.kind==='diploma'?'diploma':'bench',latest:r.block_time||0};x[r.method]={txHash:r.tx_hash,revoked:!!r.revoked_batch,at:r.block_time};x.latest=Math.max(x.latest,r.block_time||0);by.set(r.code,x);}
 return [...by.values()].sort((a,b)=>b.latest-a.latest).slice(0,limit);
}
