'use client';
import {useEffect,useState} from 'react';
import {KeyRound,ShieldCheck,AlertCircle,Download,RefreshCw,Fingerprint} from 'lucide-react';
import {loadWallet,enrollThisBrowser} from '../lib/wallet-client';
import {decodeJwt} from '../lib/vc.mjs';
import {roles} from '../lib/workflow.mjs';
const date=(s:string)=>new Date(s).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Istanbul'});
const short=(did:string)=>did.length>48?did.slice(0,32)+'…'+did.slice(-10):did;
export default function WalletPanel({username,onChange}:{username:string,onChange?:()=>void}){
 const [info,setInfo]=useState<any>(null),[local,setLocal]=useState<string|null|undefined>(undefined),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){
  setError('');
  try{const r=await fetch('/api/wallet',{cache:'no-store'});const d:any=await r.json();if(!r.ok)throw Error(d.error);setInfo(d);}catch(e:any){setError(e.message);}
  try{setLocal((await loadWallet(username))?.did||null);}catch(e:any){setLocal(null);setError(e.message);}
 }
 useEffect(()=>{load();},[username]);
 async function enroll(){
  setBusy(true);setError('');setMessage('');
  try{const d=await enrollThisBrowser(username);setMessage(d.notice==='sent'?'Yetkili Onaycı VC’si düzenlendi. Hesabınızın e-posta adresine bilgilendirme gönderildi.':'Yetkili Onaycı VC’si düzenlendi. Bilgilendirme e-postası gönderilemedi.');await load();onChange?.();}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 function download(){const blob=new Blob([info.credential.jwt],{type:'application/vc+jwt'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=username+'-yetkili-onayci.vc.jwt';a.click();URL.revokeObjectURL(u);}
 const cred=info?.credential,matches=!!cred&&local===cred.holder;
 const subject=cred?decodeJwt(cred.jwt).payload.credentialSubject:null;
 return <><div className="page-title"><div><p className="eyebrow">DOĞRULANABİLİR DİJİTAL KİMLİK</p><h1>Dijital kimliğim</h1><p>Onaylarınızı, bu tarayıcıda üretilen ve sunucuya hiç gönderilmeyen anahtarla imzalarsınız.</p></div><button className="button secondary" onClick={load} disabled={busy}><RefreshCw size={16}/>Yenile</button></div>
 {error&&<div className="error" role="alert"><AlertCircle size={18}/>{error}</div>}
 {message&&<p className="success" role="status">{message}</p>}
 <div className="verify-layout"><section className="panel verify-card">
  {info===null||local===undefined?<p>Cüzdan kontrol ediliyor…</p>:matches?<><div className="proof-icon"><ShieldCheck size={38}/></div><h2>Bu tarayıcı onaya hazır</h2><p className="badge green"><span/>Yetkili Onaycı VC’si aktif</p></>:cred?<><div className="proof-icon"><AlertCircle size={38}/></div><h2>Kimliğiniz başka bir tarayıcıda</h2><p>Hesabınızın aktif dijital kimliği bu tarayıcıda bulunmuyor. Bu tarayıcıyı bağlarsanız yeni bir VC düzenlenir ve <b>önceki tarayıcıdaki kimlik iptal edilir</b>. Bekleyen davetler geçersiz olur.</p><button className="button primary full" disabled={busy} onClick={enroll}><KeyRound size={17}/>{busy?'Kimlik oluşturuluyor…':'Bu tarayıcıyı bağla'}</button></>:<><div className="proof-icon"><Fingerprint size={38}/></div><h2>Dijital kimliğinizi oluşturun</h2><p>Bu tarayıcıda size ait bir anahtar üretilir. Üniversite bu anahtara, <b>{roles.find(r=>r.id===info.role)?.label||info.role}</b> rolünde onay verebileceğinizi gösteren bir <b>Yetkili Onaycı VC’si</b> düzenler.</p><button className="button primary full" disabled={busy} onClick={enroll}><KeyRound size={17}/>{busy?'Kimlik oluşturuluyor…':'Dijital kimliğimi oluştur'}</button></>}
  <p className="help">Anahtar, tarayıcının güvenli deposunda dışa aktarılamaz biçimde tutulur. Tarayıcı verilerini silerseniz veya başka cihaza geçerseniz kimliği yeniden bağlamanız gerekir. Gizli pencerede kimlik oluşturmayın.</p>
 </section><section className="panel verify-result">{cred?<><h2>Yetkili Onaycı VC’si</h2><dl>
  <div><dt>Sahip (DID)</dt><dd title={cred.holder}><code>{short(cred.holder)}</code></dd></div>
  <div><dt>Rol / birim</dt><dd>{subject?.roleLabel} · {subject?.unit}</dd></div>
  <div><dt>Düzenleyen</dt><dd title={info.issuer}><code>{short(info.issuer)}</code></dd></div>
  <div><dt>Geçerlilik</dt><dd>{date(cred.issuedAt)} – {date(cred.validUntil)}</dd></div>
  <div><dt>Bu tarayıcıda</dt><dd>{matches?'Evet — anahtar burada':'Hayır'}</dd></div>
 </dl><button className="button secondary" onClick={download}><Download size={16}/>VC dosyasını indir</button><p className="help">VC; W3C Doğrulanabilir Kimlik Bilgisi 2.0 biçiminde, üniversite anahtarıyla imzalı bir JWT’dir (vc+jwt). İçinde gizli anahtar yoktur.</p></>:<div className="empty"><KeyRound size={40}/><h2>Henüz kimlik bilgisi yok</h2><p>Onay davetleri, dijital kimlik oluşturulduktan sonra istenebilir.</p></div>}</section></div></>;
}
