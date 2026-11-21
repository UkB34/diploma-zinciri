'use client';
import {useEffect,useState} from 'react';
import {Boxes} from 'lucide-react';
import ChainStatus from './chain-status';
import {connectWallet,sendTransaction,shortHash} from '../lib/chain-client';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function post(body:any){const r=await fetch('/api/chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'İşlem tamamlanamadı.');return d;}
// Registers one fully approved diploma (all four VC approvals done) on Sepolia as a soulbound NFT.
export default function ChainRegister({code,canAct}:{code:string,canAct:boolean}){
 const [registered,setRegistered]=useState<boolean|null>(null),[issuer,setIssuer]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{fetch('/api/chain/verify?code='+encodeURIComponent(code),{cache:'no-store'}).then(r=>r.json()).then((d:any)=>{setRegistered((d.records||[]).length>0);setIssuer(d.chain?.issuer||'');}).catch(()=>setRegistered(null));},[code,reload]);
 async function register(){
  if(busy)return;setError('');setMsg('');setBusy(true);
  try{
   const from=await connectWallet();
   if(issuer&&from.toLowerCase()!==issuer.toLowerCase())throw Error('MetaMask’ta seçili hesap ('+shortHash(from)+') üniversite cüzdanı değil.');
   const prep=await post({action:'register-diploma',code});const tx=prep.transactions[0];
   setMsg('MetaMask onayı bekleniyor…');
   let hash:string;try{hash=await sendTransaction(from,tx.to,tx.data);}catch(e){await post({action:'cancel',batchId:tx.batchId});throw e;}
   await post({action:'submit',batchId:tx.batchId,txHash:hash});setMsg('İşlem gönderildi, bloğa girmesi bekleniyor…');
   let status='submitted';for(let i=0;i<72&&status==='submitted';i++){await sleep(5000);const r=await post({action:'confirm',batchId:tx.batchId});status=r.status;if(r.status==='failed')throw Error(r.error||'İşlem başarısız.');}
   if(status!=='confirmed')throw Error('İşlem hâlâ bekliyor. Birkaç dakika sonra sayfayı yenileyin.');
   setMsg('NFT kaydı tamamlandı ✓');
  }catch(e:any){setError(e.message);}finally{setBusy(false);setReload((x:number)=>x+1);}
 }
 return <div className="notice neutral" style={{display:'block',marginTop:16}}>
  <strong style={{display:'flex',gap:8,alignItems:'center'}}><Boxes size={16}/>Blokzincir (Sepolia)</strong>
  <div style={{marginTop:8}}><ChainStatus key={reload} code={code}/></div>
  {canAct&&registered===false&&<div style={{marginTop:10}}>
   <button className="button primary full" disabled={busy} onClick={register}>{busy?'İşlem sürüyor…':'NFT olarak kaydet'}</button>
   <p className="help">Dört VC onayı tamamlanmış bu diplomanın VC özeti devredilemez bir NFT olarak zincire yazılır; kişisel veri yazılmaz. MetaMask onayı gerekir (merkez yetkilisi, üniversite cüzdanı).</p>
  </div>}
  {msg&&<p className="success">{msg}</p>}{error&&<p className="error" role="alert">{error}</p>}
 </div>;
}
