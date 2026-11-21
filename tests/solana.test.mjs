import test from 'node:test';
import assert from 'node:assert/strict';
import * as sol from '../lib/solana.mjs';

const KENAN = 'ced187a6df5d4d95c9fcddd8c06c0682c090a18fa3dfe5e888b883e4600f2952';
const ZEYNEP = '6bfa240503fbde3c0ecb2b1f1b442c3e572949b7247493c225a13b439e9694c7';
const enc = new TextEncoder();
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const bstr = s => { const b = enc.encode(s); return new Uint8Array([...u32(b.length), ...b]); };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

// Builds an account exactly as Metaplex Core lays it out: asset | plugin header | plugins | registry.
function assetAccount({hash, collection = sol.SOLANA.collection, frozen = true, status = 'Geçerli', owner = sol.SOLANA.authority}) {
 const asset = cat([1], sol.b58decode(owner), [2], sol.b58decode(collection), bstr('Diploma 2026 · ' + hash.slice(0, 8)), bstr('https://ipfs.io/ipfs/x/meta.json'), [0]);
 const freeze = new Uint8Array([5, frozen ? 1 : 0]);
 const attrs = [['VC SHA-256', hash], ['Durum', status], ['Yıl', '2026'], ['Tür', 'Diploma']];
 const att = cat([6], u32(attrs.length), ...attrs.flatMap(([k, v]) => [bstr(k), bstr(v)]));
 const offF = asset.length + 9, offA = offF + freeze.length, reg = offA + att.length;
 return cat(asset, [3], u64(reg), freeze, att, [4], u32(2), [5, 2], u64(offF), [6, 2], u64(offA), u32(0));
}
const collectionAccount = (authority = sol.SOLANA.authority) => cat([5], sol.b58decode(authority), bstr('Örnek Üniversite - 2026 Mezunları'), bstr('u'), u32(1002), u32(1002));

test('base58 ve özet', async () => {
 assert.deepEqual(sol.b58decode('11111111111111111111111111111111'), new Uint8Array(32));
 assert.equal(sol.b58encode(enc.encode('hello world')), 'StV1DL6CwTryKyV');
 assert.equal(sol.b58encode(sol.b58decode(sol.SOLANA.program)), sol.SOLANA.program);
 assert.equal(sol.b58decode(sol.SOLANA.collection).length, 32);
 assert.equal(await sol.vcHash(' abc\n'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.throws(() => sol.b58decode('0OIl'));
});

test('NFT adresi Python aracıyla ve zincirdeki gerçek NFT’lerle aynı', async () => {
 // Değerler devnet'teki gerçek basımdan (tools/solana/diploma_nft.py, rapor-devnet.csv).
 assert.equal(await sol.assetAddress(KENAN), '4d2FjHUTnAb5zVyEPn9ws91bq4ZuYAqmr7sp8TpjUEop');
 assert.equal(await sol.assetAddress(ZEYNEP), 'Csshodkp3HKo6rue2wpB3Pmqkd5XVCLF6koZ418s84Dn');
 assert.notEqual(await sol.assetAddress(KENAN, sol.SOLANA.authority), '4d2FjHUTnAb5zVyEPn9ws91bq4ZuYAqmr7sp8TpjUEop');
 await assert.rejects(sol.assetAddress('xyz'));
});

test('Metaplex Core hesabı okunur ve diploma kuralları uygulanır', () => {
 const data = assetAccount({hash: KENAN});
 const nft = sol.parseAsset(data);
 assert.deepEqual(nft.updateAuthority, ['Collection', sol.SOLANA.collection]);
 assert.equal(nft.plugins.Attributes['VC SHA-256'], KENAN);
 assert.equal(nft.plugins.PermanentFreezeDelegate.frozen, true);
 const acc = d => ({owner: sol.SOLANA.program, data: d});
 assert.equal(sol.judgeAsset(acc(data), KENAN).state, 'valid');
 assert.equal(sol.judgeAsset(null, KENAN).state, 'missing');
 assert.equal(sol.judgeAsset(acc(data), ZEYNEP).state, 'invalid');                                         // başka belge
 assert.equal(sol.judgeAsset({owner: '11111111111111111111111111111111', data}, KENAN).state, 'invalid');  // başka program
 assert.match(sol.judgeAsset(acc(assetAccount({hash: KENAN, collection: sol.SOLANA.authority})), KENAN).message, /koleksiyona ait değil/);
 assert.match(sol.judgeAsset(acc(assetAccount({hash: KENAN, frozen: false})), KENAN).message, /devredilemez/);
 assert.equal(sol.judgeAsset(acc(assetAccount({hash: KENAN, status: 'İptal'})), KENAN).state, 'revoked');
 assert.throws(() => sol.parseAsset(collectionAccount()));
 assert.equal(sol.parseCollection(collectionAccount()).numMinted, 1002);
});

test('toplu kontrol koleksiyonu ve NFT’leri tek sorguda okur', async () => {
 const accounts = {[sol.SOLANA.collection]: collectionAccount(), [await sol.assetAddress(KENAN)]: assetAccount({hash: KENAN})};
 const calls = [];
 globalThis.fetch = async (url, init) => {
  const {method, params} = JSON.parse(init.body); calls.push({url, method, n: params[0].length});
  const value = params[0].map(a => accounts[a] ? {owner: a === sol.SOLANA.collection ? sol.SOLANA.program : sol.SOLANA.program, data: [Buffer.from(accounts[a]).toString('base64'), 'base64']} : null);
  return new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: {value}}), {status: 200});
 };
 const r = await sol.checkDiplomas([KENAN, ZEYNEP]);
 assert.deepEqual(calls, [{url: sol.SOLANA.rpc, method: 'getMultipleAccounts', n: 3}]);
 assert.equal(r.collection.name, 'Örnek Üniversite - 2026 Mezunları');
 assert.deepEqual(r.results.map(x => x.state), ['valid', 'missing']);
 assert.match(r.results[0].url, /^https:\/\/explorer\.solana\.com\/address\/4d2F.*cluster=devnet$/);
 accounts[sol.SOLANA.collection] = collectionAccount(sol.SOLANA.program);
 await assert.rejects(sol.checkDiplomas([KENAN]), /yetkilisi/);
 delete accounts[sol.SOLANA.collection];
 await assert.rejects(sol.checkDiplomas([KENAN]), /Koleksiyon/);
});
