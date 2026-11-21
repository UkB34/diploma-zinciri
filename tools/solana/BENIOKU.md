# Diploma Zinciri – Solana NFT koleksiyonu

`diploma_nft.py`, bir klasördeki diploma VC dosyalarının (`.jwt`) her birini tek bir koleksiyonun ayrı bir parçası
(NFT) olarak Solana'ya basar. Liste zincire girmez, sadece kodun girdisidir. Bütün işlemler tek onayla, tek turda
imzalanır.

| NFT'de | Nerede |
|---|---|
| Koleksiyon: "Örnek Üniversite - 2026 Mezunları" | Zincir (Metaplex Core) |
| Devredilemez (kalıcı dondurma) | Zincir |
| VC SHA-256, Durum, Yıl, Tür, Düzenleyen | Zincir (Attributes) |
| Gerçek diplomalar: mezuniyet belgesi (imzalı diploma VC dosyası), rozet, açıklama | IPFS (Pinata) |
| Temsili diplomalar: ortak tek metadata dosyası (belge dosyaları bilgisayarda kalır) | IPFS (Pinata) |

NFT'nin adresi diploma dosyasının özetinden türetilir. Elinde diploma dosyası olan herkes NFT'nin adresini hesaplayıp
zincirden kontrol edebilir; bunun için hiçbir listeye gerek yoktur.

## 1. Hazırlık (bir kez)

1. **Python:** Komut İstemi'nde `python --version` ile kontrol edin, sonra şunu çalıştırın:
   `pip install cryptography`
2. **Bu klasörü** (`diploma_nft.py`, `rozet.png`, `rozet-temsili.png`) bilgisayarınızda bir yere koyun, örneğin
   `Belgeler\Diploma Zinciri\solana`.
3. **Cüzdan anahtarı:** Phantom → sol üstteki hesap → **Ayarlar → Hesabı yönet** (hesabınız) → **Özel anahtarı göster**
   → şifrenizi girin → anahtarı kopyalayın. Aynı klasörde `cuzdan-anahtari.txt` adında bir dosya açıp anahtarı
   yapıştırın ve kaydedin.
   **Bu dosya cüzdanın tamamıdır. Kimseyle paylaşmayın, buluta, GitHub'a veya sohbete koymayın.**
4. **IPFS (Pinata):** pinata.cloud'da ücretsiz hesap açın → **API Keys → New Key** → *Admin* seçin (veya en azından
   `pinFileToIPFS`) → **JWT** değerini kopyalayın. Kod çalışırken sorar, yapıştırdığınız değer ekranda görünmez.

## 2. Diploma klasörü

```
DIPLOMALAR\
  gercek\    Kenan Yıldız ve Zeynep Deniz'in diploma VC dosyaları
  temsili\   zip'ten çıkan 1000 temsili diploma
```

Gerçek diplomaları sitedeki diploma sayfalarından **Diploma VC'sini indir** ile alın:
- `/diploma/TEST-0636DFB8A5B34F9984DD` (Kenan Yıldız)
- `/diploma/TEST-ACE34182340F4EE8B221` (Zeynep Deniz)

## 3. Önce küçük deneme (devnet, ücretsiz)

`DENEME` adında bir klasör açıp içine 2 gerçek ve 3 temsili dosya koyun. Komut İstemi'nde bu klasöre gidip
(`cd "Belgeler\Diploma Zinciri\solana"`):

```
python diploma_nft.py bas --klasor DENEME --anahtar cuzdan-anahtari.txt --ag devnet
```

Kod sırayla şunları yapar:
1. Dosyaları okur, bakiyeyi ve tahmini maliyeti gösterir.
2. İşlemi zincirde ücretsiz simüle eder. Hata varsa hiç para harcamadan durur.
3. **"evet"** yazmanızı bekler. Tek onay budur.
4. Dosyaları IPFS'e yükler, koleksiyonu oluşturur, NFT'leri basar.
5. `rapor-devnet.csv` dosyasını yazar ve koleksiyonun gezgin bağlantısını gösterir.

## 4. Hepsini basmak

```
python diploma_nft.py bas --klasor DIPLOMALAR --anahtar cuzdan-anahtari.txt --ag devnet
```

Aynı `durum-devnet.json` dosyası kullanıldığı için denemedeki koleksiyona eklenir. Zaten basılmış diplomalar
atlanır. Yarıda kesilirse aynı komutu tekrar çalıştırın, kaldığı yerden devam eder.
1000 NFT için devnet'te yaklaşık 5 SOL gerekir.

## 5. Doğrulama

```
python diploma_nft.py dogrula --klasor DIPLOMALAR --ag devnet
python diploma_nft.py dogrula --klasor DIPLOMALAR\temsili\Temsili-Diploma-0057.diploma.vc.jwt --ag devnet
```

Her dosya için NFT adresi hesaplanır ve zincirden okunur. Şunlar kontrol edilir: NFT bu koleksiyona mı ait,
içindeki özet dosyayla eşleşiyor mu, devredilemez mi, durumu geçerli mi. Bir dosyada tek harf değiştirirseniz
özeti değişir ve NFT bulunamaz.

## 6. Ana ağ (gerçek para)

Sadece gerçek diplomaları içeren bir klasörle:

```
python diploma_nft.py bas --klasor GERCEK --anahtar cuzdan-anahtari.txt --ag mainnet
```

Ana ağda yeni bir koleksiyon oluşur (`durum-mainnet.json`). 2 diploma için yaklaşık 0,015 SOL yeterlidir.
Phantom'da Test Ağı Modu'nu kapatıp cüzdana gerçek SOL yükleyin.

## Notlar

- Pinata'nın ücretsiz planı klasördeki her dosyayı ayrı sayar (yaklaşık 500 dosya). Bu yüzden belge dosyaları sadece
  gerçek diplomalar için yüklenir; 1000 temsili diploma tek bir ortak metadata dosyasını gösterir. Her birinin kendi
  VC özeti yine zincirdedir ve `dogrula` komutu bununla çalışır.

- Gerçek diplomaların VC dosyası mezunun adını içerir ve IPFS'te herkese açık olur. Bu prototipteki kişiler temsili
  test verisidir; gerçek sistemde bu dosya şifrelenmeli ya da IPFS'e konmamalıdır.
- NFT adresleri herkesin hesaplayabileceği şekilde türetildiği için, biri adresi önceden doldurarak basımı
  engelleyebilir. Sahte NFT üretemez, çünkü doğrulama koleksiyonu ve özeti kontrol eder.
