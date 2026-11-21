'use client';
import {useState} from 'react';
import {FolderSearch,ShieldCheck,AlertCircle} from 'lucide-react';
import {checkDiplomas,vcHash} from '../lib/solana.mjs';
// Bir klasördeki bütün diploma VC dosyalarını Solana koleksiyonunda toplu olarak kontrol eder. Dosyalar tarayıcıdan çıkmaz.
export default function SolanaBulk(){
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[out,setOut]=useState<any>(null),[error,setError]=useState('');
 async function run(list:FileList|null){
  const files=[...(list||[])].filter(f=>f.name.endsWith('.jwt')&&f.size<60000);
  if(!files.length){setError('Seçilen klasörde .jwt uzantılı diploma dosyası bulunamadı.');return;}
  setBusy(true);setError('');setOut(null);
  try{
   setProgress(`${files.length} dosya okunuyor…`);
   const items=await Promise.all(files.map(async f=>({name:(f as any).webkitRelativePath||f.name,hash:await vcHash(await f.text())})));
   const unique=[...new Map(items.map(i=>[i.hash,i])).values()];
   const r=await checkDiplomas(unique.map(i=>i.hash),{onProgress:(n:number,t:number)=>setProgress(`NFT adresleri hesaplanıyor… ${n}/${t}`)});
   setProgress('');
   const rows=r.results.map((x:any,i:number)=>({...x,name:unique[i].name}));
   setOut({collection:r.collection,rows,valid:rows.filter((x:any)=>x.state==='valid').length,duplicates:items.length-unique.length});
  }catch(e:any){setError(e.message);setProgress('');}finally{setBusy(false);}
 }
 const bad=out?out.rows.filter((x:any)=>x.state!=='valid'):[];
 return <div className="verify-layout" style={{marginTop:24}}>
  <section className="panel verify-card"><FolderSearch size={38}/><h2>Klasörü toplu doğrula</h2>
   <label className="field-label" htmlFor="vc-folder">DİPLOMA KLASÖRÜ</label>
   <input id="vc-folder" type="file" multiple disabled={busy} {...{webkitdirectory:'',directory:''} as any} onChange={e=>run(e.target.files)}/>
   <p className="help">Klasördeki bütün .jwt dosyalarının özeti tarayıcıda hesaplanır ve Solana’daki koleksiyondan doğrudan kontrol edilir. Dosyalar hiçbir yere yüklenmez.</p>
   {busy&&<p className="help">{progress||'Solana’dan okunuyor…'}</p>}
  </section>
  <section className="panel verify-result">{error?<div className="empty" role="alert"><AlertCircle size={40}/><h2>{error}</h2></div>:!out?<div className="empty"><FolderSearch size={44}/><h2>Toplu sonuç burada görünecek</h2><p>Örneğin 1000 temsili diplomanın bulunduğu klasörü seçin.</p></div>:<>
   <div className="proof-icon">{bad.length?<AlertCircle size={38}/>:<ShieldCheck size={38}/>}</div>
   <h2>{out.valid} / {out.rows.length} diploma koleksiyonda kayıtlı ve geçerli</h2>
   <p className="help">Koleksiyon: <a href={out.collection.url} target="_blank" rel="noopener noreferrer">{out.collection.name}</a> · zincirde {out.collection.numMinted} basım{out.duplicates?` · ${out.duplicates} yinelenen dosya atlandı`:''}</p>
   {bad.length>0&&<><p className="field-label">GEÇMEYEN DOSYALAR</p><ul style={{listStyle:'none',padding:0,margin:0}}>{bad.slice(0,50).map((x:any)=><li key={x.hash} style={{padding:'6px 0',borderBottom:'1px solid #eef2f7'}}>✗ <b>{x.name}</b><small style={{display:'block'}}>{x.message}</small></li>)}</ul>{bad.length>50&&<p className="help">…ve {bad.length-50} dosya daha.</p>}</>}
  </>}</section>
 </div>;
}
