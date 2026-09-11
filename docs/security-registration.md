# Validex için kurumsal uygulama kaydı

Bu belge, Validex'in kurumsal uç nokta ve ağ güvenliği ekiplerine kaydedilmesi için kimlik bilgilerini ve doldurulabilir talep metnini içerir. Uygulama kimliği raporu ile engelleme olayını aynı cihaz, çalıştırılabilir dosya ve zaman üzerinden eşleştirin.

`Validex`, uygulama kimliği ve ürün UUID'si sürümler arasında envanter eşleştirmesini sağlar. Bunlar yayıncı sertifikası değildir. `Publisher: N/A` görülmesi tek başına engellemenin nedenini kanıtlamaz; güvenlik ekibi olay kaydındaki süreç, imza ve politika sonucunu incelemelidir. macOS'ta ad-hoc imza bir yayıncı kimliği içermez. [Apple: ad-hoc imza](https://developer.apple.com/documentation/security/seccodesignatureflags/adhoc?changes=_8).

## Tek uygulama kimliği

| Alan | Değer / kaynak |
| --- | --- |
| Ürün adı | `Validex` |
| Masaüstü, Go arka ucu ve CLI uygulama kimliği | `com.validex.Validex` |
| Ana çalıştırılabilir dosyaların bileşen/imzalama tanımlayıcısı | `com.validex.Validex` |
| Bileşen rolleri | `desktop`, `backend`, `cli` |
| Ürün UUID'si | `6a2bf295-cc04-4390-abaf-9ccfcdbc3379` |
| Sürüm, platform, mimari | İncelenen çalıştırmanın kimlik raporu |
| Dosya SHA-256 | İmzalama ve paketleme tamamlandıktan sonraki gerçek dosya özeti |

Ürün UUID'si kurulum veya kullanıcı kimliği değildir. Dosyanın içeriği değiştiğinde SHA-256 da değişir; yeni sürüm için rapor yeniden alınır. Geliştirme çalıştırmasının geçici yolları veya imzaları üretim paketiyle aynı kabul edilmez.

Masaüstü kabuğu, Go arka ucu ve CLI aynı uygulama kimliğini ve ürün UUID'sini kullanır. Bileşenler rol ve gerçek dosya adı/yoluyla ayırt edilir; arka uç veya CLI için ayrı ürün kaydı açılmaz. Electron yardımcı süreçlerinin ve geliştirme paketinin platforma özgü çalışma zamanı tanımlayıcıları raporda ayrıca görülebilir; bunlar Validex'in ortak ürün kimliğini değiştirmez.

Sabit kimliklerin kaynağı [ürün bildirimi](../internal/appidentity/manifest.json) dosyasıdır; pakette `resources/application-identity.json` altında bulunur. macOS paketinde kaynak dizini `Contents/Resources`'tır.

## Güvenlik ekibinin eşleştirebileceği alanlar

| Platform | Politika incelemesi için kanıt | Sınır |
| --- | --- | --- |
| macOS | Doğrulanan imza zinciri, Team ID, imzadaki `Identifier` ve designated requirement; gerektiğinde ürünün istediği dosya özeti | Bundle ID tek başına yayıncıyı doğrulamaz. Kabuğun ve arka ucun imzaları ayrı incelenir. [Apple: kod imzası gereksinimleri](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements). |
| Windows | Authenticode imza durumu, sertifika yayıncısı; ürün destekliyorsa yayıncı + dosya adı + sürüm kapsamı veya dosya özeti | `CompanyName`, `ProductName` ve dosya adı dosya metaverisidir. AppUserModelID pencere/süreç gruplamasında kullanılır; yayıncı sertifikası yerine geçmez. [Microsoft: kural türleri](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/select-types-of-rules-to-create), [AppUserModelID](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-id). |
| Linux | Gerçek çalıştırılabilir dosya yolu, SHA-256, kurulum sahibi/izinleri ve varsa dağıtım paketinin kaydı | Tüm Linux güvenlik ürünleri için ortak bir yayıncı kimliği yoktur. Örneğin RHEL `fapolicyd`, RPM veritabanı ve ayrıca tanımlanan dosya güven kayıtlarını kullanır. Dosya değişiklikleri güven kaydının güncellenmesini gerektirebilir. [Red Hat: fapolicyd](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/security_hardening/blocking-and-allowing-applications-by-using-fapolicyd). |

Windows App Control, hash kurallarında çoğunlukla Authenticode/PE image hash kullanır. Bu değer, kimlik raporundaki ham dosya SHA-256'sından farklı olabilir. Ham SHA-256'yı kanıt olarak iletin; politika için gereken özeti güvenlik ekibi kendi aracında aynı dosyadan üretsin. [Microsoft: hash davranışı](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/select-types-of-rules-to-create#more-information-about-hashes).

macOS dağıtımında Developer ID imzası ve notarization ayrı işlemlerdir. Bunların tamamlanmış olması kurumsal intranet erişimi izni vermez; kurumun ilgili güvenlik politikası ayrıca değerlendirilir. Yayın imzalama süreci uygulamadaki arka uç ve yardımcı çalıştırılabilir dosyaları da kapsamalıdır. [Apple: imza ve notarization](https://support.apple.com/guide/security/app-code-signing-process-sec3ad8e6e53/web), [dağıtım imzalama sırası](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac?changes=_1).

## İncelenecek dosyalar ve günlükler

Kimlik raporundaki gerçek yolları esas alın. Standart paket yerleşimleri şöyledir; kurulum kökü cihaza göre değişir:

| Platform | Masaüstü süreci | Ağ isteklerini yapan Go arka ucu |
| --- | --- | --- |
| macOS | `Validex.app/Contents/MacOS/Validex` | `Validex.app/Contents/Resources/validex-backend` |
| Windows | `Validex\validex.exe` | `Validex\resources\validex-backend.exe` |
| Linux | `Validex/validex` | `Validex/resources/validex-backend` |

CLI ayrıca kullanılıyorsa `validex-cli` / `validex-cli.exe` aynı ürün kaydının dosya listesine eklenir. Engelleme olayındaki süreç adı, bu listedeki rol ve gerçek dosya yoluyla eşleştirilir.

Uygulamada **Yardım → Uygulama kimliği** / **Help → Application identity** menüsünü veya **⌘/Ctrl+Shift+F12** kısayolunu açın. **Raporu kopyala / Copy report** ile raporu alın; **Günlükleri aç / Open logs** ile kayıt klasörünü görüntüleyin. Windows/Linux'ta menü çubuğu gizliyse `Alt` ile açılır.

| Platform | Kimlik günlüğü klasörü |
| --- | --- |
| macOS | `~/Library/Application Support/Validex/logs/` |
| Windows | `%APPDATA%\Validex\logs\` |
| Linux | `$XDG_CONFIG_HOME/Validex/logs/`; değişken tanımlı değilse `~/.config/Validex/logs/` |

`application-identity.json` güncel ayrıntılı rapordur; `application-identity.txt` talebe eklenebilecek metindir. `identity-startup.jsonl`, başlangıç kayıtlarını tutar; döndürülen önceki dosya `identity-startup.previous.jsonl` adını taşır. Rapor, masaüstü/arka uç/varsa CLI'nin gerçek yollarını ve SHA-256 değerlerini içerir. Paketteki sabit bildirim ile kullanıcı klasöründeki çalışma raporu farklı dosyalardır.

Go arka ucu ve CLI, `--identity` ile kimlik raporunu, `--version` ile sürümü yazdırır. Bu bilgi komutları API isteği göndermez. Başlangıç günlüğü trafik günlüğü değildir; engelleme zamanını kurumsal güvenlik ürünü kaydıyla eşleştirin.

## Doldurulabilir IT talebi

```text
Konu: Validex — belirtilen API hedefleri için uygulama/ağ erişimi incelemesi

Talep sahibi / ekip:
İş amacı:
Cihaz adı / işletim sistemi / mimari:
Uygulama sürümü ve dağıtım kaynağı:
Uygulama kimliği: com.validex.Validex
Ürün UUID'si: [kimlik raporundan]
Kayıt kapsamı: Tek Validex ürünü; masaüstü, arka uç ve kullanılan CLI
Engellenen bileşenin rolü: [desktop / backend / cli]
Gerçek dosya adı: [Validex / validex-backend / validex-cli; platform ekiyle]
Gerçek dosya yolu:
Ham dosya SHA-256:
İmza durumu / yayıncı / Team ID veya sertifika bilgisi:
Olay tarihi, saati ve saat dilimi:
Güvenlik ürünü, olay/kural kimliği ve görünen mesaj:

Gerekli hedefler: [FQDN/IP], [TCP portu], [protokol]
Gerekli erişim yönü: [örn. arka uçtan belirtilen API'ye giden HTTPS]
Kullanıcı/cihaz grubu:
Süre ve tekrar inceleme tarihi:
Teknik sorumlu / hizmet sahibi:

Talep: com.validex.Validex kimliğiyle tek ürün kaydı oluşturulması;
ekli masaüstü, arka uç ve CLI dosyalarının bu kayıt altında incelenmesi;
uygun bulunursa belirtilen kullanıcı/cihaz grubu ve hedefler için
kurumsal politikanın tanımlanması.

Ekler: Uygulama kimliği raporu, ilgili başlangıç kaydı, engelleme ekranı,
imza doğrulama çıktısı ve onaylanacak dağıtımın dosya bilgileri.
```

Kimlik raporunda bulunan yerel kullanıcı adı ve dosya yollarını paylaşmadan önce kontrol edin. İstek gövdeleri, `Authorization`, çerezler ve erişim anahtarları bu kayıt için gerekli değildir.

Güvenlik ekibi önce engeli üreten katmanı belirler: uygulama çalıştırma politikası, uç nokta ağ denetimi, proxy veya hedef servis yetkilendirmesi. İzin kapsamını uygulamanın gerçek bileşenleri ve iş için gerekli hedeflerle sınırlar; onaylanan paketi küçük bir cihaz grubunda doğrular. Sürüm veya imza değiştiğinde aynı kayıt üzerinden güncelleme yapılır. Genel Electron/Go izni veya güvenlik denetimini kapatma bu talebin kapsamına girmez.

## Salt okunur doğrulama komutları

Aşağıdaki yolları kimlik raporundaki gerçek yollarla değiştirin. Komutlar dosya veya güvenlik politikası değiştirmez.

macOS — uygulama paketini ve arka ucu ayrı inceleyin:

```bash
validex_app='/Applications/Validex.app'
validex_backend="$validex_app/Contents/Resources/validex-backend"
codesign --display --verbose=4 "$validex_app"
codesign --display --verbose=4 "$validex_backend"
codesign --display -r- "$validex_backend"
codesign --verify --strict --verbose=2 "$validex_backend"
shasum -a 256 "$validex_app/Contents/MacOS/Validex" "$validex_backend"
"$validex_backend" --identity
```

`Identifier`, `TeamIdentifier`, `Authority` ve doğrulama sonucunu birlikte iletin. `Signature=adhoc`, `TeamIdentifier=not set` veya imzasızlık çıktısını olduğu gibi kaydedin. `codesign` imza incelemesi, kurumsal erişim onayı değildir. [Apple: imza inceleme](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).

Windows — PowerShell:

```powershell
$ValidexExecutable = 'C:\kurulum\Validex\resources\validex-backend.exe'
Get-FileHash -LiteralPath $ValidexExecutable -Algorithm SHA256
$ValidexSignature = Get-AuthenticodeSignature -LiteralPath $ValidexExecutable
$ValidexSignature | Format-List Path, Status, StatusMessage, SignatureType
$ValidexSignature.SignerCertificate | Format-List Subject, Issuer, Thumbprint, NotAfter
(Get-Item -LiteralPath $ValidexExecutable).VersionInfo |
  Format-List CompanyName, ProductName, FileVersion, OriginalFilename
& $ValidexExecutable --identity
```

`validex.exe` için de aynı incelemeyi yapın. İmza alanlarının boş olması halinde bir yayıncı adı varsaymayın. [Microsoft: Authenticode incelemesi](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-7.5), [SHA-256 hesaplama](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash?view=powershell-7.5).

Linux:

```bash
validex_backend='/kurulum/Validex/resources/validex-backend'
readlink -f -- "$validex_backend"
stat -- "$validex_backend"
sha256sum -- "$validex_backend"
"$validex_backend" --identity
```

Dağıtımın paket yöneticisiyle kurulduysa paket adı/sürümünü de ekleyin. Bu depodaki klasör tabanlı paket veya `make install-linux` kurulumu için otomatik bir RPM/DEB yayıncı kaydı varsaymayın.
