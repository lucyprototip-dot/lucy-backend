# LUCY Backend PATCH-12C — Export + Context + PDF Media Fix

## Amaç
12B testlerinde görülen context/export kalite hatalarını düzeltir.

## Düzeltmeler

- Web modu açıkken `txt/pdf/zip/excel` gibi gerçek tool komutlarında live-web cevap motoru bypass edilir; deterministic tool engine çalışır.
- Web açıkken ham `tool_call` JSON kullanıcıya gösterilmez.
- `https://... oku, özetle, bunu txt yap` zincirinde `webFetch -> document` doğru bağlanır.
- WebFetch sonucu aynı turda üretilen document/PDF içeriğine aktarılır.
- `son oluşturduğun dosyayı zip yap` web açık/kapalı fark etmeksizin son dosya context'ini kullanır.
- Model zincirde ZIP'i atladığında, kullanıcı açıkça istemişse implicit tool planner ZIP'i geri ekler.
- `excel + pdf + zip` zincirinde ZIP'in atlanması azaltıldı.
- DOCX oluştururken `Bu şiiri yaz: ... Sonra bunu word yap` kalıbında prompt değil gerçek içerik alınır.
- Mermaid edge label parser güçlendirildi: `A -->|Etiket| B{Karar}` satırlarında B düğümü kaybolmaz.
- Mermaid -> PDF export'ta kırpılmış/eksik düğüm sorunu azaltıldı.
- PDF HTML render tarafına emoji fallback tokenları eklendi; emoji boş kutu gibi görünmesin diye yaygın emoji sembolleri görünür badge'e çevrilir.
- PDF chart/mermaid/table widget render akışı korunur.

## Dokunulan dosyalar

- routes/chatRoutes.js
- core/toolOrchestrator.js
- core/render/pdfRenderEngine.js

## Test önerileri

1. `https://example.com sayfasını oku, başlığını çıkar, kısa özet yap ve bunu txt dosyası yap`
2. `Son oluşturduğun dosyayı zip yap`
3. `Ürün, adet, fiyat tablosu yap: Kalem 10 25, Defter 5 80, Silgi 20 10. Toplam tutarı hesapla, hem excel hem pdf yap, sonra ikisini zip hazırla`
4. `Bu şiiri yaz: Aşkın gölgesinde yanan bir geceyim. Her nefeste adını saklarım. Sonra bunu word dosyası yap`
5. `Az önceki şiiri pdf yap`
6. `Az önceki akış şemasını pdf yap`
