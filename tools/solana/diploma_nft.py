#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Diploma Zinciri - Solana NFT koleksiyonu (Metaplex Core)

Bir klasördeki diploma VC dosyalarının (*.jwt) her birini, tek bir koleksiyonun ayrı bir parçası (NFT) olarak
Solana'ya basar. Liste zincire girmez; yalnızca bu kodun girdisidir. Bütün işlemler tek onayla, tek turda imzalanır.

  python diploma_nft.py bas     --klasor DIPLOMALAR --anahtar cuzdan-anahtari.txt --ag devnet
  python diploma_nft.py dogrula --klasor DIPLOMALAR --ag devnet

Gereken tek paket: cryptography  (pip install cryptography)

Her NFT:
  - Koleksiyon: "<Üniversite> - <Yıl> Mezunları" (Metaplex Core koleksiyonu, yetkili = üniversite cüzdanı)
  - Devredilemez: PermanentFreezeDelegate (frozen = true)
  - Zincir üstü özellikler (Attributes): VC SHA-256, Durum, Yıl, Tür, Düzenleyen
  - İçerik: IPFS'te metadata JSON + mezuniyet belgesinin kendisi (imzalı diploma VC dosyası) + rozet görseli
  - Adres: VC özetinden ve koleksiyon adresinden türetilir. Böylece elinde diploma dosyası olan herkes,
    hiçbir listeye bakmadan NFT'nin adresini hesaplayıp zincirden kontrol edebilir.
"""
import argparse, base64, getpass, hashlib, json, os, sys, time, urllib.error, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
except ImportError:
    sys.exit("Eksik paket: önce  pip install cryptography  komutunu çalıştırın.")

CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111"
RPC = {"devnet": "https://api.devnet.solana.com", "mainnet": "https://api.mainnet-beta.solana.com"}
CREATE_FEE = 1_500_000          # Metaplex Core: NFT başına protokol ücreti (lamport)
LAMPORTS = 1_000_000_000
SEED_DOMAIN = b"diploma-zinciri:asset:v1:"
SITE = "https://diploma-zinciri.bllufuk04.workers.dev"
HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- base58
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        if c not in B58: raise ValueError("Geçersiz base58 karakteri: " + c)
        n = n * 58 + B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body

# ---------------------------------------------------------------- keys
class Keypair:
    def __init__(self, seed: bytes):
        self._sk = Ed25519PrivateKey.from_private_bytes(seed)
        self.public = self._sk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    @property
    def address(self): return b58encode(self.public)
    def sign(self, msg: bytes) -> bytes: return self._sk.sign(msg)

def load_wallet(path: str) -> Keypair:
    raw = Path(path).read_text(encoding="utf-8").strip()
    if raw.startswith("["):
        data = bytes(json.loads(raw))            # Solana CLI biçimi (64 sayı)
    else:
        data = b58decode(raw)                    # Phantom'dan dışa aktarılan özel anahtar
    if len(data) == 32: kp = Keypair(data)
    elif len(data) == 64:
        kp = Keypair(data[:32])
        if kp.public != data[32:]: raise SystemExit("Anahtar dosyası bozuk: genel anahtar uyuşmuyor.")
    else: raise SystemExit("Anahtar dosyası tanınmadı (Phantom özel anahtarı veya Solana CLI JSON bekleniyordu).")
    return kp

def asset_keypair(collection: bytes, vc_hash: str) -> Keypair:
    """NFT adresi = ed25519(SHA-256(alan || koleksiyon || VC özeti)). Herkes aynı adresi hesaplayabilir."""
    return Keypair(hashlib.sha256(SEED_DOMAIN + collection + bytes.fromhex(vc_hash)).digest())

# ---------------------------------------------------------------- borsh
def u8(n): return n.to_bytes(1, "little")
def u32(n): return n.to_bytes(4, "little")
def u64(n): return n.to_bytes(8, "little")
def bstr(s: str): b = s.encode("utf-8"); return u32(len(b)) + b
def attributes_plugin(attrs):
    # PluginAuthorityPair { plugin: Plugin::Attributes(6) { attribute_list: Vec<Attribute{key,value}> }, authority: None }
    return u8(6) + u32(len(attrs)) + b"".join(bstr(k) + bstr(v) for k, v in attrs) + u8(0)
def permanent_freeze_plugin(frozen=True):
    # PluginAuthorityPair { plugin: Plugin::PermanentFreezeDelegate(5) { frozen }, authority: None }
    return u8(5) + u8(1 if frozen else 0) + u8(0)
def plugins_opt(pairs): return u8(1) + u32(len(pairs)) + b"".join(pairs) if pairs else u8(0)
def create_collection_data(name, uri, pairs=()):
    return u8(1) + bstr(name) + bstr(uri) + plugins_opt(list(pairs))           # CreateCollectionV1
def create_asset_data(name, uri, pairs=()):
    return u8(0) + u8(0) + bstr(name) + bstr(uri) + plugins_opt(list(pairs))   # CreateV1, DataState::AccountState

# ---------------------------------------------------------------- transactions
def shortvec(n):
    out = b""
    while True:
        b = n & 0x7F; n >>= 7
        if n: out += u8(b | 0x80)
        else: return out + u8(b)

class Ix:
    def __init__(self, program, accounts, data): self.program, self.accounts, self.data = program, accounts, data
def meta(address, signer=False, writable=False): return (address, signer, writable)

def compile_message(payer: str, ixs, blockhash: str) -> bytes:
    keys = {payer: [True, True]}
    for ix in ixs:
        for a, s, w in ix.accounts:
            k = keys.setdefault(a, [False, False]); k[0] |= s; k[1] |= w
        keys.setdefault(ix.program, [False, False])
    order = [payer] + [a for a in keys if a != payer]
    rank = lambda a: (0 if keys[a][0] and keys[a][1] else 1 if keys[a][0] else 2 if keys[a][1] else 3)
    order = [payer] + sorted(order[1:], key=lambda a: (rank(a), order.index(a)))
    signers = [a for a in order if keys[a][0]]
    header = u8(len(signers)) + u8(sum(1 for a in signers if not keys[a][1])) + \
             u8(sum(1 for a in order if not keys[a][0] and not keys[a][1]))
    idx = {a: i for i, a in enumerate(order)}
    body = b"".join(u8(idx[ix.program]) + shortvec(len(ix.accounts)) + bytes(idx[a] for a, _, _ in ix.accounts) +
                    shortvec(len(ix.data)) + ix.data for ix in ixs)
    msg = header + shortvec(len(order)) + b"".join(b58decode(a).rjust(32, b"\0") for a in order) + \
          b58decode(blockhash).rjust(32, b"\0") + shortvec(len(ixs)) + body
    return msg, signers

def sign_tx(msg_signers, keypairs) -> bytes:
    msg, signers = msg_signers
    by = {k.address: k for k in keypairs}
    missing = [s for s in signers if s not in by]
    if missing: raise ValueError("İmzacı eksik: " + ", ".join(missing))
    tx = shortvec(len(signers)) + b"".join(by[s].sign(msg) for s in signers) + msg
    if len(tx) > 1232: raise ValueError(f"İşlem çok büyük ({len(tx)} bayt > 1232). Ad/URI/özellikleri kısaltın.")
    return tx

def budget_ixs(price_microlamports, limit=200_000):
    if not price_microlamports: return []
    return [Ix(COMPUTE_BUDGET, [], u8(2) + u32(limit)), Ix(COMPUTE_BUDGET, [], u8(3) + u64(price_microlamports))]

def collection_ix(payer: Keypair, collection: Keypair, name, uri):
    return Ix(CORE_PROGRAM, [meta(collection.address, True, True), meta(CORE_PROGRAM),   # updateAuthority = yok -> payer
                             meta(payer.address, True, True), meta(SYSTEM_PROGRAM)], create_collection_data(name, uri))

def asset_ix(payer: Keypair, collection: str, asset: Keypair, name, uri, attrs):
    accounts = [meta(asset.address, True, True), meta(collection, False, True), meta(payer.address, True, False),
                meta(payer.address, True, True), meta(CORE_PROGRAM), meta(CORE_PROGRAM),   # owner = payer, updateAuthority = koleksiyon
                meta(SYSTEM_PROGRAM), meta(CORE_PROGRAM)]                                   # logWrapper yok
    return Ix(CORE_PROGRAM, accounts, create_asset_data(name, uri, [permanent_freeze_plugin(True), attributes_plugin(attrs)]))

# ---------------------------------------------------------------- account parsing (verification)
class Reader:
    def __init__(self, b, at=0): self.b, self.at = b, at
    def take(self, n):
        if self.at + n > len(self.b): raise ValueError("Hesap verisi beklenenden kısa.")
        v = self.b[self.at:self.at + n]; self.at += n; return v
    def u8(self): return self.take(1)[0]
    def u32(self): return int.from_bytes(self.take(4), "little")
    def u64(self): return int.from_bytes(self.take(8), "little")
    def key(self): return b58encode(self.take(32))
    def str(self): return self.take(self.u32()).decode("utf-8")
    def authority(self):
        t = self.u8()
        return ("Address", self.key()) if t == 3 else (["None", "Owner", "UpdateAuthority"][t], None)

def parse_asset(data: bytes) -> dict:
    r = Reader(data)
    if r.u8() != 1: raise ValueError("Bu hesap bir Metaplex Core NFT'si değil.")
    out = {"owner": r.key()}
    ua = r.u8(); out["updateAuthority"] = (["None", "Address", "Collection"][ua], r.key() if ua in (1, 2) else None)
    out["name"], out["uri"] = r.str(), r.str()
    if r.u8(): r.u64()
    out["plugins"] = {}
    if r.at < len(data):
        if r.u8() != 3: raise ValueError("Eklenti başlığı bulunamadı.")
        reg = Reader(data, r.u64())
        if reg.u8() != 4: raise ValueError("Eklenti kaydı bulunamadı.")
        records = [(reg.u8(), reg.authority(), reg.u64()) for _ in range(reg.u32())]
        for ptype, auth, offset in records:
            p = Reader(data, offset)
            if p.u8() != ptype: raise ValueError("Eklenti verisi kayıtla uyuşmuyor.")
            if ptype == 5: out["plugins"]["PermanentFreezeDelegate"] = {"frozen": bool(p.u8())}
            elif ptype == 6: out["plugins"]["Attributes"] = {p.str(): p.str() for _ in range(p.u32())}
    return out

def parse_collection(data: bytes) -> dict:
    r = Reader(data)
    if r.u8() != 5: raise ValueError("Bu hesap bir Metaplex Core koleksiyonu değil.")
    return {"updateAuthority": r.key(), "name": r.str(), "uri": r.str(), "numMinted": r.u32(), "currentSize": r.u32()}

# ---------------------------------------------------------------- RPC
class Rpc:
    def __init__(self, url): self.url = url
    def call(self, method, params, tries=5):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        for i in range(tries):
            try:
                req = urllib.request.Request(self.url, body, {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as resp: d = json.load(resp)
                if "error" in d: raise RuntimeError(d["error"].get("message", str(d["error"])))
                return d["result"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and i < tries - 1: time.sleep(2 * (i + 1)); continue
                raise RuntimeError(f"RPC hatası {e.code}: {e.read()[:200]!r}")
            except (urllib.error.URLError, TimeoutError) as e:
                if i < tries - 1: time.sleep(2 * (i + 1)); continue
                raise RuntimeError(f"Solana düğümüne ulaşılamadı: {e}")
    def accounts(self, addresses):
        out = {}
        for i in range(0, len(addresses), 100):
            chunk = addresses[i:i + 100]
            res = self.call("getMultipleAccounts", [chunk, {"encoding": "base64", "commitment": "confirmed"}])["value"]
            for a, v in zip(chunk, res):
                out[a] = None if v is None else {"owner": v["owner"], "lamports": v["lamports"], "data": base64.b64decode(v["data"][0])}
        return out
    def blockhash(self): return self.call("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"]
    def balance(self, a): return self.call("getBalance", [a, {"commitment": "confirmed"}])["value"]
    def rent(self, size): return self.call("getMinimumBalanceForRentExemption", [size])
    def simulate(self, tx):
        return self.call("simulateTransaction", [base64.b64encode(tx).decode(), {"encoding": "base64", "sigVerify": False,
                         "replaceRecentBlockhash": True, "commitment": "confirmed"}])["value"]
    def send(self, tx):
        return self.call("sendTransaction", [base64.b64encode(tx).decode(), {"encoding": "base64", "preflightCommitment": "confirmed"}])
    def statuses(self, sigs): return self.call("getSignatureStatuses", [sigs])["value"]

# ---------------------------------------------------------------- IPFS (Pinata)
def pinata_upload(jwt: str, folder: str, files) -> str:
    """files: [(relative path, bytes, content type)] -> klasörün CID'si"""
    boundary = "----dz" + uuid.uuid4().hex
    parts = []
    for rel, data, ctype in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{folder}/{rel}"\r\n'
                     f"Content-Type: {ctype}\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="pinataMetadata"\r\n\r\n{json.dumps({"name": folder})}\r\n'.encode())
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request("https://api.pinata.cloud/pinning/pinFileToIPFS", b"".join(parts),
                                 {"Authorization": "Bearer " + jwt, "Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp: return json.load(resp)["IpfsHash"]
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Pinata yüklemesi başarısız ({e.code}): {e.read()[:300].decode(errors='replace')}")

# ---------------------------------------------------------------- diplomas
def decode_jwt_payload(jwt: str) -> dict:
    p = jwt.split(".")
    if len(p) != 3: raise ValueError("vc+jwt biçiminde değil")
    return json.loads(base64.urlsafe_b64decode(p[1] + "=" * (-len(p[1]) % 4)))

def load_diplomas(folder: Path):
    files = sorted(folder.rglob("*.jwt"))
    if not files: raise SystemExit(f"{folder} içinde .jwt uzantılı diploma dosyası bulunamadı.")
    out, seen = [], set()
    for f in files:
        jwt = f.read_text(encoding="utf-8").strip()
        try: vc = decode_jwt_payload(jwt)
        except Exception as e: raise SystemExit(f"{f.name}: okunamadı ({e}).")
        if "DiplomaCredential" not in vc.get("type", []): raise SystemExit(f"{f.name}: diploma VC'si değil.")
        h = hashlib.sha256(jwt.encode("utf-8")).hexdigest()      # sitedeki vcHash ile aynı (SHA-256, kırpılmış JWT)
        if h in seen: print(f"  ! {f.name} aynı diplomanın ikinci kopyası, atlandı."); continue
        seen.add(h)
        rep = bool(vc.get("credentialSubject", {}).get("representative"))
        out.append({"file": f, "jwt": jwt, "hash": h, "type": "Temsili" if rep else "Diploma",
                    "issuer": (vc.get("issuer") or {}).get("id", "") if isinstance(vc.get("issuer"), dict) else str(vc.get("issuer", ""))})
    return out

def nft_name(d, year): return f"Diploma {year} · {d['hash'][:8]}"
def chain_attrs(d, year): return [("VC SHA-256", d["hash"]), ("Durum", "Geçerli"), ("Yıl", str(year)), ("Tür", d["type"]), ("Düzenleyen", d["issuer"][:80])]

def asset_size(name, uri, attrs):
    asset = 1 + 32 + 33 + 4 + len(name.encode()) + 4 + len(uri.encode()) + 1
    plugins = 2 + (1 + 4 + sum(8 + len(k.encode()) + len(v.encode()) for k, v in attrs))
    registry = 1 + 4 + 2 * (1 + 1 + 8) + 4
    return asset + 9 + plugins + registry

# ---------------------------------------------------------------- commands
def explorer(addr, net, kind="address"): return f"https://explorer.solana.com/{kind}/{addr}" + ("?cluster=devnet" if net == "devnet" else "")

def load_state(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"items": {}}
def save_state(path, st):
    tmp = path.with_suffix(".tmp"); tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8"); tmp.replace(path)

def wait_confirm(rpc, sigs, timeout=75):
    end, result = time.time() + timeout, {s: None for s in sigs}
    while time.time() < end and any(v is None for v in result.values()):
        time.sleep(2)
        pending = [s for s, v in result.items() if v is None]
        for s, st in zip(pending, rpc.statuses(pending)):
            if st and st.get("err"): result[s] = "hata: " + json.dumps(st["err"])
            elif st and st.get("confirmationStatus") in ("confirmed", "finalized"): result[s] = "ok"
    return result

def cmd_bas(a):
    net, folder = a.ag, Path(a.klasor)
    rpc = Rpc(a.rpc or RPC[net])
    payer = load_wallet(a.anahtar)
    year, uni = a.yil, a.universite
    diplomas = load_diplomas(folder)
    state_path = Path(a.durum or f"durum-{net}.json")
    st = load_state(state_path)
    print(f"\nAğ: {net.upper()}  ·  Cüzdan: {payer.address}")
    print(f"Diploma dosyası: {len(diplomas)} ({sum(d['type']=='Diploma' for d in diplomas)} gerçek, {sum(d['type']=='Temsili' for d in diplomas)} temsili)")

    # Koleksiyon
    coll_kp = None
    if st.get("collection"):
        acc = rpc.accounts([st["collection"]])[st["collection"]]
        if not acc: raise SystemExit(f"Durum dosyasındaki koleksiyon ({st['collection']}) zincirde yok. Yeni koleksiyon için durum dosyasını silin.")
        c = parse_collection(acc["data"])
        if c["updateAuthority"] != payer.address: raise SystemExit("Bu koleksiyonun yetkilisi bu cüzdan değil.")
        collection = st["collection"]; print(f"Koleksiyon: {c['name']} ({collection}) · basılmış: {c['numMinted']}")
    else:
        coll_kp = Keypair(os.urandom(32)); collection = coll_kp.address
        print(f"Koleksiyon: yeni oluşturulacak ({collection})")
    coll_bytes = b58decode(collection)
    for d in diplomas: d["kp"] = asset_keypair(coll_bytes, d["hash"]); d["address"] = d["kp"].address

    existing = rpc.accounts([d["address"] for d in diplomas])
    todo = [d for d in diplomas if existing.get(d["address"]) is None]
    print(f"Zincirde zaten olan: {len(diplomas) - len(todo)} · basılacak: {len(todo)}")
    if not todo and st.get("collection"): print("Basılacak yeni diploma yok."); return

    # Maliyet tahmini (örnek bir NFT boyutuyla)
    sample_uri = "https://ipfs.io/ipfs/" + "b" * 59 + "/meta/" + "0" * 64 + ".json"
    per = rpc.rent(asset_size(nft_name(diplomas[0], year), sample_uri, chain_attrs(diplomas[0], year))) + CREATE_FEE + 10_000
    total = per * len(todo) + (rpc.rent(1 + 32 + 4 + 64 + 4 + 120 + 8) + 10_000 if coll_kp else 0)
    bal = rpc.balance(payer.address)
    print(f"Tahmini maliyet: {total / LAMPORTS:.4f} SOL (NFT başına ~{per / LAMPORTS:.5f}) · bakiye: {bal / LAMPORTS:.4f} SOL")
    if bal < total * 1.05: raise SystemExit("Bakiye yetersiz. Cüzdana SOL ekleyip tekrar deneyin.")

    # Kodlamayı zincirde ücretsiz dene (simülasyon): hata varsa hiç para harcanmadan durur.
    if coll_kp:
        sim = rpc.simulate(sign_tx(compile_message(payer.address, budget_ixs(a.oncelik) + [collection_ix(payer, coll_kp, f"{uni} - {year} Mezunları", sample_uri)], rpc.blockhash()), [payer, coll_kp]))
        if sim.get("err"): raise SystemExit("Koleksiyon simülasyonu başarısız: " + json.dumps(sim["err"]) + "\n" + "\n".join(sim.get("logs") or []))
        print("Simülasyon: koleksiyon işlemi geçerli ✓ (NFT simülasyonu koleksiyon oluşunca yapılacak)")

    if not a.evet:
        ans = input(f"\n{len(todo)} NFT {'(ve koleksiyon) ' if coll_kp else ''}{net.upper()} ağında basılacak. Onaylıyor musunuz? (evet/hayır): ").strip().lower()
        if ans != "evet": print("İptal edildi."); return

    # IPFS: önce rozet görselleri ve diploma dosyaları, sonra bunlara işaret eden metadata dosyaları
    gw = a.gateway.rstrip("/") + "/"
    # Pinata'nın ücretsiz planı klasördeki her dosyayı ayrı sayar (~500). Bu yüzden belge dosyaları yalnızca gerçek
    # diplomalar için yüklenir; temsili diplomalar ortak tek bir metadata dosyasını gösterir (VC özetleri yine zincirde).
    real = [d for d in diplomas if d["type"] == "Diploma"]
    ipfs_key = ["v2"] + sorted(d["hash"] for d in real)
    if st.get("cid_meta") is None or st.get("ipfs_key") != ipfs_key:
        jwt = os.environ.get("PINATA_JWT") or getpass.getpass("Pinata JWT (yazdığınız görünmez): ").strip()
        files = [("rozet.png", (HERE / "rozet.png").read_bytes(), "image/png"),
                 ("rozet-temsili.png", (HERE / "rozet-temsili.png").read_bytes(), "image/png")]
        files += [(f"vc/{d['hash']}.jwt", d["jwt"].encode(), "application/vc+jwt") for d in real]
        print(f"IPFS: rozetler ve {len(real)} gerçek diploma belgesi yükleniyor…")
        cid_files = pinata_upload(jwt, f"diploma-zinciri-{year}-belgeler", files)
        sym = f"DZ{str(year)[-2:]}"
        metas = [("koleksiyon.json", json.dumps({"name": f"{uni} - {year} Mezunları", "symbol": sym,
                  "description": f"{uni} {year} mezuniyet belgeleri. Her mezun bu koleksiyonun ayrı bir parçasıdır. Diploma Zinciri prototipi.",
                  "image": f"{gw}{cid_files}/rozet.png", "external_url": SITE + "/dogrula"}, ensure_ascii=False).encode(), "application/json"),
                 ("temsili.json", json.dumps({"name": f"Temsili Diploma {year}", "symbol": sym,
                  "description": f"{uni} {year} temsili mezuniyet belgesi (test verisi). Bu NFT'ye ait diploma VC'sinin SHA-256 özeti zincirdeki "
                                 "'VC SHA-256' özelliğindedir; belge dosyası IPFS'e konmamıştır, üniversitenin kendi deposunda durur. NFT devredilemez.",
                  "image": f"{gw}{cid_files}/rozet-temsili.png", "external_url": SITE + "/dogrula",
                  "attributes": [{"trait_type": "Yıl", "value": str(year)}, {"trait_type": "Tür", "value": "Temsili"}],
                  "properties": {"category": "image", "files": [{"uri": f"{gw}{cid_files}/rozet-temsili.png", "type": "image/png"}]}}, ensure_ascii=False).encode(), "application/json")]
        for d in real:
            img = f"{gw}{cid_files}/rozet.png"
            metas.append((f"meta/{d['hash']}.json", json.dumps({
                "name": nft_name(d, year), "symbol": sym,
                "description": f"{uni} {year} mezuniyet belgesi. Belgenin kendisi, üniversitenin imzaladığı W3C diploma VC dosyasıdır "
                               "(properties.files). Zincirde VC'nin SHA-256 özeti tutulur; NFT devredilemez.",
                "image": img, "external_url": SITE + "/dogrula",
                "attributes": [{"trait_type": k, "value": v} for k, v in chain_attrs(d, year)],
                "properties": {"category": "image", "files": [{"uri": img, "type": "image/png"},
                               {"uri": f"{gw}{cid_files}/vc/{d['hash']}.jwt", "type": "application/vc+jwt"}]}}, ensure_ascii=False).encode(), "application/json"))
        print(f"IPFS: {len(metas)} metadata dosyası yükleniyor…")
        st["cid_meta"] = pinata_upload(jwt, f"diploma-zinciri-{year}-metadata", metas)
        st["cid_files"], st["ipfs_key"] = cid_files, ipfs_key
        save_state(state_path, st)
    real_hashes = {d["hash"] for d in real}
    meta_uri = lambda h: f"{gw}{st['cid_meta']}/" + (f"meta/{h}.json" if h in real_hashes else "temsili.json")
    print(f"IPFS belgeler: {gw}{st['cid_files']}  ·  metadata: {gw}{st['cid_meta']}")

    if coll_kp:
        tx = sign_tx(compile_message(payer.address, budget_ixs(a.oncelik) + [collection_ix(payer, coll_kp, f"{uni} - {year} Mezunları", f"{gw}{st['cid_meta']}/koleksiyon.json")], rpc.blockhash()), [payer, coll_kp])
        sig = rpc.send(tx)
        if wait_confirm(rpc, [sig])[sig] != "ok": raise SystemExit("Koleksiyon oluşturulamadı: " + sig)
        st["collection"] = collection; st["collection_tx"] = sig; st["network"] = net; save_state(state_path, st)
        print(f"Koleksiyon oluşturuldu ✓ {explorer(collection, net)}")

    def build(d, bh):
        return sign_tx(compile_message(payer.address, budget_ixs(a.oncelik) + [asset_ix(payer, collection, d["kp"], nft_name(d, year), meta_uri(d["hash"]), chain_attrs(d, year))], bh), [payer, d["kp"]])
    sim = rpc.simulate(build(todo[0], rpc.blockhash()))
    if sim.get("err"): raise SystemExit("NFT simülasyonu başarısız (hiç para harcanmadı): " + json.dumps(sim["err"]) + "\n" + "\n".join(sim.get("logs") or []))
    print(f"Simülasyon: NFT işlemi geçerli ✓ ({sim.get('unitsConsumed')} CU)\n")

    done = 0
    for attempt in range(4):
        left = [d for d in todo if st["items"].get(d["hash"], {}).get("status") != "ok"]
        if not left: break
        if attempt: print(f"Yeniden deneme {attempt}: {len(left)} NFT")
        for i in range(0, len(left), a.dalga):
            wave = left[i:i + a.dalga]
            have = rpc.accounts([d["address"] for d in wave])
            bh = rpc.blockhash(); sent = {}
            def go(d):
                if have.get(d["address"]): return d, "var"
                try: return d, rpc.send(build(d, bh))
                except Exception as e: return d, "gönderilemedi: " + str(e)[:120]
            with ThreadPoolExecutor(max_workers=4) as ex:
                for d, sig in ex.map(go, wave):
                    if sig == "var": st["items"][d["hash"]] = {"status": "ok", "address": d["address"], "file": d["file"].name, "sig": st["items"].get(d["hash"], {}).get("sig")}
                    elif sig.startswith("gönderilemedi"): st["items"][d["hash"]] = {"status": sig, "address": d["address"], "file": d["file"].name}
                    else: sent[sig] = d
            if sent:
                for sig, res in wait_confirm(rpc, list(sent)).items():
                    d = sent[sig]
                    st["items"][d["hash"]] = {"status": "ok" if res == "ok" else (res or "onaylanmadı"), "address": d["address"], "file": d["file"].name, "sig": sig}
            save_state(state_path, st)
            done = sum(1 for d in todo if st["items"].get(d["hash"], {}).get("status") == "ok")
            print(f"\r  basıldı: {done}/{len(todo)}", end="", flush=True)
        print()

    report = Path(a.rapor or f"rapor-{net}.csv")
    rows = ["dosya,vc_ozeti,tur,nft_adresi,durum,islem,gezgin"]
    for d in diplomas:
        it = st["items"].get(d["hash"], {"status": "zaten vardı" if existing.get(d["address"]) else "?"})
        rows.append(",".join([d["file"].name, d["hash"], d["type"], d["address"], str(it.get("status")), it.get("sig") or "", explorer(d["address"], net)]))
    report.write_text("\n".join(rows) + "\n", encoding="utf-8-sig")
    failed = [d for d in todo if st["items"].get(d["hash"], {}).get("status") != "ok"]
    print(f"\nBitti: {len(todo) - len(failed)}/{len(todo)} NFT basıldı. Rapor: {report}")
    print(f"Koleksiyon: {explorer(collection, net)}")
    if failed: print(f"{len(failed)} NFT basılamadı; komutu tekrar çalıştırırsanız yalnızca bunlar denenir.")

def cmd_dogrula(a):
    net = a.ag; rpc = Rpc(a.rpc or RPC[net])
    st = load_state(Path(a.durum or f"durum-{net}.json"))
    collection = a.koleksiyon or st.get("collection")
    if not collection: raise SystemExit("Koleksiyon adresi yok: --koleksiyon ile verin.")
    path = Path(a.klasor)
    diplomas = load_diplomas(path) if path.is_dir() else [{"file": path, "hash": hashlib.sha256(path.read_text(encoding="utf-8").strip().encode()).hexdigest()}]
    coll = parse_collection(rpc.accounts([collection])[collection]["data"])
    print(f"Koleksiyon: {coll['name']} · yetkili: {coll['updateAuthority']} · basılmış: {coll['numMinted']}")
    coll_bytes = b58decode(collection)
    addrs = {d["hash"]: asset_keypair(coll_bytes, d["hash"]).address for d in diplomas}
    accs = rpc.accounts(list(addrs.values()))
    ok = 0
    for d in diplomas:
        addr, acc = addrs[d["hash"]], accs[addrs[d["hash"]]]
        try:
            if acc is None: raise ValueError("zincirde NFT yok")
            if acc["owner"] != CORE_PROGRAM: raise ValueError("hesap Metaplex Core'a ait değil")
            nft = parse_asset(acc["data"])
            if nft["updateAuthority"] != ("Collection", collection): raise ValueError("NFT bu koleksiyona ait değil")
            attrs = nft["plugins"].get("Attributes", {})
            if attrs.get("VC SHA-256") != d["hash"]: raise ValueError("NFT'deki özet bu dosyayla eşleşmiyor")
            if not nft["plugins"].get("PermanentFreezeDelegate", {}).get("frozen"): raise ValueError("NFT devredilemez değil")
            status = attrs.get("Durum", "?")
            if status != "Geçerli": raise ValueError("durum: " + status)
            ok += 1
            if not path.is_dir() or a.ayrinti: print(f"  ✓ {d['file'].name}: {nft['name']} · {explorer(addr, net)}")
        except ValueError as e:
            print(f"  ✗ {d['file'].name}: {e} · {explorer(addr, net)}")
    print(f"\nSonuç: {ok}/{len(diplomas)} diploma koleksiyonda kayıtlı ve geçerli.")

def main():
    p = argparse.ArgumentParser(description="Diploma Zinciri - Solana NFT koleksiyonu")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("bas", "dogrula"):
        s = sub.add_parser(name)
        s.add_argument("--klasor", required=True, help="Diploma VC dosyalarının (.jwt) bulunduğu klasör (dogrula: tek dosya da olur)")
        s.add_argument("--ag", choices=["devnet", "mainnet"], default="devnet")
        s.add_argument("--rpc", help="Özel RPC adresi (isteğe bağlı)")
        s.add_argument("--durum", help="Durum dosyası (varsayılan: durum-<ag>.json)")
    b = sub.choices["bas"]
    b.add_argument("--anahtar", required=True, help="Üniversite cüzdanının özel anahtar dosyası (yalnızca sizde kalır)")
    b.add_argument("--yil", type=int, default=2026)
    b.add_argument("--universite", default="Örnek Üniversite")
    b.add_argument("--gateway", default="https://ipfs.io/ipfs/")
    b.add_argument("--oncelik", type=int, default=None, help="Öncelik ücreti (mikrolamport/CU). Varsayılan: devnet 0, mainnet 20000")
    b.add_argument("--dalga", type=int, default=10, help="Aynı anda gönderilen işlem sayısı")
    b.add_argument("--rapor")
    b.add_argument("--evet", action="store_true", help="Onay sorusunu atla")
    d = sub.choices["dogrula"]
    d.add_argument("--koleksiyon", help="Koleksiyon adresi (varsayılan: durum dosyasından)")
    d.add_argument("--ayrinti", action="store_true")
    a = p.parse_args()
    if a.cmd == "bas":
        if a.oncelik is None: a.oncelik = 20000 if a.ag == "mainnet" else 0
        cmd_bas(a)
    else: cmd_dogrula(a)

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print("\nDurduruldu. Komutu tekrar çalıştırırsanız kaldığı yerden devam eder.")
