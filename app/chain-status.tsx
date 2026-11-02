'use client';
import {useEffect,useState} from 'react';
import {independentCheck,methodLabel,shortHash,type ChainRecord} from '../lib/chain-client';
import {txUrl,tokenUrl,addressUrl} from '../lib/chain.mjs';
// Shows on-chain status for a diploma. The answer is read straight from Sepolia in the browser;
// our server only supplies which records exist (and the Merkle proof, which is self-verifying).
export default function ChainStatus({code,hash}:{code?:string,hash?:string}){
 const [state,setState]=useState<any>({loading:true});
 useEffect(()=>{let live=true;(async()=>{
  try{
   const r=await fetch('/api/chain/verify?'+(code?'code='+encodeURIComponent(code):'hash='+hash),{cache:'no-store'});const d:any=await r.json();if(!r.ok)throw Error(d.error);
   const records=await Promise.all(d.records.map(async(rec:ChainRecord)=>{const direct=await independentCheck(d.chain.rpc,rec,hash||rec.vcHash);return {...rec,result:direct||rec.onChain,direct:!!direct};}));
   if(live)setState({records,chain:d.chain});
  }catch(e:any){if(live)setState({error:e.message});}
 })();return()=>{live=false;};},[code,hash]);
 if(state.loading)return <p className="help">Blokzincir kaydı kontrol ediliyor…</p>;
 if(state.error)return <p className="help">Blokzincir kontrolü şu anda yapılamadı: {state.error}</p>;
 if(!state.records.length)return <p className="help">Bu diploma henüz blokzincire kaydedilmemiş.</p>;
 return <ul style={{listStyle:'none',padding:0,margin:0}}>{state.records.map((r:any)=>{const ok=r.result?.registered&&r.result?.matches&&!r.result?.revoked;return <li key={r.method} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:'1px solid #eef2f7',lineHeight:1.5}}>
  <span aria-hidden="true" style={{fontWeight:700,color:ok?'#13804b':'#a12020'}}>{ok?'✓':'✗'}</span>
  <span><b>{methodLabel(r.method)}:</b> {!r.result?'zincir okunamadı':r.result.revoked?'zincirde İPTAL EDİLMİŞ':ok?'Sepolia’da kayıtlı, özet eşleşiyor':'zincirdeki kayıt bu belgeyle eşleşmiyor'}
   <small style={{display:'block'}}>{r.direct?'Sepolia düğümünden doğrudan okundu':'sunucu üzerinden okundu'} · <a href={txUrl(r.txHash)} target="_blank" rel="noopener noreferrer">işlem {shortHash(r.txHash)}</a>{r.method==='nft'&&r.tokenId?<> · <a href={tokenUrl(r.contract,r.tokenId)} target="_blank" rel="noopener noreferrer">NFT #{shortHash(r.tokenId)}</a></>:<> · <a href={addressUrl(r.contract)} target="_blank" rel="noopener noreferrer">sözleşme</a></>}</small></span>
 </li>;})}</ul>;
}
