# Validex

<img src="build/appicon.svg" width="80" height="80" alt="Validex ikonu">

Validex, HTTP API'leriyle çalışmak için bir masaüstü uygulamasıdır. İstek
hazırlama, koleksiyon kaydetme, OpenAPI inceleme, mock sunucu ve performans
ölçümünü aynı arayüzde sunar. Masaüstü kabuğu Electron, ağ ve dosya işlemleri
Go ile çalışır. Arayüz Türkçe ve İngilizce kullanılabilir.

Otomasyon için aynı Go servislerini kullanan `validex-cli` bulunur.

## Kaynak koddan çalıştırma

Gereken araçlar:

- Go 1.24 veya üzeri.
- Node.js 22.12 veya üzeri.
- npm ya da Corepack.
- GNU Make ve `curl`.

Aşağıdaki komutları, aksi belirtilmedikçe bu README'nin bulunduğu proje
kökünde çalıştırın:

```bash
make dev
```

Bu komut npm bağımlılıklarını hazırlar, Go arka ucunu ve Electron kodunu
derler, arayüz geliştirme sunucusunu başlatır ve uygulamayı açar. Sunucu
`127.0.0.1` üzerinde boş bir port kullanır; ilk tercih `34116` olur.
Arayüz kaynakları değiştiğinde yeniden derlenir. Go veya Electron kodundaki
değişiklikler için komutu durdurup yeniden başlatın.

Windows'ta GNU Make ve `curl` erişilebilir olan Git Bash kullanın. Linux'ta
grafik masaüstü kitaplıkları, yerel dosya seçimleri için de `zenity` veya
`kdialog` gerekir.

Yalnız tarayıcı arayüzünü geliştirmek için:

```bash
make deps
node cmd/validex/frontend/scripts/dev.mjs
```

Sunucunun yazdığı adresi tarayıcıda açın. Bu kullanımda Electron–Go bağlantısı
kurulmaz; masaüstü dosya işlemleri ve gerçek arka uç çağrıları için `make dev`
kullanın. Arayüz araçlarının ayrıntıları
[frontend geliştirme rehberindedir](cmd/validex/frontend/TYPESCRIPT_ONLY_TOOLCHAIN.md).

## Uygulama paketi oluşturma

Her hedefi kendi işletim sisteminde çalıştırın:

| Komut | Sistem | Oluşturulan uygulama |
| --- | --- | --- |
| `make linux_app` | Debian/Ubuntu tabanlı Linux | `build/bin/validex_<sürüm>_<mimari>.deb` |
| `make windows_app` | Windows | `build/bin/Validex/validex.exe` ve yanındaki dosyalar |
| `make macos_app` | macOS | `build/bin/Validex.app` |

Sürüm [masaüstü paket tanımından](cmd/validex/package.json), mimari derleme
yapılan makineden alınır. Windows ve Linux uygulama klasörlerini taşırken
klasörün tamamını kopyalayın. macOS `.app` paketi varsayılan olarak yerel
ad-hoc imzayla hazırlanır.

Paketleme ve Go çıktıları proje kökündeki `build/bin/` altında toplanır.
`build/` ayrıca platform ikonlarını ve Linux masaüstü şablonunu içerir.
`make build`, geçerli sistemin uygulama klasörünü ve CLI'sini üretir;
Linux'ta `.deb` adımı için `make linux_app` kullanılır.

### Linux kurulumu

`.deb` üretmek için paketleme araçlarını da kurun:

```bash
sudo apt install dpkg-dev
make linux_app
```

Oluşan dosyayı APT ile kurun. Örneğin, `0.2.0` sürümü ve `amd64` mimarisi için:

```bash
sudo apt install ./build/bin/validex_0.2.0_amd64.deb
```

Dosya adını kendi derlemenizde oluşan adla eşleştirin. Aynı sürümü yeniden
kuracaksanız `apt install` komutuna `--reinstall` ekleyin. APT gerekli sistem
kitaplıklarını da kurar. Bu bağımlılıklar derleme sisteminden çıkarıldığı için
başka dağıtım sürümlerine dağıtacağınız paketi hedef sistemle uyumlu bir ortamda
üretin.

Kurulumdan sonra menüden **Validex**'i açabilir veya terminali kullanabilirsiniz:

```bash
validex
validex-cli --help
```

Masaüstü uygulaması ve arka uç `/usr/lib/validex/`, komut girişleri
`/usr/bin/` altındadır. `.deb` dosyasının SHA-256 özeti aynı dizindeki
`.deb.sha256` dosyasına yazılır.

Kullanıcı hesabına klasör olarak kurulum için `make install-linux`
kullanılabilir. Varsayılan kök `~/.local` olur; başka bir konum
`LINUX_INSTALL_PREFIX=/kurulum/koku` ile seçilir. Bu hedef masaüstü uygulaması
ve menü girdisini kurar; ayrı CLI, `build/bin/validex-cli` olarak kalır.

### Kurulumdan sonra menü eski arayüzü açıyorsa

Önce `/usr/bin/validex` ile `.deb` paketinin uygulamasını doğrudan açın.
Bu uygulama güncel olduğu halde menü farklı bir sürüm açıyorsa
`~/.local/share/applications/com.validex.Validex.desktop` dosyasının `Exec`
ve `TryExec` alanlarını kontrol edin. Kullanıcıya özel bu dosya, paketin
`/usr/share/applications/` altındaki menü girdisinden önce seçilir.

`.deb` kurulumunu kullanmak için eski kullanıcı kısayolunu yedekleyip
uygulamalar dizininden taşıyın ve `update-desktop-database ~/.local/share/applications`
çalıştırın. `~/.local/bin/validex` altında ayrı bir eski uygulama varsa onu da
yedekleyip `/usr/bin/validex` bağlantısıyla değiştirin. Böylece menü ve terminal
aynı kurulumu açar. Bu işlem koleksiyon veya uygulama ayarlarını silmeyi gerektirmez.

## Derleme çıktılarını temizleme

Geliştirme sunucusunu ve çalışan testleri kapattıktan sonra proje kökünde:

```bash
make cache_del
```

Bu komut `build/bin/` içindeki uygulama, CLI ve `.deb` çıktılarını,
`build/dev/` dizinini, frontend/Electron derlemelerini, derleme geçici
dosyalarını ve E2E test çıktılarını temizler. `build/` içindeki kaynak ikonlar
ve Linux masaüstü şablonu, `.gitkeep` dosyaları, npm bağımlılıkları ve
koleksiyon/ayar dosyaları korunur. Sonraki `make dev` veya platform paketleme
komutu gerekli çıktıları yeniden oluşturur.

`cache_del` kurulu uygulamayı kaldırmaz. Linux sistem paketini kaldırmak için:

```bash
sudo apt remove validex
```

## Arayüzde çalışma

| Alan | Kullanım |
| --- | --- |
| Requests | HTTP isteği oluşturma, cURL içe aktarma, yanıtı ve bağlantı zamanlarını inceleme. Koleksiyonlar ve OpenAPI'den alınan endpoint'ler bu alanın yan panelindedir. |
| Mock Server | Route tanımlama veya OpenAPI'den aktarma, yerel mock sunucusunu başlatma ve gelen istekleri izleme. |
| JSON Lab | JSON biçimlendirme, karşılaştırma, JSON Path, şema ve örnek veri araçları. |
| Diagnostics | Spring hata metinleri, JWT, Actuator, thread dump, log, ortam karşılaştırması ve endpoint kapsamı inceleme. |
| Performance | Bir URL için örnek sayısı, eşzamanlılık ve ısınma ayarlama; gecikme, throughput ve hata ölçümlerini karşılaştırıp dışa aktarma. |

Koleksiyonlar Postman Collection v2.1 biçiminde içe ve dışa aktarılabilir.
İçe aktarma sonucundaki uyarılar, dönüştürülemeyen alanları gösterir.
OpenAPI işlemlerini denemek için [örnek sözleşmeyi](openapi.sample.yaml)
kullanabilirsiniz.

### Yerel bir API ile deneme

Ayrı bir terminalde proje kökünden test sunucusunu başlatın:

```bash
cd tests/e2e
go run ./cmd/mock-api -addr 127.0.0.1:18080
```

Uygulamada `GET http://127.0.0.1:18080/actuator/health` isteği oluşturup
gönderin. Yanıtın HTTP durumu `200`, JSON içindeki `status` değeri `UP` olur.
İsteği bir koleksiyona kaydedip tekrar açabilirsiniz. Sunucuyu `Ctrl+C` ile
kapatın.

## CLI ile otomasyon

CLI'yi kaynak koddan hazırlayın:

```bash
make build-cli
./build/bin/validex-cli --help
```

Aşağıdaki örnekler proje kökünde çalıştırılır. `inspect` ve `run` örnekleri,
yukarıdaki yerel API'nin açık olmasını bekler:

```bash
./build/bin/validex-cli inspect \
  --url http://127.0.0.1:18080/actuator/health --json

./build/bin/validex-cli lint --file openapi.sample.yaml --json

./build/bin/validex-cli run \
  --file collection.sample.json --variables - --json <<'JSON'
{"baseUrl":"http://127.0.0.1:18080"}
JSON
```

`run`, [örnek koleksiyondaki](collection.sample.json) Validex runner JSON
biçimini kullanır. Bu dosya, masaüstünün koleksiyon kayıt dosyası veya Postman
dışa aktarımıyla aynı biçimde değildir. `--variables` ile bir JSON dosyası da
verilebilir. Komut seçenekleri `run --help`, `inspect --help` ve `lint --help`
ile görüntülenir. Windows'ta kaynak derleme çıktısının adına `.exe` ekleyin.

Çıkış kodu `0` başarıyı, `1` işlem veya doğrulama başarısızlığını, `2` komut
kullanım hatasını belirtir. `lint --strict`, uyarıları da başarısızlık sayar.

## Verilerin konumu

Masaüstü koleksiyon kütüphanesi yerel bir JSON dosyasında tutulur:

| Sistem | Varsayılan yol |
| --- | --- |
| Linux | `~/.config/Validex/collection-library.json` |
| macOS | `~/Library/Application Support/Validex/collection-library.json` |
| Windows | `%AppData%\Validex\collection-library.json` |

Linux'ta `XDG_CONFIG_HOME` ayarlanmışsa onun altındaki `Validex/` dizini
kullanılır. Arayüz tercihleri uygulama profilinin `localStorage` alanına
kaydedilir. Koleksiyon dosyası şifrelenmez; yedekleme veya aktarım yaparken
koleksiyon içeriğini esas alın.

## Testler ve teknik belgeler

| Komut | Kapsam |
| --- | --- |
| `make test` | Electron ve frontend tür kontrolleri, Node testleri, Go birim testleri. |
| `make test-e2e` | Chrome/Chromium üzerinde arayüz kabul senaryoları. |
| `make test-production` | Yukarıdaki kontroller, Go yarış koşulu denetimi ve `go vet`. |

- [Mimari](architect.md): süreçler, veri akışı ve kodun sorumlulukları.
- [Test rehberi](examples/testlerin-nasil-calistigi.md): test hazırlığı, E2E ve gerçek Electron denetimleri.
- [Frontend geliştirme rehberi](cmd/validex/frontend/TYPESCRIPT_ONLY_TOOLCHAIN.md): derleyici, geliştirme sunucusu ve arayüz paketleme.
- [Uygulama kimliği](docs/security-registration.md): süreç bilgileri, günlükler ve kurumsal kayıt için doğrulama.
- [Üçüncü taraf bildirimleri](THIRD_PARTY_NOTICES.md): bağımlılıklar ve lisans metinleri.
