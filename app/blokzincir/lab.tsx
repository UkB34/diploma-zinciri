'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Boxes,Network,ShieldCheck,AlertCircle,RefreshCw,Download,Wallet,CheckCircle2} from 'lucide-react';
import {connectWallet,sendTransaction,methodLabel,shortHash} from '../../lib/chain-client';
import {txUrl,addressUrl,feeEth,tokenUrl,tokenIdFromCode} from '../../lib/chain.mjs';
import ChainStatus from '../chain-status';
const SIZES=[1,10,50,200];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const fmt=(n:number|bigint,d=0)=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:d});
const date=(ms:number)=>new Date(ms).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'medium',timeZone:'Europe/Istanbul'});
async function post(body:any){const r=await fetch('/api/chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'İşlem tamamlanamadı.');return d;}
export default function ChainLab(){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[log,setLog]=useState<string[]>([]),[account,setAccount]=useState('');
 const [method,setMethod]=useState<'nft'|'anchor'>('anchor'),[size,setSize]=useState(1),[source,setSource]=useState<'bench'|'issued'>('bench'),[genCount,setGenCount]=useState(10);
 const [revokeCode,setRevokeCode]=useState(''),[revokeMethod,setRevokeMethod]=useState<'nft'|'anchor'>('anchor'),[authResult,setAuthResult]=useState<any>({});
 const [gwei,setGwei]=useState(''),[ethTry,setEthTry]=useState(''),[open,setOpen]=useState(''),[filter,setFilter]=useState('');
 const note=(m:string)=>setLog((l:string[])=>[new Date().toLocaleTimeString('tr-TR')+' · '+m,...l].slice(0,40));
 async function load(){try{const r=await fetch('/api/chain',{cache:'no-store'});const d:any=await r.json();if(r.status===401){location.href='/login?next=/blokzincir';return;}if(!r.ok)throw Error(d.error);setData(d);}catch(e:any){setError(e.message);}}
 useEffect(()=>{load();},[]);
 async function guard(label:string,fn:()=>Promise<void>){if(busy)return;setBusy(label);setError('');try{await fn();}catch(e:any){setError(e.message);note('Hata: '+e.message);}finally{setBusy('');load();}}
 async function wallet(){const a=await connectWallet();setAccount(a);if(a.toLowerCase()!==data.config.issuer.toLowerCase())throw Error('MetaMask’ta seçili hesap ('+shortHash(a)+') üniversite cüzdanı değil. Sözleşmeler yalnızca '+shortHash(data.config.issuer)+' adresinden kayıt kabul eder.');return a;}
 async function confirm(batchId:string){
  for(let i=0;i<72;i++){const r=await post({action:'confirm',batchId});if(r.status!=='submitted'){if(r.status==='confirmed')note('İşlem bloğa girdi ✓');else note('İşlem başarısız: '+(r.error||r.status));return r;}await sleep(5000);}
  note('İşlem hâlâ bekliyor. Sonra “Bekleyenleri güncelle” ile kontrol edin.');
 }
 async function execute(prep:any,label:string){
  const from=account||await wallet();
  for(const [i,tx] of prep.transactions.entries()){
   note(`${label}: ${i+1}/${prep.transactions.length}. işlem (${tx.count} diploma) MetaMask onayı bekliyor`);
   let hash:string;
   try{hash=await sendTransaction(from,tx.to,tx.data);}catch(e){await post({action:'cancel',batchId:tx.batchId});throw e;}
   await post({action:'submit',batchId:tx.batchId,txHash:hash});note('Gönderildi: '+shortHash(hash));
   await confirm(tx.batchId);
  }
 }
 const runs=data?.runs||[];
 const pending=runs.flatMap((r:any)=>r.transactions.filter((t:any)=>t.status==='submitted'));
 const comparison=useMemo(()=>SIZES.map(s=>{const pick=(m:string)=>runs.find((r:any)=>r.method===m&&r.action==='register'&&r.size===s&&r.status==='confirmed');return {size:s,nft:pick('nft'),anchor:pick('anchor')};}),[runs]);
 const maxGas=Math.max(1,...comparison.flatMap((c:any)=>[c.nft,c.anchor].filter(Boolean).map((r:any)=>Number(r.gasUsed))));
 const mainnet=(gas:string)=>{const g=parseFloat(gwei.replace(',','.')),p=parseFloat(ethTry.replace(',','.'));if(!(g>0))return null;const eth=Number(gas)*g/1e9;return {eth,tl:p>0?eth*p:null};};
 function csv(){
  const head=['yontem','islem_turu','diploma_sayisi','islem_sayisi','toplam_gas','diploma_basina_gas','ucret_sepolia_eth','sure_sn','durum','tx_hashler'];
  const rows=runs.map((r:any)=>[r.method,r.action,r.size,r.txCount,r.gasUsed,r.gasPerDiploma,feeEth(BigInt(r.feeWei),BigInt(1)),r.seconds??'',r.status,r.transactions.map((t:any)=>t.tx_hash||'').join(' ')]);
  const blob=new Blob([[head,...rows].map(r=>r.join(';')).join('\n')],{type:'text/csv'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='blokzincir-olcum.csv';a.click();URL.revokeObjectURL(u);
 }
 if(!data)return <main className="content" style={{maxWidth:1100,margin:'40px auto'}}><p>{error||'Blokzincir bilgileri yükleniyor…'}</p></main>;
 const c=data.config,can=data.canAct,avail=data.available||{};
 return <main className="content lab" style={{maxWidth:1100,margin:'32px auto',padding:'0 16px'}}>
  <a href="/" className="back"><ArrowLeft size={16}/>Çalışma alanı</a>
  <div className="page-title"><div><p className="eyebrow">2. AŞAMA · SEPOLIA TEST AĞI</p><h1>Blokzincir kayıt testi</h1><p>İki yöntem aynı diplomalarla, aynı ağda karşılaştırılır. Gas ve süre değerleri işlem makbuzlarından otomatik alınır.</p></div><button className="button secondary" onClick={load} disabled={!!busy}><RefreshCw size={16}/>Yenile</button></div>
  {error&&<div className="error" role="alert"><AlertCircle size={18}/>{error}</div>}
  {!can&&<p className="notice">Bu sayfayı görüntüleyebilirsiniz; zincire kayıt işlemlerini yalnızca merkez yetkilisi yapabilir.</p>}
  <div className="verify-layout">
   <section className="panel panel-body"><h2><Network size={18}/> Ağ ve sözleşmeler</h2><dl>
    <div><dt>Ağ</dt><dd>Ethereum Sepolia (zincir no {c.chainId})</dd></div>
    <div><dt>Yöntem 1 · DiplomaNFT</dt><dd><a href={addressUrl(c.nft)} target="_blank" rel="noopener noreferrer"><code>{shortHash(c.nft)}</code></a></dd></div>
    <div><dt>Yöntem 2 · DiplomaAnchor</dt><dd><a href={addressUrl(c.anchor)} target="_blank" rel="noopener noreferrer"><code>{shortHash(c.anchor)}</code></a></dd></div>
    <div><dt>Üniversite cüzdanı</dt><dd><a href={addressUrl(c.issuer)} target="_blank" rel="noopener noreferrer"><code>{shortHash(c.issuer)}</code></a></dd></div>
    <div><dt>Bağlı MetaMask</dt><dd>{account?<code>{shortHash(account)}</code>:'—'}</dd></div>
   </dl>{can&&<button className="button secondary" disabled={!!busy} onClick={()=>guard('wallet',async()=>{await wallet();note('MetaMask bağlandı.');})}><Wallet size={16}/>MetaMask’ı bağla</button>}</section>
   <section className="panel panel-body"><h2><Boxes size={18}/> Test verisi</h2>
    <p>Ölçüm diploması: <b>{fmt(data.benchCount)}</b> adet. Bunlar gerçek VC yapısında, üniversite anahtarıyla imzalı ve “ölçüm amaçlı” olarak işaretli; birim onayı içermez.</p>
    <p className="help">Kayıt bekleyen · NFT: {avail.nft_bench??0} ölçüm + {avail.nft_issued??0} gerçek diploma · Merkle: {avail.anchor_bench??0} ölçüm + {avail.anchor_issued??0} gerçek diploma</p>
    {can&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><input type="number" min={1} max={200} value={genCount} onChange={e=>setGenCount(Math.max(1,Math.min(200,Number(e.target.value)||1)))} style={{width:90}} aria-label="Üretilecek test diploması sayısı"/><button className="button secondary" disabled={!!busy} onClick={()=>guard('gen',async()=>{let left=genCount;while(left>0){const n=Math.min(10,left);await post({action:'generate',count:n});left-=n;note(`${genCount-left}/${genCount} test diploması üretildi`);}})}>{busy==='gen'?'Üretiliyor…':'Test diploması üret'}</button></div>}
    <p className="help">Toplam 261 kayıt için (1+10+50+200) her iki yöntemde aynı diplomalar kullanılabilir: önce 261 test diploması üretin.</p>
   </section>
  </div>
  {can&&<section className="panel panel-body" style={{marginTop:24}}><h2>T1 · Zincire kaydet</h2>
   <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))'}}>
    <label>Yöntem<select value={method} onChange={e=>setMethod(e.target.value as any)}><option value="anchor">Yöntem 2 · Merkle kökü</option><option value="nft">Yöntem 1 · NFT</option></select></label>
    <label>Diploma sayısı<select value={size} onChange={e=>setSize(Number(e.target.value))}>{SIZES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
    <label>Kaynak<select value={source} onChange={e=>setSource(e.target.value as any)}><option value="bench">Ölçüm diplomaları</option><option value="issued">Gerçek diplomalar (onay sürecinden)</option></select></label>
   </div>
   <p className="help">{method==='nft'?`NFT yönteminde her diploma ayrı token olarak basılır; ${size>150?'150’den fazla diploma birden çok işleme bölünür.':'tek işlemde toplu basım yapılır.'}`:'Merkle yönteminde paket boyutundan bağımsız olarak tek işlemle yalnızca kök yazılır.'} MetaMask’ta gösterilen ücret SepoliaETH’dir; gerçek para harcanmaz.</p>
   <button className="button primary" disabled={!!busy} onClick={()=>guard('run',async()=>{const prep=await post({action:'prepare',method,size,source});await execute(prep,`${methodLabel(method)} · ${size} diploma`);})}>{busy==='run'?'İşlem sürüyor…':'MetaMask ile kaydet'}</button>
   {pending.length>0&&<button className="button secondary" style={{marginLeft:8}} disabled={!!busy} onClick={()=>guard('pending',async()=>{for(const t of pending)await confirm(t.id);})}>Bekleyenleri güncelle ({pending.length})</button>}
  </section>}
  {can&&<div className="verify-layout" style={{marginTop:24}}>
   <section className="panel panel-body" id="t4"><h2>T4 · Zincirde iptal</h2><p className="help">Kayıtlı bir diplomayı seçilen yöntemle zincirde iptal eder. Doğrulama sayfaları iptali gösterir.</p>
    <label>Diploma kodu<input value={revokeCode} onChange={e=>setRevokeCode(e.target.value.trim().toUpperCase())} placeholder="TEST-…"/></label>
    <label>Yöntem<select value={revokeMethod} onChange={e=>setRevokeMethod(e.target.value as any)}><option value="anchor">Merkle</option><option value="nft">NFT</option></select></label>
    <button className="button danger" disabled={!!busy||!/^TEST-[A-F0-9]{20}$/.test(revokeCode)} onClick={()=>guard('revoke',async()=>{const prep=await post({action:'revoke',method:revokeMethod,code:revokeCode});await execute(prep,'İptal '+revokeCode);})}>Zincirde iptal et</button></section>
   <section className="panel panel-body"><h2>T5 · Yetkisiz cüzdan</h2><p className="help">Rastgele bir cüzdan adına kayıt denenir (eth_call ile simülasyon, ücretsiz). Sözleşme reddetmeli.</p>
    {(['nft','anchor'] as const).map(m=><div key={m} style={{margin:'8px 0'}}><button className="button secondary" disabled={!!busy} onClick={()=>guard('auth',async()=>{const r=await post({action:'auth-test',method:m});setAuthResult((x:any)=>({...x,[m]:r}));note(`T5 ${m}: ${r.rejected?'reddedildi ✓':'REDDEDİLMEDİ ✗'}`);})}>{m==='nft'?'NFT sözleşmesini dene':'Merkle sözleşmesini dene'}</button>{authResult[m]&&<p className={authResult[m].rejected?'success':'error'}>{authResult[m].rejected?'✓ Reddedildi':'✗ Reddedilmedi'} · {shortHash(authResult[m].from)} · <small>{authResult[m].message}</small></p>}</div>)}</section>
  </div>}
  <section className="panel panel-body" style={{marginTop:24}}><div className="section-head"><h2>Karşılaştırma</h2><button className="button secondary small-btn" onClick={csv} disabled={!runs.length}><Download size={15}/>CSV indir</button></div>
   <p className="help">Her boyut için son başarılı ölçüm. Çubuklar toplam gas’ı gösterir.</p>
   <div className="table-wrap"><table><thead><tr><th>Diploma</th><th>Yöntem 1 · NFT</th><th>Yöntem 2 · Merkle</th><th>Fark</th></tr></thead><tbody>{comparison.map((row:any)=><tr key={row.size}><td><b>{row.size}</b></td>{(['nft','anchor'] as const).map(m=>{const r:any=(row as any)[m];return <td key={m}>{r?<><div style={{background:m==='nft'?'#c2410c':'#1655b8',height:8,borderRadius:4,width:Math.max(4,Math.round(Number(r.gasUsed)/maxGas*100))+'%'}}/><small>{fmt(BigInt(r.gasUsed))} gas · {r.txCount} işlem · {fmt(BigInt(r.gasPerDiploma))} gas/diploma{r.seconds!=null?` · ${r.seconds} sn`:''}</small></>:<small className="muted">ölçülmedi</small>}</td>;})}<td>{row.nft&&row.anchor?<b>{(Number(row.nft.gasUsed)/Number(row.anchor.gasUsed)).toLocaleString('tr-TR',{maximumFractionDigits:1})}×</b>:'—'}</td></tr>)}</tbody></table></div>
   <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16,alignItems:'end'}}><label>Ana ağ gas fiyatı (gwei)<input value={gwei} onChange={e=>setGwei(e.target.value)} placeholder="ör. 1,5" style={{width:120}}/></label><label>1 ETH (TL)<input value={ethTry} onChange={e=>setEthTry(e.target.value)} placeholder="ör. 120000" style={{width:140}}/></label><p className="help" style={{flex:1}}>Sepolia ETH’nin değeri yoktur. Ana ağ maliyeti için ölçüm günündeki gas fiyatını ve ETH kurunu girin; hesap bu değerlerle yapılan bir <b>tahmindir</b>.</p></div>
  </section>
  <section className="panel panel-body" style={{marginTop:24}}><h2>Ölçümler</h2>
   {runs.length===0?<div className="empty"><ShieldCheck size={36}/><p>Henüz ölçüm yok.</p></div>:<div className="table-wrap"><table><thead><tr><th>Zaman</th><th>Yöntem</th><th>İşlem</th><th>Diploma</th><th>Tx</th><th>Toplam gas</th><th>Gas/diploma</th><th>SepoliaETH</th><th>Ana ağ tahmini</th><th>Süre</th><th>Durum</th></tr></thead><tbody>
    {runs.map((r:any)=>{const est=mainnet(r.gasUsed);return <tr key={r.runId}><td className="muted">{date(r.createdAt)}</td><td>{r.method==='nft'?'NFT':'Merkle'}</td><td>{r.action==='register'?'Kayıt':'İptal'}</td><td>{r.size}</td><td>{r.transactions.map((t:any)=>t.tx_hash?<div key={t.id}><a href={txUrl(t.tx_hash)} target="_blank" rel="noopener noreferrer">{shortHash(t.tx_hash)}</a></div>:<div key={t.id} className="muted">—</div>)}</td><td>{fmt(BigInt(r.gasUsed))}</td><td>{fmt(BigInt(r.gasPerDiploma))}</td><td>{feeEth(BigInt(r.feeWei),BigInt(1)).toLocaleString('tr-TR',{maximumFractionDigits:6})}</td><td>{est?`${est.eth.toLocaleString('tr-TR',{maximumFractionDigits:6})} ETH${est.tl!=null?` ≈ ${fmt(est.tl,2)} TL`:''}`:'—'}</td><td>{r.seconds!=null?r.seconds+' sn':'—'}</td><td>{r.status==='confirmed'?<span className="badge green"><span/>Onaylandı</span>:r.status==='pending'?<span className="badge amber"><span/>Bekliyor</span>:r.status==='failed'?<span className="badge red"><span/>Başarısız</span>:<span className="badge"><span/>İptal</span>}{r.transactions.find((t:any)=>t.error)?.error&&<small className="error">{r.transactions.find((t:any)=>t.error).error}</small>}</td></tr>;})}
   </tbody></table></div>}
   <p className="help">Süre: MetaMask’ta onaylandığı andan son işlemin bloğa girdiği ana kadar geçen süre. Gas ve ücret işlem makbuzundan alınır (gasUsed × effectiveGasPrice).</p>
  </section>
  <section className="panel panel-body" style={{marginTop:24}}><div className="section-head"><h2>Zincirdeki diplomalar</h2><input value={filter} onChange={e=>setFilter(e.target.value.toUpperCase())} placeholder="Kod ara: TEST-…" style={{maxWidth:240}} aria-label="Diploma kodu ara"/></div>
   <p className="help">Her satır bir diploma. Sütunlar o diplomanın hangi yöntemle zincire yazıldığını gösterir: <b style={{color:'#c2410c'}}>NFT</b> = DiplomaNFT sözleşmesinde kendi token’ı var, <b style={{color:'#1655b8'}}>Merkle</b> = DiplomaAnchor sözleşmesindeki bir kökün içinde. “Kontrol et” sonucu tarayıcınızdan doğrudan Sepolia’dan okur.</p>
   {!(data.records||[]).length?<div className="empty"><p>Henüz zincire kaydedilmiş diploma yok.</p></div>:<div className="table-wrap"><table><thead><tr><th>Diploma kodu</th><th>Tür</th><th>NFT (Yöntem 1)</th><th>Merkle (Yöntem 2)</th><th/></tr></thead><tbody>
    {(data.records||[]).filter((r:any)=>!filter||r.code.includes(filter)).slice(0,100).map((r:any)=><Fragment key={r.code}>
     <tr><td><code>{r.code}</code></td><td>{r.kind==='diploma'?<a href={'/diploma/'+r.code} target="_blank" rel="noopener noreferrer">Gerçek diploma</a>:<span className="muted">Ölçüm</span>}</td>
      {(['nft','anchor'] as const).map(m=>{const x=r[m];return <td key={m}>{!x?<span className="muted">—</span>:<><span className={'badge '+(x.revoked?'red':m==='nft'?'amber':'blue')}><span/>{x.revoked?'İptal edildi':'Kayıtlı'}</span><small><a href={txUrl(x.txHash)} target="_blank" rel="noopener noreferrer">işlem {shortHash(x.txHash)}</a>{m==='nft'&&<> · <a href={tokenUrl(c.nft,tokenIdFromCode(r.code))} target="_blank" rel="noopener noreferrer">NFT</a></>}</small>{can&&!x.revoked&&<button className="text-link" style={{marginTop:4}} onClick={()=>{setRevokeCode(r.code);setRevokeMethod(m);document.getElementById('t4')?.scrollIntoView({behavior:'smooth'});}}>İptal için seç</button>}</>}</td>;})}
      <td><button className="button secondary small-btn" onClick={()=>setOpen(open===r.code?'':r.code)}>{open===r.code?'Kapat':'Kontrol et'}</button></td></tr>
     {open===r.code&&<tr><td colSpan={5}><ChainStatus code={r.code}/></td></tr>}
    </Fragment>)}
   </tbody></table></div>}
  </section>
  {log.length>0&&<section className="panel panel-body" style={{marginTop:24}}><h2><CheckCircle2 size={18}/> İşlem günlüğü</h2>{log.map((l:string,i:number)=><p key={i} className="help" style={{margin:'4px 0'}}>{l}</p>)}</section>}
 </main>;
}
