import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as chain from '../lib/chain.mjs';
// Vectors produced by an independent Python implementation (Keccak-256 selectors, Solidity ABI rules, SHA-256 Merkle).
const v = JSON.parse(readFileSync(new URL('./chain-vectors.json', import.meta.url), 'utf8'));

test('ABI kodlaması bağımsız referansla birebir aynı', () => {
 assert.equal(chain.encodeMintBatch(v.ids.map(BigInt), v.hashes), v.mint);
 assert.equal(chain.encodeAnchor(v.root, 7), v.anchor);
 assert.equal(chain.encodeRevoke(BigInt(v.ids[0])), v.revoke);
 assert.equal(chain.encodeNftVerify(BigInt(v.ids[0]), v.hashes[0]), v.nftVerify);
 assert.equal(chain.encodeAnchorVerify(v.leaves[6], v.proofs[6]), v.anchorVerify);
 assert.throws(() => chain.encodeMintBatch([1n], []));
 assert.throws(() => chain.encodeMintBatch(Array(61).fill(1n), Array(61).fill(v.hashes[0])));
 assert.throws(() => chain.encodeAnchor(v.root, 0));
});

test('Merkle ağacı ve kanıtları sözleşmenin algoritmasıyla aynı', async () => {
 const t = await chain.buildMerkleTree(v.leaves);
 assert.equal(t.root, v.root);
 assert.deepEqual(t.proofs, v.proofs);
 for (let i = 0; i < v.leaves.length; i++) assert.equal(await chain.rootFromProof(v.leaves[i], t.proofs[i]), v.root);
 assert.equal((await chain.buildMerkleTree([v.leaves[0]])).root, v.root1);
 assert.equal((await chain.buildMerkleTree(v.leaves.slice(0, 2))).root, v.root2);
 // A changed leaf or proof no longer reaches the root.
 const forged = v.leaves[0].replace(/^./, c => (c === 'a' ? 'b' : 'a'));
 assert.notEqual(await chain.rootFromProof(forged, t.proofs[0]), v.root);
 await assert.rejects(chain.buildMerkleTree([v.leaves[0], v.leaves[0]]));
 // 200 leaves: every proof verifies and is at most 8 hashes long.
 const many = await Promise.all(Array.from({length: 200}, (_, i) => chain.sha256Hex('d' + i)));
 const big = await chain.buildMerkleTree(many);
 for (let i = 0; i < 200; i += 17) assert.equal(await chain.rootFromProof(many[i], big.proofs[i]), big.root);
 assert.ok(big.proofs.every(p => p.length <= 8));
});

test('diploma kodu ile token numarası birbirine çevrilir; sözleşme yanıtları çözülür', () => {
 const id = chain.tokenIdFromCode('TEST-ACE34182340F4EE8B221');
 assert.equal(id, BigInt('0xACE34182340F4EE8B221'));
 assert.equal(chain.codeFromTokenId(id), 'TEST-ACE34182340F4EE8B221');
 assert.equal(chain.codeFromTokenId(1n), 'TEST-00000000000000000001');
 assert.throws(() => chain.tokenIdFromCode('TEST-xyz'));
 assert.deepEqual(chain.decodeNftVerify('0x' + chain.word(1) + chain.word(1) + chain.word(0)), {registered: true, matches: true, revoked: false});
 assert.deepEqual(chain.decodeAnchorVerify('0x' + chain.word(1) + chain.word(1) + chain.word(3)), {registered: true, matches: true, revoked: true, batchIndex: 3});
 assert.throws(() => chain.decodeNftVerify('0x1234'));
 assert.equal(chain.feeEth(21000n, 10n ** 9n), 0.000021);
});
