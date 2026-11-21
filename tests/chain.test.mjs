import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as chain from '../lib/chain.mjs';
// Vectors produced by an independent Python implementation (Keccak-256 selectors, Solidity ABI rules).
const v = JSON.parse(readFileSync(new URL('./chain-vectors.json', import.meta.url), 'utf8'));

test('ABI kodlaması bağımsız referansla birebir aynı', () => {
 assert.equal(chain.encodeMintBatch(v.ids.map(BigInt), v.hashes), v.mint);
 assert.equal(chain.encodeRevoke(BigInt(v.ids[0])), v.revoke);
 assert.equal(chain.encodeNftVerify(BigInt(v.ids[0]), v.hashes[0]), v.nftVerify);
 assert.throws(() => chain.encodeMintBatch([1n], []));
 assert.throws(() => chain.encodeMintBatch(Array(151).fill(1n), Array(151).fill(v.hashes[0])));
});

test('VC özeti SHA-256; diploma kodu ile token numarası birbirine çevrilir; sözleşme yanıtları çözülür', async () => {
 assert.equal(await chain.vcHash(' abc\n'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const id = chain.tokenIdFromCode('TEST-ACE34182340F4EE8B221');
 assert.equal(id, BigInt('0xACE34182340F4EE8B221'));
 assert.equal(chain.codeFromTokenId(id), 'TEST-ACE34182340F4EE8B221');
 assert.equal(chain.codeFromTokenId(1n), 'TEST-00000000000000000001');
 assert.throws(() => chain.tokenIdFromCode('TEST-xyz'));
 assert.deepEqual(chain.decodeNftVerify('0x' + chain.word(1) + chain.word(1) + chain.word(0)), {registered: true, matches: true, revoked: false});
 assert.throws(() => chain.decodeNftVerify('0x1234'));
 assert.equal(chain.feeEth(21000n, 10n ** 9n), 0.000021);
});
