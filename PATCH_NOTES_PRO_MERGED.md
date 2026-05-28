# LUCY Backend — Professional Merged Patch

Baz: `lucy-backend-fixed.zip` yani Claude fix paketi.

Bu paket Claude'un iyi kısımlarını korur, ancak fazla kısılmış intent tarafını dengeler ve önceki analizde eksik kalan backend guard/registry stabilite katmanlarını ekler.

## Dokunulan dosyalar

- `core/intentNormalizer.js`
- `core/toolIntentDetector.js`
- `core/toolOrchestrator.js`
- `core/toolRenderGuard.js`
- `core/toolExecutor.js`
- `tools/toolRegistry.js`
- `routes/toolRoutes.js`
- `system.js`

## Ana düzeltmeler

### 1. Tool Render Guard gerçek akışa bağlandı

`core/toolRenderGuard.js` artık `core/toolOrchestrator.js` içindeki `buildToolFinalAnswer()` tarafından kullanılır.

Amaç:

- Aynı widget'in aynı cevapta iki kez basılmasını azaltmak.
- Raw `json`, `mermaid`, `lucy-widget` kalıntılarını final summary içinden temizlemek.
- Chart/Mermaid çıktılarında tek temiz özet + tek widget davranışına yaklaşmak.

### 2. Claude'un fazla kısılmış intent kuralları dengelendi

False-positive azaltma mantığı korundu ama şu gerçek kullanıcı komutları tekrar yakalanır hale getirildi:

- `belge yap`
- `word yap`
- `json yap`
- `html yap`
- `şema yap`
- `akış şeması yap`
- `bugün tarih ne`
- `whatsapp mesaj gönder`

Buna karşılık şu tip genel ifadeler tool tetiklemez:

- `web güzel`
- `saat tarzı güzel`
- `word kelimesi geçti` gibi net çıktı fiili olmayan durumlar

### 3. Calculator gizli karakter regex temizliği

Claude fix içindeki backspace/control-character görünümlü regex sınırları temizlendi.

Örnekler:

- `bolu / bölü` → `/`
- `carpi / çarpı / kere / kat` → `*`
- `arti / artı / topla` → `+`
- `eksi / cikar / çıkar` → `-`

### 4. Tool registry izolasyonu eklendi

`tools/toolRegistry.js` artık tek tool yükleme hatasında bütün tool sistemini düşürmez.

- Hatalı tool atlanır.
- Sağlam tool'lar yüklenmeye devam eder.
- `/api/tools` içinde `loadErrors` alanı döner.

### 5. Backend mode alias temizliği

Frontend'den gelebilecek şu mode değerleri eklendi:

- `thinking`
- `pro_thinking`
- `pro-thinking`

Böylece `apiMode` fallback durumlarında yanlışlıkla fast modele düşme riski azaltıldı.

## Kontrol

Tüm `.js` dosyaları için syntax kontrolü yapıldı:

```bash
find . -name '*.js' -print0 | xargs -0 -n1 node --check
```

Ayrıca intent smoke test yapıldı:

- `belge yap` -> document true
- `word yap` -> document true
- `json yap` -> document true
- `şema yap` -> mermaid true
- `akış şeması yap` -> mermaid true
- `bugün tarih ne` -> time true
- `whatsapp mesaj gönder` -> whatsapp true
- `web güzel` -> tool false
- `saat tarzı güzel` -> time false

## Kurulum

Railway backend koduna bu ZIP içeriğini çıkarıp üzerine yaz.

Sonra Railway veya lokal ortamda:

```bash
npm install
npm start
```

Test önerisi:

```bash
GET /api/tools
```

Burada `tools` listesi ve varsa `loadErrors` alanı görülmeli.
