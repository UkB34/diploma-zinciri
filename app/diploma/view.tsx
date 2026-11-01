'use client';
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {roles} from '../../lib/workflow.mjs';
import './diploma.css';
export default function Diploma({code}:{code:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[qr,setQr]=useState(''),[qrError,setQrError]=useState('');
 useEffect(()=>{let live=true;async function load(){try{const r=await fetch('/api/verify?code='+encodeURIComponent(code),{cache:'no-store'});const d:any=await r.json();if(!r.ok)throw Error(d.error);if(!d.diplomaAvailable)throw Error('Bu eski kayıt için dört onaya bağlı görsel diploma bulunmuyor.');if(live){setData(d);setError('');}try{const image=await QRCode.toDataURL(location.origin+'/diploma/'+d.code,{errorCorrectionLevel:'M',margin:4,width:240});if(live){setQr(image);setQrError('');}}catch{if(live)setQrError('QR oluşturulamadı. Sayfayı yenileyin; aşağıdaki belge bağlantısı kullanılabilir.');}}catch(e:any){if(live){setError(e.message);setData(null);}}}load();const timer=setInterval(load,30000);return()=>{live=false;clearInterval(timer);};},[code]);
 if(!data)return <main className="diploma-loading"><h1>{error?'Diploma görüntülenemiyor':'Diploma kontrol ediliyor…'}</h1><p>{error}</p><a href="/dogrula">Doğrulama sayfasına dön</a></main>;
 const date=(s:string)=>new Date(s).toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'});
 const vc=data.protocol===3;
 const unit=(id:string)=>roles.find(r=>r.id===id)?.unit||id;
 function download(){const blob=new Blob([data.vc],{type:'application/vc+jwt'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=data.code+'.diploma.vc.jwt';a.click();URL.revokeObjectURL(u);}
 return <main className="diploma-page"><nav className="diploma-tools"><a href="/dogrula">Diploma Zinciri · Doğrulama</a>{vc&&<button onClick={download}>Diploma VC’sini indir</button>}<button onClick={()=>window.print()}>Yazdır / PDF olarak kaydet</button></nav>
 <p className={'diploma-status '+(data.status==='revoked'?'revoked':'')}>{data.status==='revoked'?'İPTAL EDİLDİ — Bu belge artık aktif değildir.':vc?'Diploma VC’si ve dört VC onayı doğrulandı · Aktif prototip kaydı':'Dört test dijital imzası doğrulandı · Eski prototip kaydı'}</p>
 <article className={'diploma-paper '+(data.status==='revoked'?'is-revoked':'')}>
 <div className="diploma-topline"><span>DİPLOMA ZİNCİRİ</span><span>DİJİTAL BELGE · SÜRÜM {data.version}</span></div>
 <header><div className="diploma-emblem" aria-hidden="true">DZ</div><h1>{data.university}</h1><p>{data.faculty}</p></header>
 <div className="diploma-title">DİPLOMA</div><p className="diploma-kicker">TEMSİLİ MEZUNİYET BELGESİ</p>
 <h2>{data.name}</h2><p className="diploma-statement"><strong>{data.program}</strong> programına ait mezuniyet dosyasının öğrenci işleri, fakülte, rektörlük ve merkez aşamalarındaki {vc?'Doğrulanabilir Kimlik Bilgisi (VC) ile onay':'test dijital imza'} süreci tamamlanmıştır.</p>
 <div className="diploma-signatures">{data.approvals.map((a:any)=><div key={a.role}><span>✓</span><strong>{roles.find(r=>r.id===a.role)?.unit}</strong><small>{vc?'VC onayı':'Test dijital imzası'} · {date(a.at)}</small></div>)}</div>
 <footer><div className="diploma-record"><p>DÜZENLENME TARİHİ</p><strong>{date(data.created)}</strong><p>BELGE KODU</p><code>{data.code}</code><p className="diploma-disclaimer">PROTOTİP · RESMÎ DİPLOMA DEĞİLDİR<br/>{vc?'W3C VC · Nitelikli e-imza veya NFT içermez.':'Nitelikli elektronik imza veya NFT içermez.'}</p></div><div className="diploma-qr">{qr&&<img src={qr} alt="Bu diplomanın güncel durumunu görüntüleyen QR kodu" width="150" height="150"/>}<strong>Güncel durumu kontrol edin</strong>{qrError&&<p role="alert">{qrError}</p>}<a href={'/diploma/'+data.code}>Belge bağlantısını aç</a></div></footer>
 {data.status==='revoked'&&<div className="diploma-revoked">İPTAL EDİLDİ</div>}
 </article>{vc&&<section className="diploma-checks" aria-label="Doğrulama sonuçları"><h2>Doğrulama sonuçları</h2><p>Sayfa her açılışta ve 30 saniyede bir, kayıtlı imzalı verilerden yeniden kontrol edilir.</p><ul>{data.checks.map((c:any)=><li key={c.id} className={c.ok?'ok':'bad'}><span aria-hidden="true">{c.ok?'✓':'✗'}</span>{roles.some(r=>r.id===c.label)?unit(c.label)+' onayı: Yetkili Onaycı VC’si geçerli, onay beyanı yetkilinin kendi anahtarıyla imzalı':c.label}</li>)}</ul><p className="diploma-did">Düzenleyen: <code>{data.issuer}</code></p><p>Bu sonuçlara güvenmek zorunda değilsiniz: VC dosyasını indirip <a href="/dogrula">doğrulama sayfasında</a> tarayıcınızda bağımsız olarak kontrol edebilirsiniz.</p></section>}<p className="diploma-footnote">QR kodunu veya bağlantıyı bilen kişiler bu diplomayı görüntüleyebilir. Transkript, öğrenci numarası ve kurum içi notlar bu sayfada paylaşılmaz. Güncel iptal durumu çevrimiçi kontrol edilir.</p></main>;
}
