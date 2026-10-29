'use client';
import {useEffect,useState} from 'react';
import {roles} from '../../lib/workflow.mjs';
import {signApproval,loadWallet} from '../../lib/wallet-client';
const short=(did:string)=>did&&did.length>48?did.slice(0,32)+'…'+did.slice(-10):did;
export default function SignPage(){
 const [outcome,setOutcome]=useState<any>(null);
 const [token,setToken]=useState(''),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[done,setDone]=useState(false),[login,setLogin]=useState(false),[walletOk,setWalletOk]=useState<boolean|null>(null);
 async function request(body:any){const r=await fetch('/api/signatures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json();if(!r.ok){setLogin(r.status===401||r.status===403);throw Error(d.error);}return d;}
 async function inspect(value:string){
  setBusy(true);setError('');
  try{const d=await request({action:'inspect',token:value});setData(d);const w=await loadWallet(d.username).catch(()=>null);setWalletOk(!!w&&w.did===d.challenge.holder);}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 async function sign(){
  setBusy(true);setError('');
  try{
   const c=data.challenge;
   const presentation=await signApproval(data.username,{approverJwt:c.approverJwt,holder:c.holder,nonce:c.nonce,audience:c.audience,approval:c.approval});
   const d=await request({action:'sign',token,consent:true,presentation});
   setDone(true);setOutcome(d);sessionStorage.removeItem('dz-sign-token');
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 useEffect(()=>{const supplied=new URLSearchParams(location.hash.slice(1)).get('token');if(supplied){sessionStorage.setItem('dz-sign-token',supplied);history.replaceState(null,'','/imzala');}const value=supplied||sessionStorage.getItem('dz-sign-token')||'';setToken(value);if(value)inspect(value);else setError('E-postadaki onay bağlantısını açın.');},[]);
 async function switchAccount(){await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});location.href='/login?next=/imzala';}
 return <main className="content" style={{maxWidth:820,margin:'40px auto'}}><a href="/">← Çalışma alanı</a><section className="panel panel-body"><p className="eyebrow">DİPLOMA ZİNCİRİ · V3 · DOĞRULANABİLİR KİMLİK</p><h1>{done?'VC onayı tamamlandı':'Belgeyi incele ve VC ile onayla'}</h1>
 <p className="notice">Onay beyanınız bu tarayıcıdaki dijital kimliğinizle (DID) imzalanır ve üniversitenin size verdiği Yetkili Onaycı VC’si ile birlikte sunulur. Gizli anahtar sunucuya gönderilmez. Bu prototip nitelikli elektronik imza değildir.</p>
 {error&&<p className="error" role="alert">{error}</p>}{login&&<button className="button secondary" onClick={switchAccount}>Davetin gönderildiği hesapla giriş yap</button>}
 {done?<><p>Doğrulanabilir sunumunuz (VP) sunucuda doğrulandı ve kaydedildi. Dosya sonraki aşamaya geçti; son onaysa üniversite diploma VC’sini düzenledi.</p><p className="field-label">ONAYI İMZALAYAN KİMLİK (DID)</p><code className="hash">{outcome?.holder}</code>{outcome?.credentialCode&&<a className="button primary" href={'/diploma/'+outcome.credentialCode}>Diplomayı, VC’yi ve QR kodunu görüntüle</a>}{outcome?.notification?.status==='sent'&&<p>Sonraki birimin bildirim maili gönderim servisine iletildi.</p>}{['failed','pending','unknown','sending'].includes(outcome?.notification?.status)&&<p className="notice">Onayınız kaydedildi. Sonraki birime bildirim henüz doğrulanamadı; panelden yeniden gönderebilirsiniz.</p>}<a className="button secondary" href="/">Dosyalara dön</a></>
 :data?<><h2>{data.content.name}</h2><p>{data.content.student} · {data.content.university}</p><p>{data.content.faculty} / {data.content.program}</p><p>{data.content.notes}</p><p>Dosya: {data.caseId} · Sürüm {data.version}</p><p>Onaylayan hesap: <strong>{data.username}</strong> · {roles.find(r=>r.id===data.role)?.label}</p>
 <a className="button secondary" href={'/api/transcripts?id='+data.content.transcript.id}>PDF transkripti indir ve incele</a>
 <p className="field-label">ONAYLANACAK İÇERİĞİN SHA-256 ÖZETİ</p><code className="hash">{data.hash}</code><p className="field-label">TRANSKRİPT SHA-256</p><code className="hash">{data.content.transcript.hash}</code>
 <p className="field-label">DAVETİN BAĞLI OLDUĞU DİJİTAL KİMLİK</p><code className="hash" title={data.challenge.holder}>{short(data.challenge.holder)}</code>
 {walletOk===false&&<p className="error" role="alert">Bu tarayıcıda davetteki dijital kimlik bulunmuyor. Kimliğinizi kaydettiğiniz tarayıcıda açın veya panelde “Dijital kimliğim” bölümünden bu tarayıcıyı bağlayıp yeni davet isteyin.</p>}
 <label style={{display:'flex',gap:12,margin:'24px 0'}}><input style={{width:20}} type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Bu belge sürümünü inceledim. Hesabım ve rolüm adına, dijital kimliğimle onay beyanı imzalanmasını kabul ediyorum.</label>
 <button className="button primary" disabled={!consent||busy||walletOk!==true} onClick={sign}>{busy?'Sunum imzalanıyor ve doğrulanıyor…':'VC ile onayla'}</button></>:busy?<p>Davet kontrol ediliyor…</p>:null}</section></main>;
}
