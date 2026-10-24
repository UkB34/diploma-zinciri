# V2.1: sıralı test VC onayları

Akış: öğrenci işleri → fakülte → rektörlük → merkez. Her rolün düğmesi yalnızca e-posta daveti oluşturur. Dosya ancak aynı hesap daveti açıp belgeyi inceleyerek test onay VC’si oluşturmayı onayladıktan ve VC-JWT doğrulandıktan sonra ilerler. Her birim için ayrı issuer kimliği ve imzalı W3C VC Data Model 2.0 kimlik bilgisi kullanılır. Reddet ve bölüm onayı kaldırıldı; düzeltme ve sonradan belge iptali ayrı işlemler olarak korunur.

## Mevcut kullanıcıları koruma

`TEST_ACCOUNTS_JSON` değişmez. Bölüm rolü artık giriş yapamaz. Mevcut devam eden V1 dosyaları ilk okumada, sürüm kontrolüyle V2 öğrenci işleri aşamasına taşınır. Eski olaylar ve onaylar değiştirilmez; imza olarak kabul edilmez. Öğrenci işleri PDF ve eğitim bilgilerini tamamlar, dört yeni VC onayı alınır. V1 tamamlanmış/iptal edilmiş/reddedilmiş dosyalar eski kayıt olarak korunur. Üretime geçişten önce D1 yedeği alın ve V2’yi ayrı test ortamında doğrulayın.

## Cloudflare kurulumu

1. Mevcut D1 binding `DB` korunur. `pnpm run db:migrate` yeni `transcripts` tablosunu ekler. PDF en fazla 1.500.000 bayttır; D1’de ayrı BLOB satırı olarak saklanır. Prototip 100 öğrenci dosyası / 300 PDF ile sınırlıdır. PDF sadece oturum açmış yetkililere indirilir. Yükleme başlık kontrolü yapar, antivirüs taraması yapmaz. Temsili belgeler kullanın.
2. `node scripts/create-signing-keys.mjs` dört rol için farklı ECDSA P-256 test issuer anahtarı üretir. Aynı `SIGNING_KEYS_JSON` Secret VC-JWT imzalama ve doğrulama için kullanılır; yeni Secret veya servis gerekmez. `signing-secrets.local.json` Git tarafından yok sayılır ve mevcut dosyanın üstüne yazılmaz. İçeriğindeki `SIGNING_KEYS_JSON` değerini Cloudflare Secret olarak tanımlayın veya `wrangler secret bulk signing-secrets.local.json` kullanın. Anahtarları koruyun; yeniden üretmek bekleyen davetleri geçersiz kılar.
3. Cloudflare’da `ROLE_EMAILS_JSON` Secret tanımlayın. Anahtarlar giriş kullanıcı adlarıdır; değerler gerçekten erişebildiğiniz posta adresleridir. Örnek (yer tutucuları değiştirin):

```json
{"ogrenci_isleri":"OGRENCI_ISLERI_ADRESI","fakulte":"FAKULTE_ADRESI","rektorluk":"REKTORLUK_ADRESI","merkez":"MERKEZ_ADRESI"}
```

4. E-posta adaptörü Brevo HTTP API kullanır. `BREVO_API_KEY` Cloudflare çalışma ortamında Secret olarak tanımlanır. `MAIL_FROM` ve `APP_ORIGIN` Wrangler `vars` alanında tutulur. Gönderici Brevo’da doğrulanmalıdır. Gmail göndereni için teslimat/spam uyarıları vardır; gerçek teslimi dört alıcıyla ayrıca sınayın. API kabulü teslim edildiği anlamına gelmez. Ağ hatasında otomatik yeniden gönderim yapılmaz; yeniden davet eski bağlantıyı geçersiz kılar. Anahtarı GitHub’a veya build ayarlarına yazmayın.
5. Eksik yapılandırmada onay ilerlemez; açıklayıcı hata gösterilir. Sahte e-posta veya ekranda davet bağlantısı veren üretim kaçış yolu yoktur.
6. `pnpm test`, `pnpm run check`, `pnpm run build` ardından `pnpm run db:migrate && pnpm run deploy`. Ana dalın otomatik yayını varsa birleştirmeden önce yapılandırmayı tamamlayın.

## Test VC güven modeli

- Her rolün özel anahtarı mevcut `SIGNING_KEYS_JSON` Cloudflare Secret içinde tutulur. Sunucu VC-JWT düzenler; her aşamada yalnızca ilgili role ait açık anahtarla doğrulanır. Bu, W3C biçiminde test VC prototipidir; nitelikli e-imza, TÜBİTAK entegrasyonu veya gerçek üniversite issuer kimlik bilgisi değildir.
- Birim onay VC kapsamı: issuer, diploma dosyası, sürüm, belge hash’i, PDF hash’i, yetkili rolü, hesap ve onay isteği kimliği. JOSE ile ES256 (ECDSA P-256/SHA-256) kullanılır. Sunucu zamanı bağımsız zaman damgası değildir.
- Davetler 20 dakika geçerli, tek kullanımlı ve hesaba/role/sürüme/aşamaya bağlıdır. Ham davet tokenı veritabanında saklanmaz; hash’i saklanır. Token URL fragment’ında gönderilir, sayfa açılınca adres çubuğundan kaldırılır. Davet sayfasına dış analiz scriptleri eklemeyin.
- E-posta bağlantısı otomatik imzalamaz. Oturum ve açık onay gerekir. POST isteklerinde origin kontrolü vardır. Oturumlar HttpOnly/Secure/SameSite=Lax cookie kullanır.
- VC doğrulaması ve durum değişikliği aynı revision karşılaştırmalı veritabanı güncellemesinde kaydedilir; eşzamanlı isteklerden yalnızca biri kabul edilir.
- Yeni sürüm bekleyen daveti iptal eder, eski imza/VC kayıtlarını geçmişte tutar ve öğrenci işlerinden yeniden başlar.
- PDF indirmede SHA-256 ayrıca karşılaştırılabilir. Sadece hash, belgenin üniversiteden geldiğini veya içindeki bilgilerin doğru olduğunu kanıtlamaz.
- Dışa aktarılan JSON için `node scripts/verify-signatures.mjs DOSYA.json` kullanılabilir. Bu kontrol paketteki test açık anahtarlarıyla tutarlılık sınar; bağımsız kimlik güvencesi sağlamaz.
- API anahtarları, özel imza anahtarları, gerçek transkriptler ve hesap parolaları GitHub’a eklenmez.

## VC-JWT doğrulaması ve kalan canlı doğrulama

Otomatik testler: PDF yükleme, dört ayrı oturum, sırayla dört e-posta talebi (servis taklidi), VC-JWT üretme/doğrulama, yanlış hesap, tekrar kullanılan davet, onaysız imzalama, değiştirilmiş içerik/imza, eski sürüm daveti, V1 geçişi ve başarısız e-posta sonrası dosyanın ilerlememesi.

Gerçek e-posta teslimi, spam klasörü, servis alıcı izinleri ve Cloudflare üzerinde baştan sona kullanım, kullanıcıya ait servis ayarları tamamlandıktan sonra ayrıca denenmelidir. Kod testlerinin geçmesi e-postanın gerçekten teslim edildiği anlamına gelmez.


## VC-JWT formatı ve doğrulama

- Her aşama için ayrı bir `DiplomaApprovalCredential` üretilir. Düzenleyen birim (issuer), öğrenci/diploma dosyası, sürüm, belge hash’i, transkript hash’i, yetkili hesabı ve onay zamanı VC içine yazılır.
- Her birim onayından sonra sıradaki aşama açılmadan önce sunucu ilgili issuer açık anahtarıyla JWS imzasını ve belge/sürüm/hash alanlarını doğrular.
- Dört onay VC’si geçerli olunca Merkez rolü ayrıca `DiplomaCredential` final test VC’si üretir. Kodla yapılan girişsiz sorgu, final VC imzasını, dört birim VC’sini, sürümü ve iptal durumunu kontrol eder.
- Açık test anahtarları `/api/vc/keys` üzerinden yayımlanır. Anahtarlar test anahtarlarıdır; issuer URI’leri ve veriler bağımsız kurumsal güven köküne bağlı değildir.
- VC-JWT, VC Data Model 2.0 belgesini JOSE/JWS ile güvenceye alır. Bu test uygulaması W3C uyumlu bir kurum kimliği, DID çözümleme altyapısı, cüzdan veya gerçek üniversite anahtar yönetimi sunmaz.
- V2 dijital imza kayıtları yeni onay olarak kabul edilmez. Devam eden dosyaların eski onayları geçmişe taşınır ve güncel sürüm için öğrenci işlerinden başlayarak yeni VC onayları istenir. Önceden tamamlanmış V2 test kayıtları arşiv olarak kalır.
