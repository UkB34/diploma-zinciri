# 2. aşama: Blokzincir kaydı (Solana)

Dört VC onayı tamamlanan diplomalar Solana'da tek bir koleksiyonun ayrı parçaları (NFT) olarak kaydedilir. Liste
zincire girmez; yalnızca basım kodunun girdisidir. Önceki Sepolia denemesi kaldırıldı (eski NFT'ler zincirde durur,
site artık onları kullanmaz).

| | |
|---|---|
| Ağ | Solana devnet |
| Standart | Metaplex Core (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`) |
| Koleksiyon | Örnek Üniversite - 2026 Mezunları · `DsiuZbshd7sBqCuR2hCGiMcBR6g4arWFDBDAmUVb2Kis` |
| Yetkili (üniversite cüzdanı) | `GFdrrpvhgxQnGkB6hDyqNNYDcmFHmDKdLn4f4sqrzaXp` |
| Basılan | 1002 NFT (2 gerçek, 1000 temsili) |
| Zincirde her NFT'de | `VC SHA-256`, `Durum`, `Yıl`, `Tür`, `Düzenleyen` (Attributes) · kalıcı dondurma (devredilemez) |
| İçerik | IPFS (Pinata): gerçek diplomaların belge dosyası ve metadata; temsili diplomalar ortak metadata |

## Basım

`tools/solana/diploma_nft.py` (ayrıntılar `tools/solana/BENIOKU.md`). Diploma VC dosyalarını okur, işlemi ücretsiz
simüle eder, tek onayla koleksiyonu ve NFT'leri basar. Üniversite cüzdanının anahtarı yalnızca bu kodu çalıştıran
bilgisayarda durur; sunucuda yoktur.

## Doğrulama

NFT adresi = ed25519(SHA-256(`diploma-zinciri:asset:v1:` ‖ koleksiyon ‖ VC özeti)). Elinde diploma dosyası olan
herkes adresi hesaplayıp zincirden okuyabilir; sunucuya ve bir listeye gerek yoktur. Kontrol edilenler: hesap
Metaplex Core'a ait mi, NFT bu koleksiyonda mı, koleksiyonun yetkilisi üniversite cüzdanı mı, özet eşleşiyor mu,
NFT devredilemez mi, durum "Geçerli" mi.

- `lib/solana.mjs`: adres türetme, hesap okuma ve kurallar (tarayıcı ve testler aynı kodu kullanır).
- Diploma sayfası ve dosya ekranı: diplomanın NFT durumu.
- `/dogrula`: VC dosyası yüklenince NFT durumu; **Klasörü toplu doğrula** ile bütün bir klasör tek seferde.
- Komut satırı: `python diploma_nft.py dogrula --klasor DIPLOMALAR --ag devnet`.

Not: Adresler herkesin hesaplayabileceği şekilde türetildiği için biri bir adresi önceden doldurarak basımı
engelleyebilir; sahte NFT üretemez, çünkü doğrulama koleksiyonu ve özeti kontrol eder.
