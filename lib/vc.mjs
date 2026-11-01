// W3C Verifiable Credentials 2.0 secured with JOSE (vc+jwt / vp+jwt, ES256).
// Runs unchanged in the browser wallet, the Cloudflare Worker and Node tests (WebCrypto only).
const enc = new TextEncoder(), dec = new TextDecoder();
export const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
export const ISSUER_NAME = 'Diploma Zinciri — Örnek Üniversite (test)';
export const KEY_ALG = {name: 'ECDSA', namedCurve: 'P-256'};
const SIG_ALG = {name: 'ECDSA', hash: 'SHA-256'};
const ENVELOPE_PREFIX = 'data:application/vc+jwt,';
export const STATUS_LIST_SIZE = 131072; // bits (16 KB), Bitstring Status List minimum
export const APPROVER_VALIDITY_MS = 365 * 24 * 3600 * 1000;
const PRESENTATION_MAX_AGE_S = 600;

export class VcError extends Error {}
const fail = message => { throw new VcError(message); };

export function b64url(bytes) {
 const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
 let s = '';
 for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
 return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(value) {
 if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) fail('Geçersiz base64url verisi.');
 let s = value.replace(/-/g, '+').replace(/_/g, '/');
 while (s.length % 4) s += '=';
 return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const jsonB64 = value => b64url(enc.encode(JSON.stringify(value)));
const parseB64 = value => { try { return JSON.parse(dec.decode(fromB64url(value))); } catch { return fail('JWT içeriği okunamadı.'); } };
export async function sha256Hex(text) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
export const randomId = () => 'urn:uuid:' + crypto.randomUUID();

// ---- Keys and DIDs ----
export function publicJwk(jwk) {
 if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.x.length !== 43 || jwk.y.length !== 43 || 'd' in jwk) fail('Geçersiz P-256 açık anahtarı.');
 return {kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y};
}
export async function jwkThumbprint(jwk) {
 const p = publicJwk(jwk); // RFC 7638: required members in lexicographic order
 return b64url(await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify({crv: p.crv, kty: p.kty, x: p.x, y: p.y}))));
}
export const didJwk = jwk => 'did:jwk:' + jsonB64(publicJwk(jwk));
export function resolveDidJwk(did) {
 if (typeof did !== 'string' || !did.startsWith('did:jwk:') || did.length > 300) fail('Geçersiz did:jwk kimliği.');
 const jwk = publicJwk(parseB64(did.slice(8)));
 if (didJwk(jwk) !== did) fail('did:jwk kimliği kanonik değil.');
 return jwk;
}
export const holderKid = did => did + '#0';
export function universityDid(origin) {
 const u = new URL(origin);
 if (u.protocol !== 'https:') fail('Site adresi HTTPS olmalı.');
 return 'did:web:' + encodeURIComponent(u.host) + ':api:did'; // resolves to https://<host>/api/did/did.json
}
export const didDocumentUrl = origin => new URL(origin).origin + '/api/did/did.json';
export const statusListUrl = origin => new URL(origin).origin + '/api/status-list';
export async function universityKid(origin, jwk) { return universityDid(origin) + '#' + await jwkThumbprint(jwk); }
export async function didDocument(origin, jwk) {
 const id = universityDid(origin), kid = await universityKid(origin, jwk);
 return {'@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'], id,
 verificationMethod: [{id: kid, type: 'JsonWebKey2020', controller: id, publicKeyJwk: publicJwk(jwk)}],
 assertionMethod: [kid], authentication: [kid]};
}
// Picks the university key from a resolved DID document (no network access here).
export async function keyFromDidDocument(doc, origin) {
 const id = universityDid(origin);
 if (!doc || doc.id !== id || !Array.isArray(doc.verificationMethod)) fail('DID belgesi bu üniversiteye ait değil.');
 const method = doc.verificationMethod.find(m => m.controller === id && doc.assertionMethod?.includes(m.id));
 if (!method) fail('DID belgesinde düzenleme anahtarı yok.');
 const jwk = publicJwk(method.publicKeyJwk);
 if (method.id !== await universityKid(origin, jwk)) fail('DID belgesindeki anahtar kimliği tutarsız.');
 return jwk;
}
export async function importUniversityKey(json) {
 let parsed;
 try { parsed = typeof json === 'string' ? JSON.parse(json) : json; } catch { fail('Üniversite anahtarı yapılandırması okunamadı.'); }
 const pub = publicJwk(parsed?.publicKey);
 const priv = parsed?.privateKey;
 if (!priv || priv.x !== pub.x || priv.y !== pub.y || typeof priv.d !== 'string') fail('Üniversite anahtar çifti tutarsız.');
 const privateKey = await crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d}, KEY_ALG, false, ['sign']);
 return {privateKey, publicJwk: pub};
}
export async function generateUniversityKey() {
 const pair = await crypto.subtle.generateKey(KEY_ALG, true, ['sign', 'verify']);
 const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
 return {privateKey: {kty: 'EC', crv: 'P-256', x: privateKey.x, y: privateKey.y, d: privateKey.d}, publicKey: publicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey))};
}

// ---- JOSE ----
export async function signJwt(privateKey, header, payload) {
 const input = jsonB64(header) + '.' + jsonB64(payload);
 return input + '.' + b64url(await crypto.subtle.sign(SIG_ALG, privateKey, enc.encode(input)));
}
export function decodeJwt(jwt) {
 if (typeof jwt !== 'string' || jwt.length > 60000) fail('Geçersiz JWT.');
 const parts = jwt.trim().split('.');
 if (parts.length !== 3) fail('Geçersiz JWT biçimi.');
 const header = parseB64(parts[0]), payload = parseB64(parts[1]);
 if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Geçersiz JWT içeriği.');
 return {header, payload, signature: fromB64url(parts[2]), input: parts[0] + '.' + parts[1]};
}
export async function verifyJwt(jwt, jwk, typ) {
 const d = decodeJwt(jwt);
 if (d.header.alg !== 'ES256') fail('Desteklenmeyen imza algoritması.');
 if (typ && d.header.typ !== typ) fail('Beklenmeyen belge türü: ' + String(d.header.typ));
 if (d.signature.length !== 64) fail('İmza uzunluğu geçersiz.');
 const key = await crypto.subtle.importKey('jwk', publicJwk(jwk), KEY_ALG, false, ['verify']);
 if (!await crypto.subtle.verify(SIG_ALG, key, d.signature, enc.encode(d.input))) fail('Dijital imza doğrulanamadı.');
 return d;
}
export const envelope = jwt => ({'@context': VC_CONTEXT, id: ENVELOPE_PREFIX + jwt, type: 'EnvelopedVerifiableCredential'});
export function unwrapEnvelope(item) {
 if (item?.type !== 'EnvelopedVerifiableCredential' || typeof item.id !== 'string' || !item.id.startsWith(ENVELOPE_PREFIX)) fail('Sunumdaki kimlik bilgisi zarfı geçersiz.');
 return item.id.slice(ENVELOPE_PREFIX.length);
}
const issuerOf = vc => typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id;
const hasType = (vc, type) => Array.isArray(vc.type) && vc.type.includes('VerifiableCredential') && vc.type.includes(type);
function checkShape(vc, type) {
 if (!Array.isArray(vc['@context']) || vc['@context'][0] !== VC_CONTEXT) fail('VC bağlamı (@context) geçersiz.');
 if (!hasType(vc, type)) fail('Kimlik bilgisi türü beklenen türde değil: ' + type);
 if (!vc.credentialSubject || typeof vc.credentialSubject !== 'object') fail('Kimlik bilgisinin öznesi eksik.');
}
function checkValidity(vc, at) {
 const from = Date.parse(vc.validFrom), until = vc.validUntil ? Date.parse(vc.validUntil) : Infinity;
 if (!Number.isFinite(from) || from > at + 120000) fail('Kimlik bilgisi henüz geçerli değil.');
 if (until < at) fail('Kimlik bilgisinin süresi dolmuş.');
}

// ---- University-issued credentials ----
export async function issueCredential(key, origin, credential) {
 const issuer = universityDid(origin);
 const vc = {'@context': [VC_CONTEXT], ...credential, issuer: {id: issuer, name: ISSUER_NAME}};
 return signJwt(key.privateKey, {alg: 'ES256', typ: 'vc+jwt', kid: await universityKid(origin, key.publicJwk)}, vc);
}
export async function verifyIssuedCredential(jwt, {origin, universityJwk, type, at = Date.now()}) {
 const d = await verifyJwt(jwt, universityJwk, 'vc+jwt');
 if (d.header.kid !== await universityKid(origin, universityJwk)) fail('VC başka bir anahtarla düzenlenmiş.');
 const vc = d.payload;
 if (issuerOf(vc) !== universityDid(origin)) fail('VC bu üniversite tarafından düzenlenmemiş.');
 checkShape(vc, type);
 checkValidity(vc, at);
 return vc;
}
export const statusEntry = (origin, index) => ({id: statusListUrl(origin) + '#' + index, type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: String(index), statusListCredential: statusListUrl(origin)});
export function statusIndexOf(vc, origin) {
 const s = vc.credentialStatus;
 const index = Number(s?.statusListIndex);
 if (s?.type !== 'BitstringStatusListEntry' || s.statusPurpose !== 'revocation' || s.statusListCredential !== statusListUrl(origin) || !Number.isInteger(index) || index < 0 || index >= STATUS_LIST_SIZE) fail('VC iptal durumu bilgisi geçersiz.');
 return index;
}
export function approverCredential({id, holder, username, role, roleLabel, unit, statusIndex, origin, now = Date.now()}) {
 resolveDidJwk(holder);
 return {id, type: ['VerifiableCredential', 'AuthorizedApproverCredential'], name: 'Yetkili Onaycı Kimlik Bilgisi',
 validFrom: new Date(now).toISOString(), validUntil: new Date(now + APPROVER_VALIDITY_MS).toISOString(),
 credentialSubject: {id: holder, type: 'AuthorizedApprover', username, role, roleLabel, unit},
 credentialStatus: statusEntry(origin, statusIndex)};
}
export function diplomaCredential({id, code, content, version, documentHash, approvals, statusIndex, origin, now = Date.now()}) {
 return {id, type: ['VerifiableCredential', 'DiplomaCredential'], name: 'Diploma (test prototipi)',
 validFrom: new Date(now).toISOString(),
 credentialSubject: {type: 'Graduate', name: content.name, diploma: {code, university: content.university, faculty: content.faculty, program: content.program, version, documentHash, transcriptHash: content.transcript.hash}},
 evidence: approvals.map(a => ({type: 'DiplomaApprovalEvidence', role: a.role, approvedAt: a.at, approver: a.holder, approvalCredential: a.approvalCredentialId, presentationDigest: a.presentationDigest})),
 credentialStatus: statusEntry(origin, statusIndex)};
}

// ---- Bitstring Status List (revocation) ----
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function encodeStatusList(revoked) {
 const bits = new Uint8Array(STATUS_LIST_SIZE / 8);
 for (const i of revoked) if (Number.isInteger(i) && i >= 0 && i < STATUS_LIST_SIZE) bits[i >> 3] |= 0x80 >> (i & 7);
 return 'u' + b64url(await pipe(bits, new CompressionStream('gzip')));
}
export async function decodeStatusList(encoded) {
 if (typeof encoded !== 'string' || encoded[0] !== 'u' || encoded.length > 200000) fail('İptal listesi biçimi geçersiz.');
 const bits = await pipe(fromB64url(encoded.slice(1)), new DecompressionStream('gzip'));
 if (bits.length < STATUS_LIST_SIZE / 8) fail('İptal listesi çok kısa.');
 return bits;
}
export const statusBit = (bits, index) => (bits[index >> 3] & (0x80 >> (index & 7))) !== 0;
export async function statusListCredential(key, origin, revoked, now = Date.now()) {
 return issueCredential(key, origin, {id: statusListUrl(origin), type: ['VerifiableCredential', 'BitstringStatusListCredential'],
 validFrom: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString(),
 credentialSubject: {id: statusListUrl(origin) + '#list', type: 'BitstringStatusList', statusPurpose: 'revocation', encodedList: await encodeStatusList(revoked)}});
}
export async function isRevokedByList(listJwt, vc, {origin, universityJwk, at = Date.now()}) {
 const list = await verifyIssuedCredential(listJwt, {origin, universityJwk, type: 'BitstringStatusListCredential', at});
 if (list.id !== statusListUrl(origin) || list.credentialSubject.statusPurpose !== 'revocation') fail('İptal listesi beklenen liste değil.');
 return statusBit(await decodeStatusList(list.credentialSubject.encodedList), statusIndexOf(vc, origin));
}

// ---- Holder side (browser wallet) ----
export async function enrollmentProof({privateKey, did, nonce, audience, username, now = Date.now()}) {
 return signJwt(privateKey, {alg: 'ES256', typ: 'JWT', kid: holderKid(did)}, {iss: did, aud: audience, nonce, username, purpose: 'diploma-zinciri-wallet-enrollment', iat: Math.floor(now / 1000)});
}
export async function verifyEnrollmentProof(jwt, {did, nonce, audience, username, now = Date.now()}) {
 const jwk = resolveDidJwk(did);
 const d = await verifyJwt(jwt, jwk, 'JWT');
 const p = d.payload;
 if (d.header.kid !== holderKid(did) || p.iss !== did || p.aud !== audience || p.nonce !== nonce || p.username !== username || p.purpose !== 'diploma-zinciri-wallet-enrollment' || Math.abs(now / 1000 - p.iat) > PRESENTATION_MAX_AGE_S) fail('Anahtar sahipliği kanıtı geçersiz.');
 return jwk;
}
export const approvalSubject = ({caseId, version, documentHash, transcriptHash, role}) => ({id: 'urn:diploma-zinciri:case:' + caseId, caseId, version, documentHash, transcriptHash, role, decision: 'approved'});
export async function createApprovalPresentation({privateKey, did, approverJwt, approval, nonce, audience, now = Date.now()}) {
 const kid = holderKid(did), at = new Date(now).toISOString();
 const approvalJwt = await signJwt(privateKey, {alg: 'ES256', typ: 'vc+jwt', kid}, {'@context': [VC_CONTEXT], id: randomId(),
 type: ['VerifiableCredential', 'DiplomaApprovalCredential'], name: 'Diploma onay beyanı', issuer: did, validFrom: at,
 credentialSubject: approvalSubject(approval)});
 return signJwt(privateKey, {alg: 'ES256', typ: 'vp+jwt', kid}, {'@context': [VC_CONTEXT], type: ['VerifiablePresentation'], holder: did,
 verifiableCredential: [envelope(approverJwt), envelope(approvalJwt)], nonce, aud: audience, iat: Math.floor(now / 1000)});
}

// ---- Verifier side ----
// Verifies a unit approval presentation. `fresh:false` re-checks a stored presentation at the time it was made.
export async function verifyApprovalPresentation(vpJwt, {origin, universityJwk, expected, isRevoked = async (id, at) => false, now = Date.now(), fresh = true}) {
 const outer = decodeJwt(vpJwt);
 const holder = outer.payload.holder;
 const holderJwk = resolveDidJwk(holder);
 const vp = (await verifyJwt(vpJwt, holderJwk, 'vp+jwt')).payload;
 if (outer.header.kid !== holderKid(holder)) fail('Sunum başka bir anahtarla imzalanmış.');
 if (!Array.isArray(vp['@context']) || vp['@context'][0] !== VC_CONTEXT || !vp.type?.includes('VerifiablePresentation')) fail('Doğrulanabilir sunum biçimi geçersiz.');
 if (vp.aud !== new URL(origin).origin || vp.nonce !== expected.nonce) fail('Sunum bu davete ait değil.');
 const at = vp.iat * 1000;
 if (!Number.isInteger(vp.iat) || (fresh && Math.abs(now - at) > PRESENTATION_MAX_AGE_S * 1000)) fail('Sunumun zamanı geçersiz veya süresi dolmuş.');
 if (expected.holder && holder !== expected.holder) fail('Sunum, davet edilen yetkilinin dijital kimliğiyle imzalanmamış.');
 if (!Array.isArray(vp.verifiableCredential) || vp.verifiableCredential.length !== 2) fail('Sunumda iki kimlik bilgisi bulunmalı.');
 const [approverJwt, approvalJwt] = vp.verifiableCredential.map(unwrapEnvelope);
 const approver = await verifyIssuedCredential(approverJwt, {origin, universityJwk, type: 'AuthorizedApproverCredential', at});
 const s = approver.credentialSubject;
 if (s.id !== holder || s.username !== expected.username || s.role !== expected.role) fail('Yetkili Onaycı VC’si bu hesap veya rol için düzenlenmemiş.');
 if (expected.approverCredentialId && approver.id !== expected.approverCredentialId) fail('Davet başka bir Yetkili Onaycı VC’sine bağlı.');
 if (await isRevoked(approver.id, at)) fail('Yetkili Onaycı VC’si iptal edilmiş.');
 const approvalDecoded = await verifyJwt(approvalJwt, holderJwk, 'vc+jwt');
 const approval = approvalDecoded.payload;
 if (approvalDecoded.header.kid !== holderKid(holder) || issuerOf(approval) !== holder) fail('Onay beyanı yetkilinin kendi kimliğiyle düzenlenmemiş.');
 checkShape(approval, 'DiplomaApprovalCredential');
 checkValidity(approval, at);
 if (JSON.stringify(approval.credentialSubject) !== JSON.stringify(approvalSubject(expected))) fail('Onay beyanı bu belge sürümüyle eşleşmiyor.');
 return {holder, approverCredentialId: approver.id, approvalCredentialId: approval.id, at: new Date(at).toISOString(), presentationDigest: await sha256Hex(vpJwt)};
}
