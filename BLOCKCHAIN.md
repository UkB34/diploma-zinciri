# 2. aşama: Blokzincir kaydı (Sepolia, NFT)

Dört VC onayı tamamlanan diplomalar Sepolia'ya **devredilemez NFT** olarak kaydedilir. Test aşamasında denenen Merkle kökü yöntemi kaldırıldı; ölçüm sayfası ve ölçüm verileri silindi.

| | |
|---|---|
| Sözleşme | `contracts/DiplomaNFT.sol` (ERC-721 + ERC-5192 soulbound) |
| Sepolia adresi | `0x09917F2dEb350c50a626158d07017CB77953bB1C` |
| Üniversite cüzdanı (tek yetkili) | `0x15C21B5c00Ed0eD37ffE43cc0CDE1181c52b2847` |
| Zincire yazılan | Her diploma için bir token ve diploma VC'sinin SHA-256 özeti |
| İptal | `revoke(tokenId)` |

Zincirde kişisel veri yoktur. Eski Merkle sözleşmesi (`0x871C9551…`) zincirde durur ama uygulama artık onu kullanmaz.

## Nasıl çalışır?

- `tokenId` = diploma kodundaki 20 haneli onaltılık sayı (`TEST-…`). Aynı diploma iki kez basılamaz.
- Özet = SHA-256(diploma VC JWT). NFT sözleşmesinde `credentialHash` olarak tutulur.
- Kaydı **merkez yetkilisi MetaMask ile** imzalar: dosya ekranındaki "Blokzincir (Sepolia)" bölümünde **NFT olarak kaydet**. Özel anahtar sunucuda bulunmaz.
- Sunucu, işlemin doğru sözleşmeye ve hazırladığı içerikle (calldata özeti) gittiğini makbuzdan kontrol etmeden kaydı kabul etmez.
- Diploma ve `/dogrula` sayfaları sonucu **tarayıcıdan doğrudan Sepolia düğümüne** sorar (eth_call); sunucuya güvenmek gerekmez.
- Cüzdanlar için metadata `/api/nft/<tokenId>`, rozet görseli `/api/nft-image/<tokenId>` adresindedir.

## Kurulum notları

- `drizzle/0004_chain.sql` → `chain_batches`, `chain_records`. `drizzle/0005_nft_only.sql` → test verilerini ve Merkle kayıtlarını siler. Deploy iş akışı bunları otomatik uygular.
- `wrangler.json` → `CHAIN_RPC`, `NFT_CONTRACT`, `CHAIN_ISSUER` (herkese açık değerler, secret değil).
- EIP-7825 nedeniyle bir işlem en fazla ~16,7 milyon gas kullanabilir. Tek diploma kaydı ~230–260 bin gas olduğundan sorun yoktur; toplu basım eklenirse paket ~60 diplomayı geçmemelidir.
- Alan adı değişirse sözleşme yeni DID ve metadata adresiyle yeniden yayınlanmalı (Sepolia'da ücretsiz).
