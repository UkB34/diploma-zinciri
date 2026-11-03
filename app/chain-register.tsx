'use client';
import {useEffect,useState} from 'react';
import {Boxes} from 'lucide-react';
import ChainStatus from './chain-status';
import {connectWallet,sendTransaction,shortHash} from '../lib/chain-client';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function post(body:any){const r=await fetch('/api/chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'İşlem tamamlanamadı.');return d;}
// Registers one fully approved diploma (all four VC approvals done) on Sepolia as an NFT and/or Merkle entry.
export default function ChainRegister({code,canAct}:{code:string,canAct:boolean}){
 const [methods,setMethods]=useState<string[]|null>(null),[issuer,setIssuer]=useState(''),[busy,setBusy]=useState(''),[msg,setMsg]=useState(''),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{fetch('/api/chain/verify?code='+encodeURIComponent(code),{cache:'no-store'}).then(r=>r.json()).then((d:any)=>{setMethods((d.records||[]).map((r:any)=>r.method));setIssuer(d.chain?.issuer||'');}).catch(()=>setMethods([]));},[code,reload]);
 async function register(list:('nft'|'anchor')[]){
  if(busy)return;setError('');setMsg('');
  try{
   const from=await connectWallet();
   if(issuer&&from.toLowerCase()!==issuer.toLowerCase())throw Error('MetaMask’ta seçili hesap ('+shortHash(from)+') üniversite cüzdanı değil.');
   for(const method of list){
    const label=method==='nft'?'NFT':'Merkle';setBusy(method);
    const prep=await post({action:'register-diploma',method,code});const tx=prep.transactions[0];
    setMsg(label+': MetaMask onayı bekleniyor…');
    let hash:string;try{hash=await sendTransaction(from,tx.to,tx.data);}catch(e){await post({action:'cancel',batchId:tx.batchId});throw e;}
    await post({action:'submit',batchId:tx.batchId,txHash:hash});setMsg(label+': işlem gönderildi, bloğa girmesi bekleniyor…');
    let status='submitted';for(let i=0;i<72&&status==='submitted';i++){await sleep(5000);const r=await post({action:'confirm',batchId:tx.batchId});status=r.status;if(r.status==='failed')throw Error(label+': '+(r.error||'işlem başarısız'));}
    if(status!=='confirmed')throw Error(label+': işlem hâlâ bekliyor. Blokzincir testi sayfasında “Bekleyenleri güncelle” ile kontrol edin.');
    setMsg(label+' kaydı tamamlandı ✓');setReload((x:number)=>x+1);
   }
  }catch(e:any){setError(e.message);}finally{setBusy('');setReload((x:number)=>x+1);}
 }
 const missing=(['nft','anchor'] as const).filter(m=>methods&&!methods.includes(m));
 return <div className="notice neutral" style={{display:'block',marginTop:16}}>
  <strong style={{display:'flex',gap:8,alignItems:'center'}}><Boxes size={16}/>Blokzincir (Sepolia)</strong>
  <div style={{marginTop:8}}><ChainStatus key={reload} code={code}/></div>
  {canAct&&methods&&missing.length>0&&<div style={{marginTop:10}}>
   {missing.length===2&&<button className="button primary full" disabled={!!busy} onClick={()=>register(['nft','anchor'])}>{busy?'İşlem sürüyor…':'NFT ve Merkle olarak kaydet'}</button>}
   {missing.map(m=><button key={m} className="button secondary full" disabled={!!busy} onClick={()=>register([m])}>{busy===m?'İşlem sürüyor…':m==='nft'?'Yalnızca NFT olarak kaydet':'Yalnızca Merkle köküne kaydet'}</button>)}
   <p className="help">Dört VC onayı tamamlanmış bu diplomanın VC özeti zincire yazılır; kişisel veri yazılmaz. Her yöntem için ayrı bir MetaMask onayı istenir (merkez yetkilisi, üniversite cüzdanı).</p>
  </div>}
  {msg&&<p className="success">{msg}</p>}{error&&<p className="error" role="alert">{error}</p>}
 </div>;
}
