# Validex uygulama kimliği ve IT kaydı

Validex'i kurum envanterine eklemek veya engellenen bir çalıştırmayı incelemek
için uygulamanın kimlik raporunu kullanın. Rapor, aynı ürüne ait masaüstü,
Go arka ucu ve CLI dosyalarını gerçek yolları ve dosya özetleriyle gösterir.

## Raporu alma

1. İncelenecek Validex paketini başlatın.
2. **Yardım → Uygulama kimliği / Help → Application identity** menüsünü açın.
   Kısayol macOS'ta **Cmd+Shift+F12**, Linux/Windows'ta **Ctrl+Shift+F12**'dir.
3. **Raporu kopyala / Copy report** ile metni alın. **Günlükleri aç / Open logs**
   aynı kaydın JSON ve metin dosyalarını içeren klasörü açar.

Rapor uygulama başlarken toplanır. Farklı bir sürüm veya dosya doğrulanacaksa
ilgili paketi yeniden başlatın. Raporun zamanı, masaüstü/arka uç PID'leri ve
engelleme kaydındaki dosya yolu aynı çalıştırmayla eşleştirilmelidir.

## Ürün ve bileşen bilgileri

| Alan | Değer |
| --- | --- |
| Ürün adı | `Validex` |
| Ortak uygulama kimliği | `com.validex.Validex` |
| Ürün UUID'si | `6a2bf295-cc04-4390-abaf-9ccfcdbc3379` |
| Çalıştırılabilir bileşenler | `desktop`, `backend`, `cli` |

Bu değerlerin kaynağı [ürün bildirimi](../internal/appidentity/manifest.json)
dosyasıdır. Her paket kendi sürümünü, revision bilgisini, platformunu ve
mimarisini taşır; bunları incelenen dosyanın raporundan alın.

| Rapordaki kayıt | Görevi ve kanıtı |
| --- | --- |
| `desktop` | Electron ana süreci; executable yolu, SHA-256, PID ve imza sonucu |
| `backend` | Masaüstünün HTTP(S) isteklerini yapan `validex-backend` alt süreci; dosya bilgisi ve başlatılabildiyse PID |
| `cli` | Ayrı kullanılan `validex-cli` dosyası; raporun aradığı konumda varsa eklenir |
| `application-code` | Electron JavaScript giriş dosyasının yolu ve SHA-256 değeri; ayrı bir süreç değildir |

Rapor ayrıca masaüstünün üst süreç PID'sini, oturum kimliğini, kayıt zamanını,
Electron/Chromium sürümlerini ve çözümlenmiş dosya yollarını içerir. Okunamayan
alanlar `diagnosticErrors` veya ilgili dosyanın `error` alanında belirtilir.

## Dosyaların konumu

Kaynak koddan paketleme çıktıları repository kökündeki `build/bin/` altındadır:

| Platform | Masaüstü | Go arka ucu |
| --- | --- | --- |
| Linux | `build/bin/Validex/validex` | `build/bin/Validex/resources/validex-backend` |
| Windows | `build\bin\Validex\validex.exe` | `build\bin\Validex\resources\validex-backend.exe` |
| macOS | `build/bin/Validex.app/Contents/MacOS/Validex` | `build/bin/Validex.app/Contents/Resources/validex-backend` |

CLI çıktısı `build/bin/validex-cli` veya Windows'ta `validex-cli.exe`'dir.
macOS geliştirme uygulaması `build/dev/Validex.app` altında hazırlanır.

Linux `.deb` kurulumu uygulamayı `/usr/lib/validex/` altına yerleştirir.
Masaüstü dosyası `/usr/lib/validex/validex`, Go bileşenleri bu dizinin
`resources/validex-backend` ve `resources/validex-cli` dosyalarıdır.
`/usr/bin/validex` başlatıcı betiği, `/usr/bin/validex-cli` CLI bağlantısıdır.
`make install-linux` ise varsayılan `~/.local/lib/validex/` kökünü kullanır.
Envantere raporun gösterdiği çözümlenmiş executable yolunu kaydedin.

## Günlükler

Kimlik dosyaları Electron `appData` dizininin `Validex/logs/` altına yazılır:

| Platform | Varsayılan klasör |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/Validex/logs/`; değişken yoksa `~/.config/Validex/logs/` |
| Windows | `%APPDATA%\Validex\logs\` |
| macOS | `~/Library/Application Support/Validex/logs/` |

`application-identity.json` yapılandırılmış rapor, `application-identity.txt`
IT talebine eklenebilen metindir. Başlangıç kayıtları `identity-startup.jsonl`
dosyasına eklenir; dosya 256 KiB'ye ulaştığında sonraki kayıttan önce
`identity-startup.previous.jsonl` adına döndürülür. Kimlik günlüğü istek URL'si,
header, body, token veya ortam değişkeni dökümü içermez.

## İmza ve dosya özeti

Uygulama kimliği ve UUID ürün eşleştirmesi içindir; yayıncı sertifikası veya
kurumsal erişim onayı yerine geçmez. SHA-256 incelenen dosyayı tanımlar;
paketleme veya imzalama dosyayı değiştirdiğinde özet de değişir.

- **macOS:** Rapor `codesign` doğrulamasını, Identifier, varsa Team ID ve
  yayıncı zincirini gösterir. Derleme varsayılanı ad-hoc imzadır;
  `VALIDEX_CODESIGN_IDENTITY` farklı bir imza kimliği seçebilir.
- **Windows:** Rapor Authenticode sonucunu, varsa yayıncı ve sertifika
  parmak izini gösterir. Paketleyici ayrıca Validex ürün/sürüm metaverisini
  executable'lara yazar. Ham SHA-256, güvenlik aracının PE/Authenticode kuralı
  için hesapladığı özetle aynı olmak zorunda değildir.
- **Linux:** Raporda taşınabilir gömülü imza denetimi uygulanmaz. `.deb`
  paket kaydı ile gerçek dosya yolu ve SHA-256 birlikte incelenebilir.

## Terminalden doğrulama

Go bileşenleri `--identity` ve `--version` seçeneklerini tek başına kabul eder.
Bu komutlar API isteği göndermez. `--identity` çıktısındaki PID, komutu o anda
çalıştıran sürece aittir; açık masaüstünün arka uç PID'si için masaüstü raporunu
kullanın. Go raporu sürüm, yol, SHA-256, PID/PPID ve Go sürümünü içerir.

Kaynak koddan doğrulamak için repository kökünde:

```bash
make build-backend build-cli
./build/bin/validex-backend --identity
./build/bin/validex-cli --identity
```

Windows'ta dosya adlarına `.exe` ekleyin. `.deb` kurulumu için:

```bash
validex_backend='/usr/lib/validex/resources/validex-backend'
readlink -f -- "$validex_backend"
sha256sum -- "$validex_backend"
"$validex_backend" --identity
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' validex
```

İmza kontrolü gerekiyorsa kimlik raporundaki dosya yolunu kullanın:

```bash
# macOS
codesign --display --verbose=4 /Applications/Validex.app
codesign --verify --strict /Applications/Validex.app/Contents/Resources/validex-backend
```

```powershell
# Windows PowerShell; yolu kurulu dosyayla değiştirin.
$ValidexBackend = 'C:\kurulum\Validex\resources\validex-backend.exe'
Get-FileHash -LiteralPath $ValidexBackend -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath $ValidexBackend | Format-List
```

## IT talep metni

```text
Konu: Validex uygulama kaydı / erişim incelemesi
Talep sahibi, ekip ve iş amacı:
Cihaz / işletim sistemi / mimari:
Paket kaynağı ve sürümü:
Uygulama kimliği: com.validex.Validex
Ürün UUID'si: 6a2bf295-cc04-4390-abaf-9ccfcdbc3379
İlgili bileşen, gerçek dosya yolu ve SHA-256:
Olay zamanı / saat dilimi / PID:
İmza sonucu ve varsa yayıncı:
Güvenlik ürünü / olay veya kural kimliği:
Gerekli API hedefleri, protokol ve portlar:
Kullanıcı veya cihaz grubu:
Ekler: Kimlik raporu ve ilgili olay kaydı.
```

IT ekibinin masaüstü, arka uç ve kullanılan CLI dosyalarını aynı Validex ürün
kaydı altında eşleştirmesi için raporu ekleyin. Ayrı kurulan CLI için kendi
`--identity` çıktısını da ekleyin.

Rapor üretimi [Electron kimlik servisi](../cmd/validex/electron/src/security-identity.ts)
ve [Go kimlik paketi](../internal/appidentity/identity.go) içinde uygulanır;
paket üretme komutları [README](../README.md) içinde açıklanır.
