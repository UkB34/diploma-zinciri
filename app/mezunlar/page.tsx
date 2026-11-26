'use client';
import {useEffect,useState} from 'react';
import {Link2,ArrowLeft,GraduationCap,Download,ExternalLink} from 'lucide-react';
import {makeZip} from '../../lib/zip.mjs';
import {COLLECTIONS,checkDiplomas} from '../../lib/solana.mjs';

type Grad={code:string,name:string,program:string,faculty:string,issuedAt:string,year:number,revoked:boolean,hash:string,jwt?:string};
const readme=(year:number,n:number)=>`Diploma Zinciri – ${year} mezunları, toplu NFT basımı

Bu klasörde ${year} yılının henüz Solana koleksiyonuna basılmamış ${n} diploma VC dosyası var.
Basım bilgisayarınızdaki Python aracıyla yapılır; cüzdan anahtarı sunucuya gönderilmez.

1. Bu zip'i "Tümünü ayıkla" ile İndirilenler\\Diploma Zinciri\\solana klasörünün içine çıkarın
   (içinde mezunlar-${year} klasörü oluşur).
2. VS Code'da solana klasörünü açın, terminalde şunu çalıştırın:
   python diploma_nft.py bas --klasor mezunlar-${year} --anahtar cuzdan-anahtari.txt --ag devnet
3. "evet" yazın ve Pinata JWT'yi bir kez yapıştırın. Diplomalar ${year} koleksiyonuna eklenir.
4. Sitedeki Mezunlar sayfasını yenileyin; NFT durumu "Solana'da kayıtlı" olarak görünür.
`;

export default function Mezunlar(){
 const [data,setData]=useState<any>(null),[status,setStatus]=useState<Record<number,any>>({}),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/mezunlar',{cache:'no-store'}).then(async r=>{
  if(r.status===401){setData({login:true});return;}
  const d:any=await r.json();setData(d);
  const years=[...new Set<number>(d.graduates.map((g:Grad)=>g.year))];
  for(const y of years){
   const coll=(COLLECTIONS as Record<number,string>)[y];
   if(!coll){setStatus(s=>({...s,[y]:{none:true}}));continue;}
   const list=d.graduates.filter((g:Grad)=>g.year===y);
   checkDiplomas(list.map((g:Grad)=>g.hash),{collection:coll}).then(r=>setStatus(s=>({...s,[y]:{collection:r.collection,byHash:Object.fromEntries(r.results.map((x:any)=>[x.hash,x]))}})))
    .catch(e=>setStatus(s=>({...s,[y]:{error:e.message}})));
  }
 }).catch(()=>setError('Mezun listesi alınamadı.'));},[]);

 function download(year:number,list:Grad[]){
  const folder=`mezunlar-${year}`;
  const files=[{name:`${folder}/BENIOKU.txt`,data:readme(year,list.length)},...list.map(g=>({name:`${folder}/${g.code}.diploma.vc.jwt`,data:g.jwt||''}))];
  const u=URL.createObjectURL(new Blob([makeZip(files)],{type:'application/zip'})),a=document.createElement('a');
  a.href=u;a.download=`${folder}-nft.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);
 }

 const years:number[]=data?.graduates?[...new Set<number>(data.graduates.map((g:Grad)=>g.year))].sort((a,b)=>b-a):[];
 return <div className="public-verify"><header><a href="/" className="brand"><span className="brand-icon"><Link2/></span><span>Diploma<span className="brand-sub">ZİNCİRİ</span></span></a><a href="/" className="button secondary"><ArrowLeft size={15}/>Panele dön</a></header><main>
  <p className="eyebrow">KOLEKSİYONLAR</p><h1>Mezunlar</h1>
  <p className="login-subtitle">Dört onayı tamamlanıp diploma VC’si düzenlenen mezunlar yıllara göre listelenir. Her mezun, o yılın Solana koleksiyonunun ayrı bir parçasıdır; NFT durumu tarayıcıdan doğrudan Solana’dan okunur.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  {!data?<p style={{marginTop:24}}>Yükleniyor…</p>:data.login?<p style={{marginTop:24}}>Bu sayfa için <a href="/login?next=/mezunlar">giriş yapın</a>.</p>:!years.length?<p style={{marginTop:24}}>Henüz diploma VC’si düzenlenmiş mezun yok.</p>:years.map(y=>{
   const list=data.graduates.filter((g:Grad)=>g.year===y),st=status[y];
   const pending=st?.byHash?list.filter((g:Grad)=>!g.revoked&&st.byHash[g.hash]?.state==='missing'):[];
   return <section key={y} className="panel" style={{marginTop:28,padding:24}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
     <div><h2 style={{display:'flex',gap:8,alignItems:'center',margin:0}}><GraduationCap size={22}/>{y} Mezunları</h2>
      <p className="help" style={{margin:'6px 0 0'}}>{st?.collection?<>Koleksiyon: <a href={st.collection.url} target="_blank" rel="noopener noreferrer">{st.collection.name} <ExternalLink size={12}/></a> · zincirde toplam {st.collection.numMinted} NFT (temsili diplomalar dahil)</>:st?.none?'Bu yıl için henüz Solana koleksiyonu yok; ilk basımda Python aracı yeni koleksiyon oluşturur.':st?.error?'Solana okunamadı: '+st.error:'Solana kontrol ediliyor…'}</p></div>
     {data.canMint&&<div style={{textAlign:'right'}}>
      <button className="button primary" disabled={!st||(!st.none&&!st.byHash)||(st.byHash&&!pending.length)} onClick={()=>download(y,st.none?list.filter((g:Grad)=>!g.revoked):pending)}><Download size={16}/>Toplu NFT oluştur{st?.byHash?` (${pending.length})`:st?.none?` (${list.filter((g:Grad)=>!g.revoked).length})`:''}</button>
      <p className="help" style={{margin:'6px 0 0',maxWidth:320}}>{st?.byHash&&!pending.length?'Bu yılın bütün diplomaları zincirde.':'Basılmamış diplomaları zip olarak indirir; basımı bilgisayarınızdaki Python aracı yapar.'}</p>
     </div>}
    </div>
    <div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
     <thead><tr style={{textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{['Mezun','Program','Diploma kodu','Düzenlenme','NFT'].map(h=><th key={h} style={{padding:'8px 6px',fontSize:12,color:'#64748b',fontWeight:600}}>{h}</th>)}</tr></thead>
     <tbody>{list.map((g:Grad)=>{const r=st?.byHash?.[g.hash];return <tr key={g.code} style={{borderBottom:'1px solid #f1f5f9'}}>
      <td style={{padding:'10px 6px'}}><a href={'/diploma/'+g.code}>{g.name}</a></td><td style={{padding:'10px 6px'}}>{g.program}</td><td style={{padding:'10px 6px',fontFamily:'monospace',fontSize:12}}>{g.code}</td>
      <td style={{padding:'10px 6px'}}>{new Date(g.issuedAt).toLocaleDateString('tr-TR')}</td>
      <td style={{padding:'10px 6px'}}>{g.revoked?'İptal edildi':!st?'…':st.none?'Basılmadı':!r?'…':r.state==='valid'?<a href={r.url} target="_blank" rel="noopener noreferrer">✓ Solana’da kayıtlı</a>:r.state==='missing'?'– Basılmadı':'✗ '+r.message}</td>
     </tr>;})}</tbody>
    </table></div>
   </section>;})}
 </main></div>;
}
