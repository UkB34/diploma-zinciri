// Solana (Metaplex Core) diploma koleksiyonu: tarayıcıda ve sunucuda çalışan doğrulama kütüphanesi.
// NFT'ler tools/solana/diploma_nft.py ile basılır. Bir NFT'nin adresi, diploma VC'sinin SHA-256 özetinden ve koleksiyon
// adresinden türetildiği için elinde diploma dosyası olan herkes adresi hesaplayıp zincirden doğrudan okuyabilir.

export const SOLANA = {
 cluster: 'devnet',
 rpc: 'https://api.devnet.solana.com',
 collection: 'DsiuZbshd7sBqCuR2hCGiMcBR6g4arWFDBDAmUVb2Kis', // Örnek Üniversite - 2026 Mezunları
 authority: 'GFdrrpvhgxQnGkB6hDyqNNYDcmFHmDKdLn4f4sqrzaXp', // üniversite cüzdanı (koleksiyonun yetkilisi)
 program: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d', // Metaplex Core
};
const SEED_DOMAIN = 'diploma-zinciri:asset:v1:';

// ---- base58 ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58encode(bytes) {
 let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
 let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
 for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
 return s;
}
export function b58decode(s) {
 let n = 0n;
 for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw Error('Geçersiz base58 karakteri.'); n = n * 58n + BigInt(i); }
 const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
 for (const c of s) { if (c !== '1') break; out.unshift(0); }
 return Uint8Array.from(out);
}

// ---- hashing ----
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data) {
 return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));
}
// Sitedeki ve Python aracındaki özetle aynı: SHA-256(kırpılmış JWT)
export const vcHash = jwt => sha256Hex(String(jwt).trim());
const fromHex = h => Uint8Array.from(h.match(/../g).map(b => parseInt(b, 16)));

// ---- NFT adresi: ed25519( SHA-256( alan || koleksiyon || VC özeti ) ) ----
const PKCS8_ED25519 = fromHex('302e020100300506032b657004220420');
export async function assetAddress(vcHashHex, collection = SOLANA.collection) {
 if (!/^[0-9a-f]{64}$/.test(vcHashHex)) throw Error('VC özeti 64 haneli onaltılık olmalı.');
 const domain = new TextEncoder().encode(SEED_DOMAIN), coll = b58decode(collection);
 const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...domain, ...coll, ...fromHex(vcHashHex)])));
 let key;
 try { key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_ED25519, ...seed]), {name: 'Ed25519'}, true, ['sign']); }
 catch { throw Error('Bu tarayıcı Ed25519 desteklemiyor. Güncel Chrome, Edge, Firefox veya Safari kullanın.'); }
 const {x} = await crypto.subtle.exportKey('jwk', key);
 return b58encode(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - x.length % 4) % 4)), c => c.charCodeAt(0)));
}

// ---- Metaplex Core hesap verisini okuma ----
class Reader {
 constructor(b, at = 0) { this.b = b; this.at = at; }
 take(n) { if (this.at + n > this.b.length) throw Error('Hesap verisi beklenenden kısa.'); const v = this.b.subarray(this.at, this.at + n); this.at += n; return v; }
 u8() { return this.take(1)[0]; }
 u32() { const v = this.take(4); return (v[0] | v[1] << 8 | v[2] << 16 | v[3] << 24) >>> 0; }
 u64() { const lo = this.u32(), hi = this.u32(); return hi * 2 ** 32 + lo; }
 key() { return b58encode(this.take(32)); }
 str() { return new TextDecoder().decode(this.take(this.u32())); }
 authority() { const t = this.u8(); return t === 3 ? ['Address', this.key()] : [['None', 'Owner', 'UpdateAuthority'][t], null]; }
}
export function parseAsset(data) {
 const r = new Reader(data);
 if (r.u8() !== 1) throw Error('Bu hesap bir Metaplex Core NFT’si değil.');
 const out = {owner: r.key()};
 const ua = r.u8(); out.updateAuthority = [['None', 'Address', 'Collection'][ua], ua === 1 || ua === 2 ? r.key() : null];
 out.name = r.str(); out.uri = r.str();
 if (r.u8()) r.u64();
 out.plugins = {};
 if (r.at < data.length) {
  if (r.u8() !== 3) throw Error('Eklenti başlığı bulunamadı.');
  const reg = new Reader(data, r.u64());
  if (reg.u8() !== 4) throw Error('Eklenti kaydı bulunamadı.');
  const n = reg.u32(), records = [];
  for (let i = 0; i < n; i++) records.push([reg.u8(), reg.authority(), reg.u64()]);
  for (const [type, , offset] of records) {
   const p = new Reader(data, offset);
   if (p.u8() !== type) throw Error('Eklenti verisi kayıtla uyuşmuyor.');
   if (type === 5) out.plugins.PermanentFreezeDelegate = {frozen: !!p.u8()};
   else if (type === 6) { const attrs = {}, m = p.u32(); for (let i = 0; i < m; i++) { const k = p.str(); attrs[k] = p.str(); } out.plugins.Attributes = attrs; }
  }
 }
 return out;
}
export function parseCollection(data) {
 const r = new Reader(data);
 if (r.u8() !== 5) throw Error('Bu hesap bir Metaplex Core koleksiyonu değil.');
 return {updateAuthority: r.key(), name: r.str(), uri: r.str(), numMinted: r.u32(), currentSize: r.u32()};
}

// ---- RPC ----
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function getAccounts(addresses, rpc = SOLANA.rpc) {
 const out = {};
 for (let i = 0; i < addresses.length; i += 100) {
  const chunk = addresses.slice(i, i + 100);
  let body;
  for (let attempt = 0; ; attempt++) {
   try {
    const res = await fetch(rpc, {method: 'POST', headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [chunk, {encoding: 'base64', commitment: 'confirmed'}]})});
    body = await res.json();
    if (!res.ok || body.error) throw Error(body.error?.message || 'Solana düğümü ' + res.status + ' döndü.');
    break;
   } catch (e) { if (attempt >= 2) throw Error('Solana’ya ulaşılamadı: ' + e.message); await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
  }
  body.result.value.forEach((v, j) => { out[chunk[j]] = v ? {owner: v.owner, data: b64(v.data[0])} : null; });
 }
 return out;
}

export const explorerUrl = (address, cluster = SOLANA.cluster) => `https://explorer.solana.com/address/${address}` + (cluster === 'mainnet' ? '' : `?cluster=${cluster}`);

// Bir hesabın, verilen VC özetine ait geçerli diploma NFT'si olup olmadığını söyler.
export function judgeAsset(account, hash, collection = SOLANA.collection, program = SOLANA.program) {
 if (!account) return {state: 'missing', message: 'Bu diploma Solana koleksiyonunda kayıtlı değil.'};
 try {
  if (account.owner !== program) throw Error('Hesap Metaplex Core’a ait değil.');
  const nft = parseAsset(account.data);
  if (nft.updateAuthority[0] !== 'Collection' || nft.updateAuthority[1] !== collection) throw Error('NFT bu koleksiyona ait değil.');
  const attrs = nft.plugins.Attributes || {};
  if (attrs['VC SHA-256'] !== hash) throw Error('NFT’deki özet bu belgeyle eşleşmiyor.');
  if (!nft.plugins.PermanentFreezeDelegate?.frozen) throw Error('NFT devredilemez değil.');
  if (attrs['Durum'] !== 'Geçerli') return {state: 'revoked', nft, message: 'Zincirdeki durum: ' + (attrs['Durum'] || 'bilinmiyor')};
  return {state: 'valid', nft, message: 'Solana’da kayıtlı, özet eşleşiyor, devredilemez.'};
 } catch (e) { return {state: 'invalid', message: e.message}; }
}

// Koleksiyonu ve verilen özetlerin NFT'lerini tek seferde okur ve her biri için sonuç döndürür.
export async function checkDiplomas(hashes, {collection = SOLANA.collection, authority = SOLANA.authority, rpc = SOLANA.rpc, onProgress} = {}) {
 const addresses = [];
 for (let i = 0; i < hashes.length; i++) { addresses.push(await assetAddress(hashes[i], collection)); if (onProgress && i % 50 === 49) onProgress(i + 1, hashes.length); }
 const accounts = await getAccounts([collection, ...addresses], rpc);
 if (!accounts[collection]) throw Error('Koleksiyon zincirde bulunamadı.');
 const coll = parseCollection(accounts[collection].data);
 if (coll.updateAuthority !== authority) throw Error('Koleksiyonun yetkilisi üniversite cüzdanı değil.');
 return {collection: {address: collection, ...coll, url: explorerUrl(collection)},
  results: hashes.map((h, i) => ({hash: h, address: addresses[i], url: explorerUrl(addresses[i]), ...judgeAsset(accounts[addresses[i]], h, collection)}))};
}
