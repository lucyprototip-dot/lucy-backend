# LUCY Backend — 16 Tool Fix Patch 1

Bu patch, Railway testlerinde yakalanan ilk kritik backend tool hatalarını küçük ve atomik şekilde düzeltir.

## Düzeltilenler

1. Calculator
- `25 * 12 + 300 hesapla` artık sonuç metniyle döner.
- `5 bölü 2 hesapla` Türkçe matematik ifadesi `5 / 2` olarak normalize edilir.
- `7 artı 8 çarpı 2 hesapla` Türkçe matematik ifadesi `7 + 8 * 2` olarak normalize edilir.
- Calculator UI contract içine gerçek `text` eklendi; kartın boş kalması engellendi.

2. Document
- `txt dosyası yap`, `markdown dosyası yap`, `json dosyası yap` gibi istekler calculator’a düşmesin diye calculator/document ayrımı güçlendirildi.
- Kullanıcı mesajında doğrudan içerik varsa aktif eski calculator/grafik içeriği yerine bu içerik dosyaya yazılır.
- Dosya adı artık yanlış şekilde `calculator-sonucu` baz alınmasın diye inline içerikten üretilir.

3. FileManager
- `oluşturulan dosyaları listele` için direct fileManager path eklendi.
- `son oluşturulan dosyayı oku` gibi okuma niyetleri tool intent olarak tanınır.
- Dosya okuma çıktısında `LUCY_FILE_REF` ve raw tool_call sızıntıları temizlenir.

4. Time false-positive
- `saat tarzı premium olsun` gibi tasarım cümlelerinde time tool tetiklenmemesi korunur.

## Dokunulan dosyalar
- core/intentNormalizer.js
- core/toolIntentDetector.js
- core/toolOrchestrator.js
- core/toolOutputContract.js
- tools/fileManager.js

## Kontrol
- Tüm JS dosyaları `node --check` testinden geçti.
- Lokal smoke testte calculator/document/fileManager ana yolları doğrulandı.
