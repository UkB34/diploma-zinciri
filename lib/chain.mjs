// Sepolia integration without third-party libraries: ABI encoding, hashing and JSON-RPC.
// Shared by the browser, the Cloudflare Worker and Node tests. Function selectors were computed with
// Keccak-256 offline (see tests/chain.test.mjs for the reference vectors).
export const CHAIN_ID = 11155111;
export const CHAIN_ID_HEX = '0xaa36a7';
export const EXPLORER = 'https://sepolia.etherscan.io';
export const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const MAX_NFT_BATCH = 150; // must match DiplomaNFT.MAX_BATCH; keeps each tx under the 16.7M gas cap
export const SELECTORS = {
 mintBatch: '8a5446d4', // mintBatch(uint256[],bytes32[])
 revoke: '20c5429b', // revoke(uint256)
 nftVerify: '1d97ce31', // verify(uint256,bytes32)
 issuers: '38a7543e', // issuers(address)
 issuerDid: 'e186794a', // issuerDid()
};
const HEX32 = /^[0-9a-f]{64}$/;
export const isAddress = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const isTxHash = h => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
export const strip0x = h => (h.startsWith('0x') ? h.slice(2) : h).toLowerCase();
export function hex32(value) {
 const h = strip0x(String(value));
 if (!HEX32.test(h)) throw Error('32 baytlık değer bekleniyordu.');
 return h;
}
export function word(n) {
 const v = BigInt(n);
 if (v < 0n || v >= 1n << 256n) throw Error('uint256 aralığı dışında.');
 return v.toString(16).padStart(64, '0');
}
const addressWord = a => { if (!isAddress(a)) throw Error('Geçersiz adres.'); return strip0x(a).padStart(64, '0'); };

// Diploma code TEST-<20 hex> → tokenId (80-bit number). Same code can never be minted twice.
export function tokenIdFromCode(code) {
 const m = /^TEST-([A-F0-9]{20})$/.exec(String(code));
 if (!m) throw Error('Geçersiz diploma kodu.');
 return BigInt('0x' + m[1]);
}
export function codeFromTokenId(id) {
 const v = BigInt(id);
 if (v < 0n || v >= 1n << 80n) throw Error('Geçersiz token numarası.');
 return 'TEST-' + v.toString(16).toUpperCase().padStart(20, '0');
}

// ---- Calldata ----
const array = items => word(items.length) + items.join('');
export function encodeMintBatch(tokenIds, hashes) {
 if (!tokenIds.length || tokenIds.length !== hashes.length || tokenIds.length > MAX_NFT_BATCH) throw Error('Geçersiz NFT paketi.');
 const ids = tokenIds.map(word), hs = hashes.map(hex32);
 const first = 64, second = first + 32 * (1 + ids.length);
 return '0x' + SELECTORS.mintBatch + word(first) + word(second) + array(ids) + array(hs);
}
export const encodeRevoke = tokenId => '0x' + SELECTORS.revoke + word(tokenId);
export const encodeNftVerify = (tokenId, hash) => '0x' + SELECTORS.nftVerify + word(tokenId) + hex32(hash);
export const encodeIssuers = address => '0x' + SELECTORS.issuers + addressWord(address);

export function decodeWords(result) {
 const h = strip0x(result || '0x');
 if (h.length % 64) throw Error('Beklenmeyen sözleşme yanıtı.');
 return Array.from({length: h.length / 64}, (_, i) => BigInt('0x' + h.slice(i * 64, i * 64 + 64)));
}
export function decodeNftVerify(result) {
 const [registered, matches, revoked] = decodeWords(result);
 if (revoked === undefined) throw Error('Beklenmeyen sözleşme yanıtı.');
 return {registered: registered === 1n, matches: matches === 1n, revoked: revoked === 1n};
}

// ---- Hashing ----
const hexOf = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data) {
 const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
 return hexOf(await crypto.subtle.digest('SHA-256', bytes));
}
// Leaf = SHA-256 of the diploma VC JWT exactly as issued (also stored by DiplomaNFT).
export const vcHash = jwt => sha256Hex(String(jwt).trim());


// ---- JSON-RPC ----
export async function rpc(url, method, params, fetcher = fetch) {
 const r = await fetcher(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(15000)});
 if (!r.ok) throw Error('Sepolia düğümü yanıt vermedi (' + r.status + ').');
 const d = await r.json();
 if (d.error) { const e = Error(d.error.message || 'RPC hatası'); e.data = d.error.data; throw e; }
 return d.result;
}
export const ethCall = (url, to, data, from, fetcher) => rpc(url, 'eth_call', [from ? {from, to, data} : {to, data}, 'latest'], fetcher);
export const txUrl = hash => EXPLORER + '/tx/' + hash;
export const addressUrl = address => EXPLORER + '/address/' + address;
export const tokenUrl = (contract, tokenId) => EXPLORER + '/nft/' + contract + '/' + BigInt(tokenId).toString();
export const hexToBigInt = h => BigInt(h || '0x0');
export function feeEth(gasUsed, gasPrice) {
 const wei = BigInt(gasUsed) * BigInt(gasPrice);
 return Number(wei / 10n ** 9n) / 1e9; // ETH with gwei precision
}
