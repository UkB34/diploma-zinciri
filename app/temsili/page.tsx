'use client';
import {useEffect,useState} from 'react';
import {Link2,ArrowLeft,Download,FileArchive} from 'lucide-react';
import {makeZip} from '../../lib/zip.mjs';
import {universityDid} from '../../lib/vc.mjs';
const YEAR=2026;
async function post(body:any){
 for(let attempt=0;;attempt++){
  const r=await fetch('/api/temsili',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d:any=await r.json().catch(()=>({}));
  if(r.ok)return d;
  if(attempt>=2||r.status<500)throw Error(d.error||'İşlem tamamlanamadı.');
 }
}
const readme=(count:number,real:number)=>`Diploma Zinciri – ${YEAR} temsili diploma paketi

Bu paket yıllık NFT testi için üretildi. Cloudflare kayıt sınırı yetmediği için temsili diplomalar sunucuda
SAKLANMAZ; yalnızca bu dosyalarda bulunur. Dosyaları kaybetmeyin.

temsili/                 ${count} temsili diploma VC dosyası (Örnek Üniversite anahtarıyla imzalı, vc+jwt)
yillik-liste-${YEAR}.json   Yıllık NFT'ye girecek liste: ${count + real} diplomanın yalnızca VC özeti ve durumu
                         (${count} temsili + ${real} gerçek). İsim, numara, kod veya fakülte içermez; özete göre sıralıdır.
temsili-ozetler.csv      Hangi dosyanın hangi özete karşılık geldiği. Yalnızca sizde kalır, NFT'ye girmez.

Doğrulama: herhangi bir .jwt dosyasını sitedeki /dogrula sayfasına yükleyin. Temsili diplomalarda imza ve iptal
kontrolü geçer, "dört birim onayı" adımı geçmez; çünkü onay sürecinden geçmemişlerdir.
`;
export default function Temsili(){
 const [info,setInfo]=useState<any>(null),[done,setDone]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<any>(null);
 useEffect(()=>{fetch('/api/temsili',{cache:'no-store'}).then(async r=>setInfo(r.status===401?{login:true}:await r.json())).catch(()=>setInfo({error:true}));},[]);
 async function run(){
  if(busy)return;setBusy(true);setError('');setResult(null);setDone(0);
  try{
   const all:any[]=[];
   for(let start=1;start<=info.max;start+=info.batch){
    const d=await post({action:'sign',start,count:Math.min(info.batch,info.max-start+1)});
    all.push(...d.diplomas);setDone(all.length);
   }
   const real=(await post({action:'real'})).diplomas as {hash:string,revoked:boolean}[];
   const entries=[...all.map(d=>({vcHash:d.hash,status:'geçerli'})),...real.map(d=>({vcHash:d.hash,status:d.revoked?'iptal':'geçerli'}))].sort((a,b)=>a.vcHash<b.vcHash?-1:1);
   if(new Set(entries.map(e=>e.vcHash)).size!==entries.length)throw Error('Listede aynı özet iki kez çıktı; tekrar deneyin.');
   const list={name:`Örnek Üniversite – ${YEAR} Mezunları`,year:YEAR,issuer:universityDid(location.origin),hash:'SHA-256(diploma VC JWT)',count:entries.length,generatedAt:new Date().toISOString(),entries};
   const files=[
    {name:'BENIOKU.txt',data:readme(all.length,real.length)},
    {name:`yillik-liste-${YEAR}.json`,data:JSON.stringify(list,null,1)},
    {name:'temsili-ozetler.csv',data:'dosya,diploma_kodu,vc_ozeti\n'+all.map(d=>`Temsili-Diploma-${String(d.no).padStart(4,'0')}.diploma.vc.jwt,${d.code},${d.hash}`).join('\n')+'\n'},
    ...all.map(d=>({name:`temsili/Temsili-Diploma-${String(d.no).padStart(4,'0')}.diploma.vc.jwt`,data:d.jwt}))];
   const blob=new Blob([makeZip(files)],{type:'application/zip'}),u=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=u;a.download=`diploma-zinciri-temsili-${YEAR}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);
   setResult({count:all.length,real:real.length,total:entries.length,mb:(blob.size/1048576).toFixed(1)});
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 return <div className="public-verify"><header><a href="/" className="brand"><span className="brand-icon"><Link2/></span><span>Diploma<span className="brand-sub">ZİNCİRİ</span></span></a><a href="/" className="button secondary"><ArrowLeft size={15}/>Panele dön</a></header><main>
  <p className="eyebrow">YILLIK NFT TESTİ</p><h1>Temsili diplomalar</h1>
  <p className="login-subtitle">{YEAR} yıllık NFT'sinin listesini doldurmak için 1000 temsili diploma üretilir. Üniversite anahtarıyla imzalanırlar ama sunucuda <b>saklanmazlar</b>; hepsi tek bir zip dosyası olarak bilgisayarınıza iner.</p>
  <section className="panel" style={{marginTop:30,padding:28,maxWidth:620}}>
   {!info?<p>Yükleniyor…</p>:info.login?<p>Bu sayfa için <a href="/login?next=/temsili">giriş yapın</a>.</p>:info.error?<p className="error">Sayfa bilgisi alınamadı.</p>:!info.canAct?<p>Temsili diplomaları yalnızca merkez yetkilisi üretebilir.</p>:<>
    <h2 style={{display:'flex',gap:8,alignItems:'center'}}><FileArchive size={20}/>{info.max} temsili diploma</h2>
    <p className="help">Zip'in içinde: diploma VC dosyaları, yıllık liste (yalnızca özet ve durum; 3 gerçek diploma dahil) ve hangi dosyanın hangi özete ait olduğunu gösteren tablo. İşlem yaklaşık 1 dakika sürer.</p>
    <button className="button primary full" disabled={busy} onClick={run}><Download size={16}/>{busy?`İmzalanıyor… ${done}/${info.max}`:'Üret ve zip olarak indir'}</button>
    {busy&&<div style={{height:6,background:'#e6ede8',borderRadius:3,marginTop:12}}><div style={{height:6,width:`${done/info.max*100}%`,background:'#24836b',borderRadius:3}}/></div>}
    {result&&<p className="success">İndirildi ✓ {result.count} temsili diploma, yıllık listede toplam {result.total} özet ({result.real} gerçek). Dosya boyutu {result.mb} MB.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
   </>}
  </section>
 </main></div>;
}
