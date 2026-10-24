# V2 geliştirme dalı

Dört aşamalı, W3C VC-JWT biçiminde test onay akışı ve PDF transkript yükleme için [V2 kurulum notlarına](V2-SETUP.md) bakın. Aşağıdaki önceki sürüm notları V1 bağlamını korur.

# Diploma Zinciri

Mezuniyet dosyalarının ayrı yetkili hesaplarıyla sırayla onaylandığı, ortak veritabanı kullanan toplantı prototipi.

**Durum:** Kaynak kodları hazırdır. Bu repoya aktarım yeni bir canlı site yayımlamaz. Cloudflare hesabı ve D1 veritabanı bağlandıktan sonra sunuculu sürüm yayımlanabilir. GitHub Pages tek başına bu uygulamayı çalıştırmaz.

## Özellikler

- Önceden tanımlı öğrenci işleri, bölüm, fakülte, rektörlük ve merkez hesapları.
- Girişten sonra hesaba özel panel; rol değiştirme menüsü yoktur.
- Sunucuda sıra ve yetki kontrolü; gerekçeli düzeltme ve ret.
- Yeni belge sürümünde onayların yeniden alınması.
- İşlem geçmişinde öğrenci listesi; seçilen öğrencinin yalnızca kendi dosya geçmişi. Aynı adlar öğrenci/dosya numarasıyla ayrılır.
- Ortak D1 veritabanı, eşzamanlı değişiklik kontrolü, oturum sonlandırma.
- Test doğrulama kodu ve iptal. Test issuer anahtarları dışında gerçek üniversite güven kökü, NFT, blokzincir veya nitelikli e-imza bağlı değildir.
- Yeni sitenin adresine göre oluşturulan Windows masaüstü kısayolu.

## Çalışma yapısı

React arayüzü ve Vinext sunucusu aynı Cloudflare Worker üzerinde çalışır. Hesap parolaları PBKDF2 özetleriyle sunucu secret'ında; oturumlar ve dosyalar D1'de tutulur. Kod GitHub'dadır. Yayın adresi `https://diploma-zinciri.<hesap-alt-alani>.workers.dev` biçiminde olur; kesin adres yayın sırasında belirlenir.

Yeni sunucu kendi örnek veri setini oluşturur. Eski sunucunun işlem kayıtları ve hesap secret'ları bu repoya kopyalanmamıştır. Yalnızca temsili öğrenci verisi kullanın. Bütün yetkililer prototipin ortak üniversite dosyalarını görebilir; gerçek kurum/birim bazlı erişim kapsamı henüz yoktur.

## İlk kurulum

Node.js 22.13+ ve package.json içindeki sürüme uygun pnpm gerekir.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
```

1. Cloudflare hesabında Workers ve D1 için ücretsiz planı seçin; hizmet kotaları geçerlidir.
2. `pnpm exec wrangler login` ile giriş yapın.
3. `pnpm exec wrangler d1 create diploma-zinciri` çalıştırın. Dönen database_id değerini `wrangler.json` içindeki yer tutucu ile değiştirin.
4. Bilgisayarınızda, Git tarafından yok sayılan `accounts.local.json` dosyası oluşturun. Her rol için farklı, en az 12 karakterlik parola kullanın:

```json
[
  {"username":"ogrenci_isleri","role":"registrar","password":"KENDI_PAROLANIZ_1"},
  {"username":"bolum","role":"department","password":"KENDI_PAROLANIZ_2"},
  {"username":"fakulte","role":"faculty","password":"KENDI_PAROLANIZ_3"},
  {"username":"rektorluk","role":"rector","password":"KENDI_PAROLANIZ_4"},
  {"username":"merkez","role":"central","password":"KENDI_PAROLANIZ_5"}
]
```

5. `pnpm accounts accounts.local.json` çalıştırın. Oluşan `.dev.vars` dosyasındaki TEST_ACCOUNTS_JSON değerini (dış tek tırnaklar olmadan) secret olarak kullanın. Bu dosyaları veya parolaları repoya eklemeyin.

### GitHub üzerinden yayın

Repository **Settings → Secrets and variables → Actions** bölümünde:

| Tür | Ad | Değer |
|---|---|---|
| Secret | CLOUDFLARE_API_TOKEN | İlgili Cloudflare hesabına sınırlandırılmış Workers Scripts Edit ve D1 Edit izinli token |
| Secret | CLOUDFLARE_ACCOUNT_ID | Cloudflare hesap ID'si |
| Secret | TEST_ACCOUNTS_JSON | Yukarıdaki araçla oluşturulan JSON hesap özetleri |
| Variable | CLOUDFLARE_DATABASE_ID | Oluşturduğunuz D1 database_id |

Ardından **Actions → Deploy server → Run workflow**. İş akışı testleri ve derlemeyi çalıştırır, SQL tablolarını oluşturur, hesap secret'ını yükler ve Worker'ı yayımlar. Yayın adresini Wrangler çıktısında veya Cloudflare panelinde görün. Workflow çalıştırılmadan yeni site aktif değildir.

### Bilgisayardan alternatif yayın

```sh
pnpm build
pnpm db:migrate
pnpm exec wrangler secret put TEST_ACCOUNTS_JSON --config dist/server/wrangler.json
pnpm deploy
```

Secret komutu sorunca üretilen JSON'u girin. Hesap şifrelerini ekip üyelerine ayrıca iletin. `.dev.vars` dosyasını yalnızca geliştirme bilgisayarınızda tutun.

## Toplantı senaryosu

1. Bölüm hesabıyla Ada Yıldız dosyasını onaylayın.
2. Çıkış yapıp fakülte hesabıyla girin; düzeltme isteyin.
3. Öğrenci işleri hesabıyla yeni sürüm oluşturun.
4. Bölümden başlayarak onayları yeniden tamamlayın.
5. Merkez hesabıyla test doğrulama kaydı üretin.
6. İşlem geçmişinde Ada Yıldız'ı seçin; yalnızca bu dosyanın olaylarını inceleyin.

## Doğrulama

Aktarım sırasında 8 iş akışı/oturum testi, TypeScript kontrolü ve üretim derlemesi geçti. Yeni Cloudflare hesabında canlı yayın ve tarayıcı testi henüz yapılmadı.

## Dosyalar

- `app/`: giriş, doğrulama ve yönetim ekranları; sunucu API'leri.
- `lib/workflow.mjs`: sıralı onay ve olay zinciri.
- `lib/auth*`: oturum ve parola kontrolleri.
- `drizzle/*.sql`: veritabanı tabloları.
- `tests/`: akış ve oturum testleri.
- `.github/workflows/`: kontrol ve isteğe bağlı sunucu yayını.

Resmî kurulum belgeleri: [Cloudflare D1](https://developers.cloudflare.com/d1/), [Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
