'use client';
import {useEffect,useState} from 'react';
import {checkDiplomas,vcHash} from '../lib/solana.mjs';
// Bir diplomanın Solana koleksiyonundaki NFT'sini tarayıcıdan doğrudan okur; sunucuya güvenmek gerekmez.
export default function SolanaStatus({jwt,hash,compact}:{jwt?:string,hash?:string,compact?:boolean}){
 const [state,setState]=useState<any>({loading:true});
 useEffect(()=>{let live=true;setState({loading:true});(async()=>{
  try{
   const h=hash||await vcHash(jwt||'');
   const r=await checkDiplomas([h]);
   if(live)setState({collection:r.collection,result:r.results[0]});
  }catch(e:any){if(live)setState({error:e.message});}
 })();return()=>{live=false;};},[jwt,hash]);
 if(state.loading)return <p className="help">Solana kaydı kontrol ediliyor…</p>;
 if(state.error)return <p className="help">Solana kontrolü şu anda yapılamadı: {state.error}</p>;
 const r=state.result,ok=r.state==='valid',missing=r.state==='missing';
 const text=ok?'Solana’da kayıtlı · özet eşleşiyor · devredilemez':missing?'Bu diploma henüz Solana koleksiyonuna eklenmemiş.':r.state==='revoked'?'Zincirde İPTAL EDİLMİŞ ('+r.message+')':r.message;
 if(compact)return <span>{ok?'✓ ':missing?'':'✗ '}{text}{!missing&&<> · <a href={r.url} target="_blank" rel="noopener noreferrer">NFT</a></>}</span>;
 return <div style={{display:'flex',gap:10,lineHeight:1.5}}>
  <span aria-hidden="true" style={{fontWeight:700,color:ok?'#13804b':missing?'#64748b':'#a12020'}}>{ok?'✓':missing?'–':'✗'}</span>
  <span><b>NFT:</b> {text}
   <small style={{display:'block'}}>Solana {`devnet`} düğümünden doğrudan okundu · <a href={state.collection.url} target="_blank" rel="noopener noreferrer">{state.collection.name}</a>
    {!missing&&<> · <a href={r.url} target="_blank" rel="noopener noreferrer">NFT {r.address.slice(0,4)}…{r.address.slice(-4)}</a></>}</small></span>
 </div>;
}
