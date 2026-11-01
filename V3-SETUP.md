# V3: Doğrulanabilir Dijital Kimlik (VC) ile onay

V2'deki sunucu anahtarlı test e-imzası kaldırıldı. Akış hâlâ aynı sırayı izliyor: öğrenci işleri → fakülte → rektörlük → merkez. Fark şu: her birim onayını **kendi tarayıcısındaki dijital kimlikle** imzalıyor ve üniversitenin kendisine verdiği **Yetkili Onaycı VC'si** ile sunuyor. Dört onay tamamlanınca üniversite öğrenci için bir **diploma VC'si** düzenliyor.

Standartlar: W3C Verifiable Credentials Data Model 2.0, JOSE ile güvence (`vc+jwt` / `vp+jwt`, ES256 / P-256), `did:web` (üniversite), `did:jwk` (yetkililer), Bitstring Status List (iptal).

## Kimlikler

| Kim | DID | Anahtar nerede |
|---|---|---|
| Üniversite | `did:web:<site>:api:did` → `https://<site>/api/did/did.json` | Cloudflare Secret `UNIVERSITY_KEY_JSON` (tek anahtar) |
| Her yetkili | `did:jwk:…` | Yetkilinin tarayıcısı (IndexedDB, dışa aktarılamaz). Sunucuya gitmez. |

Canlı sitede üniversite DID'i: `did:web:diploma-zinciri.bllufuk04.workers.dev:api:did`

## Akış

1. **Kimlik oluşturma (bir kez):** Yetkili panelde *Dijital kimliğim → Dijital kimliğimi oluştur* düğmesine basar. Tarayıcı bir anahtar üretir ve sunucunun verdiği tek kullanımlık bir sayıyı imzalayarak anahtarın sahibi olduğunu kanıtlar. Üniversite bu DID'e, hesabı ve rolü yazan bir `AuthorizedApproverCredential` düzenler. Hesabın e-postasına bilgilendirme gider. Aynı hesap başka bir tarayıcıyı bağlarsa önceki VC iptal edilir.
2. **Davet:** Panelden "VC ile onayla" istenir. Davet; hesaba, role, belge sürümüne, aşamaya, 20 dakikalık süreye ve **o anki dijital kimliğe** bağlanır. Bağlantı e-postayla (Brevo) gelir.
3. **Onay:** Bağlantı aynı tarayıcıda açılır, belge incelenir ve onay kutusu işaretlenir. Tarayıcı iki şey üretir: dosyayı, sürümü, içerik özetini ve transkript özetini içeren bir `DiplomaApprovalCredential` ve bunu Yetkili Onaycı VC'siyle birlikte saran, davete özel sayı (`nonce`) ve site adresi (`aud`) içeren bir sunum (`vp+jwt`). Her ikisi de yetkilinin kendi anahtarıyla imzalanır.
4. **Sunucu doğrulaması:** Sunum imzası; Yetkili Onaycı VC'sinin üniversite imzası, geçerlilik süresi ve iptal durumu; VC'deki DID'in sunumu imzalayan DID ile aynı olması; hesap ve rolün eşleşmesi; onay beyanının tam olarak bu belge sürümüne ait olması; `nonce` ve `aud`. Biri bile tutmazsa dosya ilerlemez.
5. **Diploma VC'si:** Merkezin onayıyla aynı veritabanı güncellemesinde üniversite `DiplomaCredential` düzenler. İçinde ad, üniversite, fakülte, program, sürüm, belge ve transkript özeti, diploma kodu ve dört onayın kanıtı (onaylayan DID, zaman, sunum özeti) bulunur. Öğrenci numarası, notlar ve hesap adları bulunmaz.
6. **İptal:** Merkez belgeyi iptal ettiğinde kayıt iptal edilir ve VC'nin biti imzalı iptal listesinde (`/api/status-list`) işaretlenir.

## Doğrulama yolları

- **QR / diploma sayfası:** Her açılışta ve 30 saniyede bir kontrol listesi gösterir: diploma VC imzası, içerik, dört birim onayı (her biri yeniden doğrulanır) ve iptal durumu.
- **Doğrulama sayfası (`/dogrula`) → "Diploma VC dosyasını doğrula":** İndirilen `.vc.jwt` dosyası tarayıcıda kontrol edilir. Yalnızca herkese açık DID belgesi ve imzalı iptal listesi indirilir; dosya sunucuya gönderilmez.
- **Çevrimdışı:** `node scripts/verify-vc.mjs DIPLOMA.vc.jwt did.json [site] [status-list.jwt]`

Bir yetkilinin kimliği sonradan iptal edilirse (ör. tarayıcı değişikliği), **iptalden önce verdiği onaylar geçerli kalır**. Sunucu, onayın verildiği andaki iptal durumuna bakar.

## Kurulum (Cloudflare)

1. **D1 yedeği alın.** Ardından `pnpm run db:migrate` çalıştırın; `credentials` ve `wallet_challenges` tabloları eklenir. *Deploy server* iş akışı bunu zaten yapar.
2. **Üniversite anahtarı:** `scripts/universite-anahtari.html` dosyasını indirip tarayıcıda açın (internete bağlanmaz) ya da `node scripts/create-university-key.mjs` çalıştırın. Cloudflare → Workers & Pages → diploma-zinciri → Settings → Variables and Secrets bölümünde **Secret** türünde `UNIVERSITY_KEY_JSON` ekleyin. Bu anahtarı **değiştirmeyin**: değişirse daha önce düzenlenen bütün VC'ler doğrulanamaz.
3. `ROLE_EMAILS_JSON`, `BREVO_API_KEY`, `MAIL_FROM` ve `APP_ORIGIN` V2'deki gibi kalır.
4. Artık kullanılmayan `SIGNING_KEYS_JSON` secret'ını, V3 canlıda doğrulandıktan sonra silebilirsiniz. Eski V2 diplomaları imzalarındaki açık anahtarla doğrulandığı için bu secret'a ihtiyaç duymaz.
5. `pnpm test && pnpm check && pnpm build`, ardından *Actions → Deploy server*.
6. Canlıda ilk kontrol: `https://<site>/api/did/did.json` adresi DID belgesini, `https://<site>/api/status-list` adresi bir `vc+jwt` döndürmeli.
7. Dört hesap da kendi tarayıcısında *Dijital kimliğim* bölümünden kimlik oluşturmalı. Sonra bir dosyayı baştan sona ilerletin.

## Mevcut kayıtlar

- V2 ile düzenlenmiş diplomalar ve QR'ları aynen çalışır (eski kayıt olarak gösterilir) ve iptal edilebilir.
- İmzaları tamamlanmış ama kodu oluşturulmamış V2 dosyaları (`ready`) eski yöntemle "Test kaydı oluştur" ile tamamlanabilir.
- Yarım kalan V2 dosyaları ilk okumada VC sürecine taşınır. Eski imzalar geçmişte kalır ama sayılmaz; dört birim VC ile yeniden onaylar.

## Güven modeli ve sınırlar

- Üniversite anahtarı sunucuda durur. Bu doğaldır, çünkü düzenleyen kurum odur. Yetkili anahtarları ise sunucuda **değildir**: sunucu bir yetkili adına onay üretemez.
- Bir yetkili olarak onay verebilmek için üç şey birden gerekir: hesap parolası, hesabın e-posta kutusu (davet bağlantısı) ve kimliğin kayıtlı olduğu tarayıcı.
- Parolası ele geçirilen biri kendi tarayıcısını bağlayabilir. Bu durumda gerçek sahibe e-posta bildirimi gider ve önceki kimlik iptal edilir. Davetler yine e-posta kutusuna gittiği için tek başına onay veremez.
- `did:web` alan adına bağlıdır; alan adını kontrol eden kişi DID belgesini değiştirebilir. 2. aşamada diploma VC özetinin Sepolia'ya yazılması bu riski azaltacak.
- Tarayıcı verileri silinirse anahtar kaybolur; yetkili kimliğini yeniden bağlar. Bu prototip nitelikli elektronik imza, TÜBİTAK entegrasyonu ya da resmî diploma değildir.
