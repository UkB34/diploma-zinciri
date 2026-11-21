# python -m unittest tools/solana/test_diploma_nft.py
import base64, hashlib, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import diploma_nft as dz
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

class T(unittest.TestCase):
    def test_base58(self):
        self.assertEqual(dz.b58decode(dz.SYSTEM_PROGRAM), b"\0" * 32)
        self.assertEqual(len(dz.b58decode(dz.CORE_PROGRAM)), 32)
        for b in [b"", b"\0\0\x01", bytes(range(64))]: self.assertEqual(dz.b58decode(dz.b58encode(b)), b)
        self.assertEqual(dz.b58encode(b"hello world"), "StV1DL6CwTryKyV")
        self.assertEqual(dz.b58encode(dz.b58decode(dz.CORE_PROGRAM)), dz.CORE_PROGRAM)

    def test_wallet_formats(self):
        kp = dz.Keypair(bytes(range(32)))
        d = Path(__file__).parent / "_tmp_key.txt"
        try:
            d.write_text(dz.b58encode(bytes(range(32)) + kp.public)); self.assertEqual(dz.load_wallet(str(d)).address, kp.address)
            d.write_text(json.dumps(list(bytes(range(32)) + kp.public))); self.assertEqual(dz.load_wallet(str(d)).address, kp.address)
            d.write_text(dz.b58encode(bytes(range(32)) + b"\1" * 32))
            with self.assertRaises(SystemExit): dz.load_wallet(str(d))
        finally: d.unlink()

    def test_borsh(self):
        self.assertEqual(dz.create_collection_data("AB", "u"), b"\x01" + b"\x02\0\0\0AB" + b"\x01\0\0\0u" + b"\0")
        data = dz.create_asset_data("N", "U", [dz.permanent_freeze_plugin(True), dz.attributes_plugin([("k", "v")])])
        self.assertEqual(data, b"\0" + b"\0" + b"\x01\0\0\0N" + b"\x01\0\0\0U" + b"\x01" + b"\x02\0\0\0" +
                         b"\x05\x01\x00" + b"\x06" + b"\x01\0\0\0" + b"\x01\0\0\0k" + b"\x01\0\0\0v" + b"\x00")
        self.assertEqual(dz.shortvec(0), b"\0"); self.assertEqual(dz.shortvec(127), b"\x7f"); self.assertEqual(dz.shortvec(128), b"\x80\x01"); self.assertEqual(dz.shortvec(16384), b"\x80\x80\x01")

    def test_transaction_layout(self):
        payer, coll, asset = dz.Keypair(b"\1" * 32), dz.Keypair(b"\2" * 32), dz.Keypair(b"\3" * 32)
        bh = dz.b58encode(b"\7" * 32)
        ix = dz.asset_ix(payer, coll.address, asset, "Diploma 2026 · 0123abcd", "https://ipfs.io/ipfs/" + "b" * 59 + "/meta/" + "0" * 64 + ".json",
                         dz.chain_attrs({"hash": "ab" * 32, "type": "Temsili", "issuer": "did:web:diploma-zinciri.bllufuk04.workers.dev:api:did"}, 2026))
        msg, signers = dz.compile_message(payer.address, dz.budget_ixs(20000) + [ix], bh)
        tx = dz.sign_tx((msg, signers), [payer, asset])
        self.assertLess(len(tx), 1232)
        self.assertEqual(signers, [payer.address, asset.address])
        # header: 2 signers (both writable), readonly unsigned = Core, System, ComputeBudget
        self.assertEqual(msg[:3], bytes([2, 0, 3]))
        n = msg[3]; keys = [dz.b58encode(msg[4 + 32 * i: 36 + 32 * i]) for i in range(n)]
        self.assertEqual(keys[:3], [payer.address, asset.address, coll.address])      # signers first, then writable collection
        self.assertEqual(set(keys[3:]), {dz.CORE_PROGRAM, dz.SYSTEM_PROGRAM, dz.COMPUTE_BUDGET})
        self.assertEqual(msg[4 + 32 * n: 36 + 32 * n], b"\7" * 32)
        # Signatures verify over the message.
        self.assertEqual(tx[0], 2)
        Ed25519PublicKey.from_public_bytes(payer.public).verify(tx[1:65], msg)
        Ed25519PublicKey.from_public_bytes(asset.public).verify(tx[65:129], msg)
        with self.assertRaises(ValueError): dz.sign_tx((msg, signers), [payer])
        # Instruction account indices map back to the CreateV1 account order.
        at = 36 + 32 * n; ixs = msg[at]; at += 1
        for _ in range(ixs - 1): at += 1; la = msg[at]; at += 1 + la; ld = msg[at]; at += 1 + ld
        self.assertEqual(keys[msg[at]], dz.CORE_PROGRAM); at += 1
        la = msg[at]; idx = list(msg[at + 1: at + 1 + la])
        self.assertEqual([keys[i] for i in idx], [asset.address, coll.address, payer.address, payer.address, dz.CORE_PROGRAM, dz.CORE_PROGRAM, dz.SYSTEM_PROGRAM, dz.CORE_PROGRAM])

    def test_deterministic_address(self):
        c = dz.b58decode(dz.Keypair(b"\2" * 32).address)
        a1, a2 = dz.asset_keypair(c, "ab" * 32), dz.asset_keypair(c, "ab" * 32)
        self.assertEqual(a1.address, a2.address)
        self.assertNotEqual(a1.address, dz.asset_keypair(c, "cd" * 32).address)
        self.assertNotEqual(a1.address, dz.asset_keypair(b"\9" * 32, "ab" * 32).address)

    def test_parse_asset_as_program_writes_it(self):
        owner, coll = dz.Keypair(b"\1" * 32), dz.Keypair(b"\2" * 32)
        attrs = [("VC SHA-256", "ab" * 32), ("Durum", "Geçerli")]
        asset = b"\x01" + owner.public + b"\x02" + coll.public + dz.bstr("Diploma 2026 · abababab") + dz.bstr("https://x/y.json") + b"\0"
        h = len(asset)
        freeze = b"\x05\x01"; att = b"\x06" + dz.u32(len(attrs)) + b"".join(dz.bstr(k) + dz.bstr(v) for k, v in attrs)
        off_f = h + 9; off_a = off_f + len(freeze); reg_off = off_a + len(att)
        registry = b"\x04" + dz.u32(2) + b"\x05\x02" + dz.u64(off_f) + b"\x06\x02" + dz.u64(off_a) + dz.u32(0)
        data = asset + b"\x03" + dz.u64(reg_off) + freeze + att + registry
        self.assertEqual(len(data), dz.asset_size("Diploma 2026 · abababab", "https://x/y.json", attrs))
        p = dz.parse_asset(data)
        self.assertEqual(p["owner"], owner.address); self.assertEqual(p["updateAuthority"], ("Collection", coll.address))
        self.assertEqual(p["plugins"]["Attributes"]["VC SHA-256"], "ab" * 32); self.assertEqual(p["plugins"]["Attributes"]["Durum"], "Geçerli")
        self.assertTrue(p["plugins"]["PermanentFreezeDelegate"]["frozen"])
        with self.assertRaises(ValueError): dz.parse_asset(b"\x05" + data[1:])
        coll_data = b"\x05" + owner.public + dz.bstr("Örnek Üniversite - 2026 Mezunları") + dz.bstr("u") + dz.u32(3) + dz.u32(3)
        self.assertEqual(dz.parse_collection(coll_data)["numMinted"], 3)

    def test_load_diplomas_and_hash_matches_site(self):
        tmp = Path(__file__).parent / "_tmp_dip"; tmp.mkdir(exist_ok=True)
        try:
            enc = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()
            jwt = enc({"alg": "ES256"}) + "." + enc({"type": ["VerifiableCredential", "DiplomaCredential"], "issuer": {"id": "did:web:x"}, "credentialSubject": {"representative": True}}) + ".sig"
            (tmp / "a.jwt").write_text(jwt + "\n"); (tmp / "b.jwt").write_text(jwt)
            ds = dz.load_diplomas(tmp)
            self.assertEqual(len(ds), 1); self.assertEqual(ds[0]["hash"], hashlib.sha256(jwt.encode()).hexdigest())
            self.assertEqual(ds[0]["type"], "Temsili"); self.assertEqual(ds[0]["issuer"], "did:web:x")
        finally:
            for f in tmp.iterdir(): f.unlink()
            tmp.rmdir()

if __name__ == "__main__": unittest.main()
