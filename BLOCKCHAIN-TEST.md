# 2. aşama: Blokzincir kayıt testi (Sepolia)

Danışman isteği: diplomaları zincire kaydetmek için iki yöntemi denemek ve karşılaştırmak.

| | Yöntem 1: NFT koleksiyonu | Yöntem 2: Merkle kökü (toplu kayıt) |
|---|---|---|
| Sözleşme | `contracts/DiplomaNFT.sol` | `contracts/DiplomaAnchor.sol` |
| Sepolia adresi | `0x09917F2dEb350c50a626158d07017CB77953bB1C` | `0x871C9551aEe5911d998C84F239AB9ACB79bf4f51` |
| Zincire yazılan | Her diploma için bir devredilemez (ERC-5192) token ve VC özeti | Paket başına tek bir Merkle kökü |
| İşlem sayısı | Diploma sayısıyla artar (işlem başına en fazla 150) | Paket başına 1 |
| İptal | `revoke(tokenId)` | `revokeLeaf(vcHash)` |

Üniversite cüzdanı (sözleşmeleri yayınlayan ve tek yetkili): `0x15C21B5c00Ed0eD37ffE43cc0CDE1181c52b2847`

Zincirde kişisel veri yok. Yalnızca diploma VC'sinin SHA-256 özeti (veya özetlerden kurulan Merkle kökü) yazılıyor.

## Nasıl çalışır?

- **Yaprak** = SHA-256(diploma VC JWT). Aynı değer NFT sözleşmesinde `credentialHash` olarak tutulur.
- **Merkle düğümü** = SHA-256(0x01 ‖ küçük ‖ büyük). Sıralı çiftler kullanıldığı için kanıtta konum bilgisi gerekmez; tek kalan düğüm üst seviyeye aynen taşınır. 200 diplomalık bir pakette her kanıt en fazla 8 özet uzunluğundadır.
- `tokenId` = diploma kodundaki 20 haneli onaltılık sayı (`TEST-…`). Aynı diploma iki kez basılamaz.
- İşlemleri **merkez yetkilisi MetaMask ile** imzalar; özel anahtar sunucuda bulunmaz. Sunucu, hazırladığı işlemin zincirde birebir aynı içerikle (calldata özeti), doğru sözleşmeye gittiğini işlem makbuzundan kontrol etmeden kaydı kabul etmez.
- Doğrulama sayfaları sonucu **tarayıcıdan doğrudan Sepolia düğümüne** sorar (eth_call). Sunucu yalnızca hangi kaydın bulunduğunu ve Merkle kanıtını verir; kanıt kendi kendini doğruladığı için sunucuya güvenmek gerekmez.
- Ölçüm diplomaları gerçek VC yapısında üretilir ve üniversite anahtarıyla imzalanır, ama "ölçüm amaçlı" olarak işaretlidir ve birim onayı içermez.

## Test senaryoları

| # | Senaryo | Nerede |
|---|---|---|
| T1 | 1, 10, 50 ve 200 diplomayı her iki yöntemle kaydet | `/blokzincir` → "Zincire kaydet" |
| T2 | Geçerli diplomayı doğrula: "Sepolia'da kayıtlı, özet eşleşiyor" | Diploma sayfası, `/dogrula` → VC dosyası |
| T3 | VC'de bir harf değiştir: zincirde kayıt bulunmaz | `/dogrula` → VC dosyası |
| T4 | Zincirde iptal et: "zincirde İPTAL EDİLMİŞ" | `/blokzincir` → "Zincirde iptal" |
| T5 | Yetkisiz cüzdan kayıt deneyince sözleşme reddeder (eth_call simülasyonu, ücretsiz) | `/blokzincir` → "Yetkisiz cüzdan" |
| T6 | Etherscan'de yalnızca özetlerin göründüğünü kontrol et | Ölçüm tablosundaki işlem linkleri |

Ölçülenler işlem makbuzlarından otomatik alınır: işlem sayısı, `gasUsed`, `effectiveGasPrice`, ücret, MetaMask onayından bloğa girişe kadar geçen süre. Ana ağ maliyeti, sayfaya girilen gas fiyatı ve ETH kuruyla hesaplanan bir **tahmindir**. Sonuçlar CSV olarak indirilebilir.

## Uygulama adımları

1. Merkez hesabıyla giriş yap ve sol menüden **Blokzincir testi** sayfasını aç. Sayfayı MetaMask'ın kurulu olduğu tarayıcı profilinde aç.
2. **MetaMask'ı bağla.** Seçili hesap üniversite cüzdanı olmalı, ağ Sepolia olmalı.
3. **261 test diploması üret** (1 + 10 + 50 + 200). Her iki yöntem aynı diplomaları kullanır.
4. Önce **Merkle** yöntemiyle 1, 10, 50 ve 200 diplomayı kaydet. Her biri tek MetaMask onayı ister.
5. Sonra **NFT** yöntemiyle aynı boyutları kaydet. 200 diploma 2 işlem (150 + 50) olur.
6. T4 ve T5'i çalıştır. T2 ve T3'ü gerçek bir diplomayla dene ("Kaynak: Gerçek diplomalar").
7. Ana ağ gas fiyatını ve ETH kurunu girip CSV'yi indir.

**Bütçe notu:** NFT yöntemi diploma başına yaklaşık 70–80 bin gas harcar. Sepolia gas fiyatı yüksek olduğunda 200 diplomalık NFT ölçümü 0,1 SepoliaETH'yi aşabilir. Musluklardan birkaç gün üst üste test ETH'si almak gerekebilir. Merkle yöntemi paket başına yaklaşık 90 bin gas harcar.

## Kurulum notları

- `drizzle/0004_chain.sql` → `chain_batches`, `chain_records` tabloları. Deploy iş akışı bunu otomatik uygular.
- `wrangler.json` → `CHAIN_RPC`, `NFT_CONTRACT`, `ANCHOR_CONTRACT`, `CHAIN_ISSUER`. Bunlar herkese açık değerlerdir; secret değildir.
- Fonksiyon seçicileri Keccak-256 ile çevrimdışı hesaplandı. `tests/chain-vectors.json` bağımsız bir Python uygulamasından üretildi; ABI kodlaması ve Merkle ağacı bu vektörlerle test ediliyor.
- Alan adı değişirse (proje hesaplarına taşıma) sözleşmeler yeni DID ve metadata adresiyle yeniden yayınlanmalı. Sepolia olduğu için bunun bir maliyeti yok.
