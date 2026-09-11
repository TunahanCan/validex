# Validex testlerini çalıştırma

Validex doğrulaması Go paket testleri, frontend ve Electron testleri, tarayıcı kabul senaryoları ve işletim sistemi paket kontrollerinden oluşur. Bu rehber, depodaki çalışan hedefleri ve her birinin sınırlarını açıklar.

Komutlar aksi belirtilmedikçe deponun `validex/` kök dizininde çalıştırılır. Go **1.24 veya üzeri**, Node.js **22.12.0 veya üzeri**, npm ve GNU Make kurulu olmalıdır. `make deps`, [masaüstü paket kilidindeki](../cmd/validex/package-lock.json) bağımlılıkları kurar; `make test` ve `make test-e2e` bu adımı kendileri çağırır.

## Hangi komut neyi doğrular?

| Komut | Kapsam |
| --- | --- |
| `make test` | Electron ve frontend tip denetimleri, bunların testleri ve kök Go modülündeki testler |
| `make test-e2e` | Üretim frontend derlemesi ve ayrı `tests/e2e` Go modülündeki testler |
| `make test-production` | Önce `make test`, sonra tarayıcı testleri, kök Go modülü için yarış denetimi ve `go vet` |

Günlük değişikliklerde temel doğrulama:

```bash
make test
```

Arayüz akışını veya paketlemeye giden üretim çıktısını etkileyen değişikliklerde daha geniş doğrulama:

```bash
make test-production
```

`make test-production` masaüstü paketi oluşturmaz. Tarayıcı testleri için ayrıca Chrome veya Chromium gerekir. Go yarış denetimi, kullanılan platformda desteklenen bir C derleyicisi ve etkin cgo gerektirir.

## Go ve TypeScript katmanları

Kök [go.mod](../go.mod), uygulamanın Go paketlerini tanımlar. Testler HTTP yürütme, OpenAPI, koleksiyon saklama, assertion değerlendirme, runner, tanılama, mock sunucu, köprü çağrıları, CLI ve uygulama kimliği davranışlarını kapsar. İlgili paketi veya tüm kök modülü ayrı çalıştırabilirsiniz:

```bash
go test ./internal/httpexec/...
go test ./...
go test -race ./...
go vet ./...
```

`tests/e2e` kendi `go.mod` dosyasına sahiptir; kök dizindeki `go test ./...` bu modülün testlerini çalıştırmaz.

Frontend veya Electron üzerinde çalışırken kök dizinden:

```bash
make deps
npm --prefix cmd/validex run frontend:typecheck
npm --prefix cmd/validex run frontend:test
npm --prefix cmd/validex run electron:typecheck
npm --prefix cmd/validex run electron:test
```

Frontend testleri, [scripts/](../cmd/validex/frontend/scripts/) altındaki Node test dosyalarıdır. Üretim derlemesinin ardından `run-unit-suite.mjs`, `tsconfig.test.json` ile bütün `src/**/*.ts` kaynaklarını derler ve Node test çalıştırıcısını başlatır. Koleksiyon aktarımı, saklama, istek düzenleyicisi, performans analizi, pano ve derleme/sunucu davranışları burada denetlenir.

Electron testleri [electron/src/](../cmd/validex/electron/src/) içindeki TypeScript testlerini ve [masaüstü betik testlerini](../cmd/validex/scripts/) çalıştırır. Yan süreç iletişimi, kimlik, pano, başlatıcı, grafik uyumluluğu ve platform paket yardımcıları bu katmandadır. Bu testlerin geçmesi, gerçek masaüstü penceresinin açıldığı anlamına gelmez.

Derleyici sürümü, ara çıktılar ve kilit davranışı [frontend derleme rehberinde](../cmd/validex/frontend/TYPESCRIPT_ONLY_TOOLCHAIN.md) açıklanır.

## Tarayıcı kabul senaryoları

[TestFeatures](../tests/e2e/suite_test.go), [features/](../tests/e2e/features/) dizinindeki Gherkin senaryolarını Godog ile çalıştırır. [Tarayıcı düzeneği](../tests/e2e/browser_test.go), üretim `frontend/dist/` çıktısını geçici bir HTTP sunucusunda sunar ve chromedp ile headless Chrome açar.

Her senaryo ayrı tarayıcı bağlamı kullanır. [native_bridge.js](../tests/e2e/fixtures/native_bridge.js) kontrollü köprü yanıtları sağlar; böylece istek düzenleme, koleksiyonlar, mock arayüzü, JSON araçları, gezinme, erişilebilirlik, saklama hataları ve performans akışları tekrarlanabilir girdilerle sınanır. Bu düzende gerçek Electron ana süreci ve Go yan süreci başlatılmaz.

```bash
make test-e2e
```

Düzenek sırasıyla `google-chrome`, `google-chrome-stable`, `chromium` ve `chromium-browser` yürütülebilirlerini arar. Tarayıcı farklı yerdeyse kök dizinden tam yol verin:

```bash
VALIDEX_E2E_CHROME=/usr/bin/chromium make test-e2e
```

Etiketle daraltılmış çalıştırmalar da kök dizinden yapılır:

```bash
VALIDEX_E2E_TAGS='@smoke' make test-e2e
VALIDEX_E2E_TAGS='@requests or @request-contract' make test-e2e
VALIDEX_E2E_TAGS='@accessibility or @storage-resilience' make test-e2e
```

Etiket filtresi `TestFeatures` içindeki Godog senaryolarını seçer; aynı Go modülündeki diğer testleri filtrelemez. Önceden üretim frontend'i derlenmişse yalnızca Godog çalıştırması için:

```bash
cd tests/e2e
VALIDEX_E2E_TAGS='@smoke' go test -run '^TestFeatures$' -count=1 -timeout=15m -v .
```

Bu blok `tests/e2e` dizininde sonlanır. Sonraki kök komutlarına geçmeden önce `cd ../..` çalıştırın.

## Başarısız senaryodan kanıt toplama

Tarayıcı testleri bir adım başarısız olduğunda veya frontend hatası kaydettiğinde [tests/e2e/artifacts/](../tests/e2e/artifacts/) altına ekran görüntüsü (`.png`), sayfanın HTML'i (`.html`) ve konsol kaydı (`.console.txt`) yazar. Dosya adı senaryo adını ve kimliğinden üretilen eki içerir.

Yeni Godog çalıştırması, bu dizindeki önceki dosyaları `.gitkeep` dışında temizler. İncelenecek kanıtları tekrar çalıştırmadan önce başka yere kopyalayın. Senaryo zaman aşımı 60 saniye, `make test-e2e` içindeki Go süiti zaman aşımı 15 dakikadır. Süre aşımında önce senaryo çıktısını ve konsol kaydını inceleyin.

## Gerçek Electron ile isteğe bağlı denetim

[live_local_api_test.go](../tests/e2e/live_local_api_test.go) iki ek test içerir: `TestLiveLocalAPIAudit` ve `TestLiveURLPerformanceAudit`. `VALIDEX_LIVE_E2E=1` olmadığında bu testler atlanır. Etkinleştirildiklerinde açık Electron penceresine DevTools üzerinden bağlanır ve gerçek Go köprüsünü kullanırlar; testlerin yerel API sunucuları kendileri tarafından açılıp kapatılır.

Yerel API denetimi istekleri, eşzamanlılığı, uygulamanın mock sunucusunu, OpenAPI içe aktarmayı, JSON araçlarını, tanılama ekranlarını ve farklı tema/ekran boyutlarını çalıştırır. Performans denetimi 12 gerçek örneği ve mobil sonuç görünümünü kontrol eder. Her ikisi de bağlandıkları uygulamanın `localStorage` içeriğini temizler; aşağıdaki Linux adımları bu yüzden ayrı bir test yapılandırma dizini kullanır.

Linux masaüstü oturumunda, birinci terminali depo kökünde açın:

```bash
make deps build-backend build-cli
npm --prefix cmd/validex run build
mkdir -p build/dev/live-audit/config
env -u VALIDEX_DEV_URL \
  XDG_CONFIG_HOME="$PWD/build/dev/live-audit/config" \
  VALIDEX_LIVE_OPENAPI_FILE="$PWD/build/dev/live-audit/openapi.yaml" \
  PATH="$PWD/tests/e2e/fixtures/live-bin:$PATH" \
  node cmd/validex/scripts/start-electron.mjs \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9225
```

`9225` portu boş olmalıdır. Bu başlatma üretim frontend'ini `app://validex/` adresinden yükler; denetim bu adresi aradığı için `make dev` ile açılan pencereyi kullanmayın. PATH'in başına eklenen [zenity fixture'ı](../tests/e2e/fixtures/live-bin/zenity), OpenAPI dosya seçimini otomatik yanıtlar. Bu kurulum Linux içindir; diğer sistemlerin yerel dosya seçicileri aynı fixture'ı kullanmaz.

Uygulama penceresi açıldıktan sonra ikinci terminalde depo kökünden:

```bash
export VALIDEX_LIVE_OPENAPI_FILE="$PWD/build/dev/live-audit/openapi.yaml"
cd tests/e2e
VALIDEX_LIVE_E2E=1 \
  VALIDEX_LIVE_E2E_REMOTE=http://127.0.0.1:9225 \
  go test -run '^TestLive(LocalAPI|URLPerformance)Audit$' -count=1 -timeout=20m -v .
```

OpenAPI fixture'ını test oluşturur ve sonunda siler; iki terminalde aynı dosya yolu kullanılır. Denetim görüntüleri de `tests/e2e/artifacts/` altına yazılır. Test bitince ilk terminaldeki uygulamayı kapatın. Port değiştirilirse başlatma parametresiyle `VALIDEX_LIVE_E2E_REMOTE` değerini birlikte değiştirin.

Elle HTTP denemeleri için bağımsız mock API, ayrı bir terminalde ve depo kökünden şu şekilde açılabilir; yukarıdaki otomatik denetimler için bu sunucu gerekli değildir:

```bash
cd tests/e2e
go run ./cmd/mock-api -addr 127.0.0.1:18080 -environment primary
```

## CI ve uygulama paketi kontrolleri

[CI iş akışı](../.github/workflows/ci.yml), Go `1.24.x` ve Node.js `22.12.0` kullanır. `quality` işi tip denetimlerini, frontend/Electron testlerini, kök Go testlerini, `go vet` ve yarış denetimini çalıştırır. `browser-e2e`, Ubuntu üzerinde Chrome'u doğrular ve `make test-e2e` çalıştırır; başarısızlıkta `tests/e2e/artifacts/` dosyalarını yükler. İsteğe bağlı live denetimler bu işlerde etkinleştirilmez.

Paket işleri Linux'ta `make linux_app`, macOS'ta `make macos_app` kullanır. Windows işi eşdeğer Go, npm ve paketleme adımlarını PowerShell ile yürütür. Paketlerde yürütülebilirler, frontend varlıkları, uygulama kimliği ve lisans dosyaları doğrulanır; Linux işi ayrıca `.deb` metaverisini ve sağlama toplamlarını, macOS işi Go ikililerinin imzalarını, Windows işi PE kimlik alanlarını kontrol eder.

Yerel paket komutları kendi işletim sistemlerinde ve depo kökünde çalıştırılır: `make linux_app`, `make windows_app`, `make macos_app`. Tüm son çıktılar kökteki `build/bin/` altındadır. Platform gereksinimleri ve kurulum adımları [README](../README.md) içindedir.
