# V2: sıralı test dijital imzaları

Akış: öğrenci işleri → fakülte → rektörlük → merkez. Her rolün düğmesi yalnızca e-posta daveti oluşturur. Dosya ancak aynı hesap daveti açıp belgeyi inceleyerek imzalamayı onayladıktan ve imza doğrulandıktan sonra ilerler. Reddet ve bölüm onayı kaldırıldı; düzeltme ve sonradan belge iptali ayrı işlemler olarak korunur.

## Mevcut kullanıcıları koruma

`TEST_ACCOUNTS_JSON` değişmez. Bölüm rolü artık giriş yapamaz. Mevcut devam eden V1 dosyaları ilk okumada, sürüm kontrolüyle V2 öğrenci işleri aşamasına taşınır. Eski olaylar ve onaylar değiştirilmez; imza olarak kabul edilmez. Öğrenci işleri PDF ve eğitim bilgilerini tamamlar, dört yeni imza alınır. V1 tamamlanmış/iptal edilmiş/reddedilmiş dosyalar eski kayıt olarak korunur. Üretime geçişten önce D1 yedeği alın ve V2’yi ayrı test ortamında doğrulayın.

## Cloudflare kurulumu

1. Mevcut D1 binding `DB` korunur. `pnpm run db:migrate` yeni `transcripts` tablosunu ekler. PDF en fazla 1.500.000 bayttır; D1’de ayrı BLOB satırı olarak saklanır. Prototip 100 öğrenci dosyası / 300 PDF ile sınırlıdır. PDF sadece oturum açmış yetkililere indirilir. Yükleme başlık kontrolü yapar, antivirüs taraması yapmaz. Temsili belgeler kullanın.
2. `node scripts/create-signing-keys.mjs` dört rol için farklı ECDSA P-256 test anahtarı üretir. `signing-secrets.local.json` Git tarafından yok sayılır ve mevcut dosyanın üstüne yazılmaz. İçeriğindeki `SIGNING_KEYS_JSON` değerini Cloudflare Secret olarak tanımlayın veya `wrangler secret bulk signing-secrets.local.json` kullanın. Anahtarları koruyun; yeniden üretmek bekleyen davetleri geçersiz kılar.
3. Cloudflare’da `ROLE_EMAILS_JSON` Secret tanımlayın. Anahtarlar giriş kullanıcı adlarıdır; değerler gerçekten erişebildiğiniz posta adresleridir. Örnek (yer tutucuları değiştirin):

```json
{"ogrenci_isleri":"OGRENCI_ISLERI_ADRESI","fakulte":"FAKULTE_ADRESI","rektorluk":"REKTORLUK_ADRESI","merkez":"MERKEZ_ADRESI"}
```

4. E-posta adaptörü Brevo HTTP API kullanır. `BREVO_API_KEY` Cloudflare çalışma ortamında Secret olarak tanımlanır. `MAIL_FROM` ve `APP_ORIGIN` Wrangler `vars` alanında tutulur. Gönderici Brevo’da doğrulanmalıdır. Gmail göndereni için teslimat/spam uyarıları vardır; gerçek teslimi dört alıcıyla ayrıca sınayın. API kabulü teslim edildiği anlamına gelmez. Ağ hatasında otomatik yeniden gönderim yapılmaz; yeniden davet eski bağlantıyı geçersiz kılar. Anahtarı GitHub’a veya build ayarlarına yazmayın.
5. Eksik yapılandırmada onay ilerlemez; açıklayıcı hata gösterilir. Sahte e-posta veya ekranda davet bağlantısı veren üretim kaçış yolu yoktur.
6. `pnpm test`, `pnpm run check`, `pnpm run build` ardından `pnpm run db:migrate && pnpm run deploy`. Ana dalın otomatik yayını varsa birleştirmeden önce yapılandırmayı tamamlayın.

## İmza güven modeli

- Özel anahtarlar Cloudflare Secret içinde, sunucunun kontrolündedir. Bu, kendi test anahtarlarımızla gerçek kriptografik imza oluşturan bir prototiptir; nitelikli e-imza, TÜBİTAK entegrasyonu veya kullanıcıya ait USB/mobil imza değildir.
- İmza kapsamı: amaç, dosya kimliği, sürüm, içerik hash’i, PDF hash’i, kullanıcı adı, rol, davet kimliği ve sunucu zamanı. Sunucu zamanı bağımsız zaman damgası değildir.
- Davetler 20 dakika geçerli, tek kullanımlı ve hesaba/role/sürüme/aşamaya bağlıdır. Ham davet tokenı veritabanında saklanmaz; hash’i saklanır. Token URL fragment’ında gönderilir, sayfa açılınca adres çubuğundan kaldırılır. Davet sayfasına dış analiz scriptleri eklemeyin.
- E-posta bağlantısı otomatik imzalamaz. Oturum ve açık onay gerekir. POST isteklerinde origin kontrolü vardır. Oturumlar HttpOnly/Secure/SameSite=Lax cookie kullanır.
- İmza ve durum değişikliği aynı revision karşılaştırmalı veritabanı güncellemesinde kaydedilir; eşzamanlı isteklerden yalnızca biri kabul edilir.
- Yeni sürüm bekleyen daveti iptal eder, eski imzaları geçmişte tutar ve öğrenci işlerinden yeniden başlar.
- PDF indirmede SHA-256 ayrıca karşılaştırılabilir. Sadece hash, belgenin üniversiteden geldiğini veya içindeki bilgilerin doğru olduğunu kanıtlamaz.
- Dışa aktarılan JSON için `node scripts/verify-signatures.mjs DOSYA.json` kullanılabilir. Bu kontrol paketteki test açık anahtarlarıyla tutarlılık sınar; bağımsız kimlik güvencesi sağlamaz.
- API anahtarları, özel imza anahtarları, gerçek transkriptler ve hesap parolaları GitHub’a eklenmez.

## Testler ve kalan canlı doğrulama

Otomatik testler: PDF yükleme, dört ayrı oturum, sırayla dört e-posta talebi (servis taklidi), imza üretme/doğrulama, yanlış hesap, tekrar kullanılan davet, onaysız imzalama, değiştirilmiş içerik/imza, eski sürüm daveti, V1 geçişi ve başarısız e-posta sonrası dosyanın ilerlememesi.

Gerçek e-posta teslimi, spam klasörü, servis alıcı izinleri ve Cloudflare üzerinde baştan sona kullanım, kullanıcıya ait servis ayarları tamamlandıktan sonra ayrıca denenmelidir. Kod testlerinin geçmesi e-postanın gerçekten teslim edildiği anlamına gelmez.

## V2.1: birim bildirimi ve görsel diploma

İmza kaydı veritabanına başarıyla yazıldıktan sonra sıradaki birime Brevo üzerinden inceleme bildirimi gönderilir (öğrenci işleri → fakülte → rektörlük → merkez). Bildirim MAIL_FROM adresinden gelir; metin önceki birimi belirtir. Bu mail imzalama tokenı içermez. Sıradaki yetkili panelden kendi imza davetini ister. Gönderim hatası tamamlanan imzayı geri almaz. Kaydedilmiş bildirim durumu panelde gösterilir; önceki veya sıradaki rol bir dakika arayla yeniden gönderebilir. Otomatik arka plan kuyruğu yoktur. Servisin kabulü posta kutusuna teslim garantisi değildir; belirsiz ağ hatası sonrası manuel tekrar aynı bildirimi iki kez iletebilir.

Merkez imzası ile aynı veritabanı güncellemesinde diploma kodu otomatik oluşturulur. Eski `ready` dosyaları mevcut “Test kaydı oluştur” işlemiyle tamamlanabilir; eski `issued` V2 kayıtları kendi kodlarını korur. `/diploma/TEST-...` adresi girişsiz görsel diploma gösterir. QR kodu uygulama içinde oluşturulur; dış QR servisine veri gönderilmez. Belgeyi yazdırma/PDF kaydetme tarayıcı üzerinden yapılır. Her belgenin kodu farklıdır, tekrar açılışta değişmez.

Genel API yalnızca ad, üniversite, fakülte, program, onay tarihleri, belge kodu, sürüm ve durumu döndürür. Öğrenci numarası, transkript, notlar, hesap adları ve özel anahtarlar paylaşılmaz. Bağlantıyı bilen herkes bu diploma bilgilerini görebilir; temsili veri kullanılır. Sayfa arama motorlarına noindex bildirir. V2 belgesi gösterilmeden önce dört imza ve belge özeti kontrol edilir. İptal edilen belgenin URL’si korunur, sayfada belirgin iptal uyarısı gösterilir. Açık sayfa 30 saniyede bir durumu yeniler; yazdırılmış kopyanın güncel durumu QR üzerinden kontrol edilir. Bu prototip resmî diploma, nitelikli e-imza veya blokzincir kaydı değildir.
