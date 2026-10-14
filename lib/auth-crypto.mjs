const hex=(bytes)=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function hashToken(value){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256));}
export function timingEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export function randomToken(){return hex(crypto.getRandomValues(new Uint8Array(32)));}
export function validOrigin(request){try{const origin=request.headers.get('origin');const host=request.headers.get('x-forwarded-host')||request.headers.get('host')||new URL(request.url).host;return !!origin&&new URL(origin).host===host;}catch{return false;}}
export function sessionCookie(token,maxAge=28800){return `dz_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;}
export function readSessionCookie(cookie){const token=(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dz_session='))?.slice(11);return token&&/^[a-f0-9]{64}$/.test(token)?token:null;}
