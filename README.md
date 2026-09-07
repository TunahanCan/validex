<p align="center">
  <img src="cmd/validex/build/appicon.svg" width="144" height="144" alt="Validex uygulama ikonu">
</p>

<h1 align="center">Validex</h1>

<p align="center">
  <strong>API geliştirme, test ve hata ayıklama için yerel masaüstü çalışma alanı.</strong>
</p>

<p align="center">
  HTTP Requests · Collections · OpenAPI · Mock Server · JSON Lab · Diagnostics · Performance · SSE · Automation
</p>

Validex; HTTP isteği hazırlama, yanıt inceleme, koleksiyon yönetimi ve API
testlerini tek uygulamada toplar. Hesap gerektirmez; koleksiyonlar
bilgisayarınızda saklanır, API istekleri Go arka ucundan hedef sunucuya gönderilir.
macOS, Linux ve Windows için Electron masaüstü uygulaması; otomasyon için
ayrıca bağımsız bir CLI sunar. Arayüz Türkçe ve İngilizce kullanılabilir.

## Özellikler

| Alan | Yapabilecekleriniz |
| --- | --- |
| Requests | Method, URL, query, header ve body düzenleme; cURL içe aktarma; yanıt, cookie ve bağlantı zamanlamasını inceleme. |
| Collections | Koleksiyon ve klasörlerle istekleri düzenleme, kaydetme, taşıma; Postman Collection v2.1 içe/dışa aktarma. |
| OpenAPI | YAML/JSON belge yükleme, endpoint’ten istek oluşturma ve yanıtın sözleşmeden sapmalarını inceleme. |
| Mock Server | Elle veya OpenAPI’den route oluşturma; durum kodu, header, body ve gecikme tanımlama. |
| JSON Lab | JSON biçimlendirme, karşılaştırma, JSON Path sorgulama, şema çıkarma ve örnek veri üretme. |
| Diagnostics | Spring hataları, JWT, Actuator, thread dump, log arama ve ortam farklarını inceleme. |
| Performance | Tekrarlı isteklerle gecikme, yüzdelikler, throughput ve hata oranını ölçme; koşuları karşılaştırma. |
| SSE | Header ve timeout desteğiyle Server-Sent Events akışlarını canlı izleme ve durdurma. |
| Automation | Kayıtlı koleksiyonları veya runner JSON tanımlarını çalıştırma, assertion sonuçlarını inceleme, network inspection ve OpenAPI lint. |
| CLI | Koleksiyon çalıştırma, ağ inceleme ve OpenAPI lint işlemlerini terminalde veya CI içinde kullanma. |

## Hızlı başlangıç

Kaynak koddan masaüstü uygulamasını çalıştırmak için:

- Go **1.24+**
- Node.js **22.12+**
- npm veya Corepack
- GNU Make ve `curl`

Repository kökünde:

```bash
make dev
```

Komut eksik npm bağımlılıklarını kurar, Go arka ucunu ve Electron kabuğunu
derler, TypeScript geliştirme sunucusuyla masaüstü uygulamasını açar.
Sunucu `127.0.0.1` üzerinde dinler; `34116` doluysa uygun bir port seçilir.
Go veya Electron kaynaklarını değiştirdiğinizde `make dev` komutunu yeniden
başlatın.

Windows’ta Make hedeflerini GNU Make ve `curl` erişilebilir olan Git Bash
üzerinden çalıştırın. PowerShell ile paketleme adımları
[CI yapılandırmasında](.github/workflows/ci.yml) bulunur.

Yalnız bağımlılıkları hazırlamak için `make deps` kullanın. Make, PATH’te
`npm` bulamazsa Corepack üzerinden npm çalıştırmayı dener. Doğrudan kurulum:

```bash
cd cmd/validex
npm ci
```

### İlk deneme

1. **Requests** alanında bir HTTP isteği oluşturup kendi API’nize gönderin.
2. Yanıtın durum kodunu, body’sini, header’larını ve zamanlamasını inceleyin.
3. İsteği bir koleksiyona kaydedin; tekrar kullanın veya Automation’da çalıştırın.
4. [openapi.sample.yaml](openapi.sample.yaml) dosyasını yükleyerek OpenAPI ve mock server akışlarını deneyin.

Hazır bir yerel API için ayrı terminalde aşağıdaki test sunucusunu açabilirsiniz:

```bash
cd tests/e2e
go run ./cmd/mock-api -addr 127.0.0.1:18080 -environment primary
```

Ardından Requests alanından `GET http://127.0.0.1:18080/actuator/health`
isteğini gönderin. Bu sunucu ayrıca JSON, XML, metin, binary, Problem Details,
yönlendirme, yavaş istek ve SSE senaryoları sağlar.
`GET /__validex/stats` sayaçları gösterir; `POST /__validex/reset` sıfırlar.

### Yalnız arayüzü geliştirme

Bağımlılıkları kurduktan sonra repository kökünde:

```bash
node cmd/validex/frontend/scripts/dev.mjs
```

Arayüzü `http://127.0.0.1:34116` adresinde açın. Bu profilde Go arka ucu ve
masaüstü köprüsü çalışmaz; gerçek API istekleri, yerel dosya seçimi ve masaüstü
koleksiyon kaydı için `make dev` kullanın. Tarayıcı profilindeki koleksiyonlar
`localStorage` içinde tutulur.

## Koleksiyon aktarımı ve veri saklama

Postman **Collection v2.1** dosyaları içe ve dışa aktarılabilir. İçe aktarımda
klasör yolları istek adlarına dönüştürülür. Script/test kodları, değişken
değerleri ve kayıtlı yanıt örnekleri aktarılmaz; değişken referansları korunur.
Desteklenmeyen auth, body ve taşıma ayarları için aktarım uyarılarını inceleyin.

Masaüstü koleksiyon kütüphanesi `os.UserConfigDir()` altındaki
`Validex/collection-library.json` dosyasında saklanır:

| Platform | Varsayılan konum |
| --- | --- |
| macOS | `~/Library/Application Support/Validex/collection-library.json` |
| Linux | `~/.config/Validex/collection-library.json` (`XDG_CONFIG_HOME` ayarlıysa onun altında) |
| Windows | `%AppData%\Validex\collection-library.json` |

Tema, açık sekmeler ve panel düzeni Chromium profilindeki `localStorage`
içinde tutulur. Eski WebView sürümünden gelen koleksiyon dosyası korunur;
arayüz tercihleri Chromium’a otomatik taşınmaz.

Koleksiyon dosyası şifreli değildir. Arayüz, kaydederken hassas olarak tanınan
header değerlerini temizler; `{{variable}}` referanslarını koruyabilir. Bu
mekanizma body veya URL içindeki tüm hassas verileri temizleyen bir kasa
değildir. Çalışma anındaki değerleri değişkenlerle sağlayın; paylaşacağınız
koleksiyonun içeriğini kontrol edin.

## CLI kullanımı

CLI, Node.js ve Electron gerektirmez. Go ve Make ile derleyin:

```bash
make build-cli
./cmd/validex/build/bin/validex-cli --help
```

Make olmadan `go run ./cmd/validex-cli --help` ile de çalıştırabilirsiniz.
Windows’ta derlenen dosyanın adı `validex-cli.exe` olur.

### Koleksiyon çalıştırma

CLI, Validex runner JSON formatını kullanır; örnek tanım
[collection.sample.json](collection.sample.json) içindedir. Bu format,
masaüstünün koleksiyon kütüphanesi veya Postman dışa aktarım dosyasıyla aynı değildir.

Yukarıdaki yerel test sunucusu açıkken repository kökünde:

```bash
./cmd/validex/build/bin/validex-cli run \
  --file collection.sample.json \
  --variables - <<'JSON'
{"baseUrl":"http://127.0.0.1:18080"}
JSON
```

Bu örnek `/actuator/health` yanıtında HTTP 200, `$.status == "UP"` ve iki
saniyenin altında yanıt süresi bekler. `--variables` bir JSON dosyası da alır;
değerler string olmalıdır ve koleksiyondaki aynı adlı değişkenleri geçersiz kılar.
Makine tarafından işlenecek rapor için `--json` ekleyin.

### Ağ inceleme ve OpenAPI lint

```bash
./cmd/validex/build/bin/validex-cli inspect \
  --url http://127.0.0.1:18080/actuator/health \
  --timeout 15s --max-redirects 10 --json

./cmd/validex/build/bin/validex-cli lint \
  --file openapi.sample.yaml --json
```

`lint --strict`, uyarıları da başarısızlık sayar. `run` ve `lint` için
`--file -` standart girdiden okur; `--file` ve `--variables` aynı anda standart
girdi kullanamaz. Her komutun seçenekleri `<komut> --help` ile görülebilir.

| Çıkış kodu | Anlamı |
| --- | --- |
| `0` | Başarılı işlem. |
| `1` | İşlem hatası, başarısız koleksiyon testi veya lint bulguları nedeniyle başarısız sonuç. |
| `2` | Eksik/geçersiz argüman veya bilinmeyen komut. |

## Derleme ve paketleme

Geçerli işletim sistemi ve CPU mimarisi için:

```bash
make build
```

| Platform | Masaüstü çıktısı | Çalıştırma |
| --- | --- | --- |
| macOS | `cmd/validex/build/bin/Validex.app` | `open cmd/validex/build/bin/Validex.app` |
| Linux | `cmd/validex/build/bin/Validex/` | `./cmd/validex/build/bin/Validex/validex` |
| Windows | `cmd/validex/build/bin/Validex/` | PowerShell: `.\cmd\validex\build\bin\Validex\validex.exe` |

CLI de `cmd/validex/build/bin/` altında üretilir. Linux ve Windows’ta
`Validex` klasörünün tamamını birlikte taşıyın; Chromium, arayüz ve Go arka
ucu paketin parçalarıdır.

- macOS çıktısı yerel kullanım için ad-hoc imzalanır. Dağıtım için Developer ID imzası ve notarization ayrıca hazırlanmalıdır.
- Linux’ta yerel dosya seçimi için `zenity` veya `kdialog`, uygulama için dağıtımın GUI kitaplıkları gerekir.
- Electron kendi Chromium motorunu içerir; sistem WebView2 veya WebKitGTK kurulumuna bağlı değildir.

Paketleme betiği çalıştırılabilir uygulama klasörü üretir. Installer, otomatik
güncelleme, cross-build ve yayın imzalama hattı bu repository’de sağlanmaz.

Linux’ta kullanıcı hesabına kurulum:

```bash
make install-linux
# İsteğe bağlı farklı kurulum kökü:
make install-linux LINUX_INSTALL_PREFIX=/your/install/prefix
```

Varsayılan kök `~/.local` dizinidir; komut uygulamayı derler, kurar ve masaüstü
menü girdisini oluşturur.

## Testler

| Komut | Kapsam |
| --- | --- |
| `make test` | Electron ve frontend TypeScript kontrolleri, Node testleri ve Go testleri. |
| `make test-e2e` | Derlenmiş frontend üzerinde tarayıcı kabul senaryoları. |
| `make test-production` | Yukarıdakilerin tamamı, Go race detector ve `go vet`. |

E2E testleri Chrome veya Chromium gerektirir. Otomatik bulunamazsa:

```bash
VALIDEX_E2E_CHROME=/path/to/chrome make test-e2e
```

Test düzeni ve senaryoların açıklaması
[examples/testlerin-nasil-calistigi.md](examples/testlerin-nasil-calistigi.md)
içindedir. CI, kalite ve tarayıcı testlerine ek olarak macOS, Linux ve Windows
paketlerinin beklenen dosyalarını doğrular.

## Proje yapısı

```text
cmd/
  validex/            Electron kabuğu, TypeScript arayüzü ve paketleme
    electron/         Main process, preload ve Go süreç yönetimi
    frontend/         Arayüz, stiller ve geliştirme araçları
  validex-backend/    Masaüstünün Go arka uç süreci
  validex-cli/        CLI giriş noktası
internal/            HTTP, OpenAPI, mock, runner, diagnostics ve bridge servisleri
tests/e2e/           Tarayıcı kabul testleri ve yerel mock API
examples/            Test akışlarının açıklamaları
```

Arayüz browser-native TypeScript ile yazılmıştır. Electron preload, renderer’a
izin listeli bir API sunar; ağ ve dosya işlemleri Go arka ucunda yürütülür.
Renderer sandbox içinde çalışır ve Node API’lerine doğrudan erişmez.
`window.canbridge.Bridge`, bu API’nin uyumluluk adıdır. Electron ile Go
arasındaki iletişim, standart girdi/çıktı üzerinden çerçevelenmiş JSON kullanır.

Süreç sınırları, veri akışları ve mimari kararlar için
[architect.md](architect.md); üçüncü taraf bileşenlerin lisans bildirimleri
için [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasına bakın.
