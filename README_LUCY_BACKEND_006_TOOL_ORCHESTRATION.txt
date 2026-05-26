LUCY BACKEND 006 - TOOL ORCHESTRATION PATCH

Amaç:
- DeepSeek cevabındaki tool_call JSON'u algılar.
- tools/toolRegistry üzerinden ilgili tool'u bulur.
- tool.execute(input) çalıştırır.
- PDF / Excel / QR gibi base64 dosya sonuçlarını backend/generated içine yazar.
- Frontend'e downloadUrl / url olarak gerçek dosya bağlantısı döndürür.

Değişen ana dosya:
- system.js

ZIP içinde ayrıca mevcut tools klasörü de var:
- tools/toolRegistry.js
- tools/pdf.js
- tools/excel.js
- tools/qr.js
- tools/calculator.js
- tools/mermaid.js
- tools/chartData.js
- tools/ocr.js
- tools/textStats.js
- tools/time.js
- tools/webFetch.js

Kurulum:
1) ZIP içeriğini backend kök klasörüne çıkar.
2) Var olan system.js ve tools klasörünün üzerine yaz.
3) Railway start command aynı kalacak:
   node system.js

Test:
- GET /api/tools
- POST /api/tools/execute
  Body örnek:
  {
    "tool":"pdf",
    "input":{
      "title":"Test PDF",
      "text":"Lucy gerçek PDF üretiyor.",
      "filename":"lucy-test.pdf"
    }
  }

Beklenen sonuç:
- success true
- downloadUrl veya url gelir
- /generated/... üzerinden dosya açılır

Chat test:
Kullanıcı LUCY'ye PDF/Excel/QR istediğinde DeepSeek şu formatta JSON üretmeli:
```json
{"tool_call":{"tool":"pdf","input":{"title":"Başlık","text":"İçerik","filename":"lucy.pdf"}}}
```
Backend bu JSON'u yakalayıp gerçek tool'u çalıştırır.

Not:
- Büyük refactor yapılmadı.
- Mevcut /api/tools/execute korundu.
- /api/chat ve /api/chat-stream cevaplarına toolCalls ve toolResults eklendi.
- Base64 frontend'e şişmesin diye dosyaya çevrilir ve base64 response'tan çıkarılır.
