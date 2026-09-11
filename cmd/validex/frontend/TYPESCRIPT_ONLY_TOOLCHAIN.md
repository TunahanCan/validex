# Frontend geliştirme ve derleme

Validex arayüzü `src/main.ts` girişinden yüklenen TypeScript modülleri ve `src/styles.css` ile oluşturulur. TypeScript derleyicisi tarayıcıda çalışabilen ES modülleri üretir; proje içindeki Node betikleri bunları HTML, stil ve statik dosyalarla birlikte dağıtıma hazırlar.

Bu belgedeki komutlar, aksi belirtilmedikçe deponun `validex/` kök dizininde çalıştırılır. Masaüstü uygulamasını kurmak için [README](../../../README.md), test kapsamı için [test rehberi](../../../examples/testlerin-nasil-calistigi.md) kullanılır.

## Çalışma ortamını hazırlama

Masaüstü geliştirmesi Node.js **22.12.0 veya üzeri**, npm ve Go **1.24 veya üzeri** gerektirir. [Masaüstü paket tanımı](../package.json), npm sürümünü `11.7.0`, doğrudan geliştirme bağımlılıklarını Electron `43.2.0` ve TypeScript `5.9.3` olarak belirtir.

```bash
make deps
```

Bu hedef `cmd/validex` içinde `npm ci` çalıştırır ve bağımlılık damgasını yeniler. `package.json` veya `package-lock.json` değiştiğinde kurulum tekrar yapılır. Frontend paketindeki `type: module` alanı, bu dizinin modül biçimini belirler; bağımlılıklar üstteki masaüstü paketinde yönetilir.

## Günlük komutlar

| Kök dizinden komut | İşlem |
| --- | --- |
| `make dev` | Backend'i ve Electron'u derler, frontend sunucusunu başlatır, masaüstü penceresini açar. |
| `npm --prefix cmd/validex run frontend:dev` | Yalnızca frontend geliştirme sunucusunu açar. |
| `npm --prefix cmd/validex run frontend:typecheck` | Bütün frontend TypeScript kaynaklarını çıktı yazmadan denetler. |
| `npm --prefix cmd/validex run electron:typecheck` | Electron kaynaklarını çıktı yazmadan denetler. |
| `npm --prefix cmd/validex run frontend:build` | Üretim frontend dosyalarını oluşturur. |
| `npm --prefix cmd/validex run frontend:test` | Üretim frontend'ini derler ve frontend testlerini çalıştırır. |
| `npm --prefix cmd/validex run build` | Frontend ve Electron derlemelerini yapar. |
| `make build` | Go ikililerini, frontend'i ve Electron'u derleyip masaüstü klasörünü paketler. |
| `make cache_del` | Derleme çıktıları, geçici derleme dosyaları ve E2E test çıktılarını temizler. |

`make dev`, `127.0.0.1` üzerinde `34116` portundan başlayarak boş port arar; seçilen adresi Electron'a aktarır. Sunucu hazır olmadan pencereyi başlatmaz ve uygulama kapandığında sunucuyu durdurur. Bu hedef için `curl` de gerekir.

Yalnızca tarayıcı arayüzünü açarken portu ve izleme davranışını kök dizinden açıkça seçebilirsiniz:

```bash
node cmd/validex/frontend/scripts/dev.mjs --host 127.0.0.1 --port 34117
```

[Geliştirme sunucusu](scripts/dev.mjs), `--host`, `--port`, `--debounce`, `--no-watch` ve `--help` seçeneklerini kabul eder. Varsayılan adres `127.0.0.1:34116`, değişiklik bekleme aralığı 120 ms'dir. `--no-watch` ilk derlemeyi yapıp dosyaları sunar; sonraki değişiklikleri izlemez.

İzleme açıkken `src/`, `public/` ve `tsconfig.typescript-only.json` değişiklikleri yeniden derlemeyi tetikler. Yenilenen sonucu görmek için sayfayı yenileyin. Tarayıcıda açılan geliştirme arayüzünün yerel uygulama köprüsü yoktur; gerçek backend işlemleri için `make dev` kullanın.

## Kaynaktan dağıtım dosyalarına

[build.mjs](scripts/build.mjs) her derlemede yerel TypeScript derleyicisini `cmd/validex/node_modules/typescript/bin/tsc` yolundan çağırır. Üretim girişi [tsconfig.typescript-only.json](tsconfig.typescript-only.json) içindeki `src/main.ts` dosyasıdır; derleyici bu girişin içe aktardığı modülleri de izler.

Derleme ayarları `ES2022`, `NodeNext`, `strict`, `isolatedModules` ve `verbatimModuleSyntax` kullanır. Kaynakta yerel modül yolları yayımlanacak JavaScript uzantısıyla yazılır. Örneğin [main.ts](src/main.ts) şu içe aktarmayı kullanır:

```ts
import { mountApp } from './native/app.js';
```

Derlemenin ardından [package-typescript.mjs](scripts/package-typescript.mjs), üretilen modül yollarını denetler; `index.html` oluşturur, CSS'i `assets/` altına, modülleri `modules/` altına ve `public/` içeriğini çıktı köküne kopyalar. Eksik modüller, çıktı ağacından kaçan yollar ve hesaplanan dinamik içe aktarmalar paketlemeyi durdurur. `public/` içinde `assets`, `modules` ve `index.html` adları ayrılmıştır.

| Kök dizine göre yol | İçerik |
| --- | --- |
| `cmd/validex/frontend/.typescript-build/esm/` | Üretim derlemesinin ve testlerin ara JavaScript dosyaları |
| `cmd/validex/frontend/.typescript-build/dev-esm/` | Geliştirme derlemesinin ara dosyaları |
| `cmd/validex/frontend/dist/` | Üretim HTML, CSS, modül ve statik dosyaları |
| `cmd/validex/frontend/.dev-dist/` | Geliştirme sunucusunun sunduğu dosyalar |
| `cmd/validex/electron/dist/` | Electron ana süreç ve preload derlemesi |
| `build/bin/` | Paketlenmiş masaüstü uygulamaları ve Go ikilileri |

Geliştirme çıktısı kaynak haritalarını ve `window.__VALIDEX_DEV__` işaretini içerir. Üretim paketinde kaynak haritası, `sourceMappingURL` veya geliştirme işareti bulunması hata sayılır. Başarılı paket önce geçici dizinde hazırlanır, sonra hedef dizin değiştirilir; başarısız derleme mevcut dağıtımın yerini almaz.

## Tip denetimi ve test derlemesi

[tsconfig.json](tsconfig.json), `src/**/*.ts` kapsamıyla giriş ağacına bağlı olmayan dahili modülleri de denetler. [tsconfig.test.json](tsconfig.test.json) aynı geniş kapsamı testler için JavaScript'e çevirir. Böylece test edilen dahili kodu yalnızca test amacıyla üretim girişine bağlamak gerekmez.

`frontend:test` önce üretim derlemesini yapar; ardından [run-unit-suite.mjs](scripts/run-unit-suite.mjs), test derlemesini ve Node'un `--test` çalıştırmasını yönetir. Test dosyaları [scripts/](scripts/) içindedir. Electron testleri ise `electron/src/*.test.ts` kaynaklarından derlenir ve masaüstü paketinin `electron:test` komutuyla çalıştırılır.

Frontend betikleri sabitlenmiş TypeScript kurulumunu kullanır. Global bir `tsc` sürümüne geçmek yerine yukarıdaki npm komutlarını kullanın. Electron derleyici ayarları [electron/tsconfig.json](../electron/tsconfig.json) içindedir; bu taraf CommonJS ve Node türlerini kullanır.

## Eşzamanlı derleme ve kesintiler

Üretim ve test işlemleri `.typescript-build/.build-lock`, geliştirme işlemleri `.typescript-build/.dev-build-lock` kilidini kullanır. Ayrı çıktı ağaçları sayesinde geliştirme sunucusu üretim derlemesinin dosyalarını değiştirmez. Test çalıştırıcısı, ortak ara dosyaları okuduğu süre boyunca üretim kilidini tutar.

Kilit bekleme süresi varsayılan olarak 60 saniyedir. Sahip süreç sonlanmışsa kilit otomatik kaldırılır; sahip bilgisi okunamayan kilitlerde beş dakikalık eskime süresi uygulanır. Kilit zaman aşımında önce devam eden derleme veya test sürecini kontrol edin, ardından komutu tekrar çalıştırın. Paketleme betiği, kesintiye uğramış çıktı değişimini bir sonraki çalıştırmada kayıtlı dizin bilgileriyle kurtarır.

Çıktıları sıfırlamak için geliştirme sunucusunu ve testleri kapatıp kök dizinde
`make cache_del` çalıştırın. Bu hedef frontend'in `.typescript-build/`,
`.dev-dist/` ve `dist/` çıktılarını, Electron `dist/` dizinini ve platform
paketlerini temizler. Kaynaklar, `.gitkeep` dosyaları ve `node_modules/`
korunur. Ayrıntılı kapsam [README](../../../README.md) içindedir.

## Masaüstü çıktısını üretme

Her hedef kendi işletim sisteminde, deponun kök dizininde çalıştırılır:

| Komut | Sonuç |
| --- | --- |
| `make linux_app` | `build/bin/Validex/` ve `build/bin/validex_<sürüm>_<mimari>.deb` |
| `make windows_app` | `build/bin/Validex/validex.exe` ve yanındaki uygulama dosyaları |
| `make macos_app` | `build/bin/Validex.app/` |

Linux paketlemesi `dpkg-deb` ve `dpkg-shlibdeps` gerektirir; bunlar `dpkg-dev` paketinden sağlanır. Windows'ta Makefile hedefi GNU Make ve POSIX uyumlu kabuk gerektirir; PowerShell ile eşdeğer derleme adımları [CI iş akışında](../../../.github/workflows/ci.yml) bulunur. Ayrıntılı kurulum ve çalıştırma komutları [README](../../../README.md) içindedir.
