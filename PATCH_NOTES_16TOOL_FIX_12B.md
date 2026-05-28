# LUCY Backend Fix 12B — Semantic Context + Chart Follow-up Polish

## Amaç
- `bunu pdf yap` komutunda yanlışlıkla son textStats/tool tablosunu değil, kullanıcının kastettiği son gerçek metni/şiiri/yanıtı PDF yapmak.
- `renkli pasta yap`, `farklı renklerde yap`, `çizgi grafik yap` gibi doğal follow-up komutları son chart context'ine bağlamak.
- Tool sonucu/status metinlerinin aktif içerik belleğini ezmesini engellemek.

## Değişenler
- Tool-generated assistant metinleri aktif içerik olarak kaydedilmez.
- TextStats tabloları, indirme/status satırları ve raw mermaid kodları semantic source'u ezmez.
- Transform komutlarında typed source priority eklendi:
  - `son tabloyu pdf yap` -> lastTable
  - `grafiği renklendir` -> lastChart
  - `diyagramı pdf yap` -> lastMermaid
  - `bunu pdf yap` -> son gerçek assistant/user content
- Chart type artık follow-up'ta gereksiz yere `bar` default'a düşmez; açıkça istenirse değişir.
- `punu/bumu/bnu` gibi küçük typo normalizasyonu eklendi.

## Test beklenenleri
- Şiir yazdır -> `bunu pdf yap` => PDF şiiri içermeli, textStats tablosunu değil.
- Pasta grafik -> `renkli pasta yap` => aynı veriyle renkli pasta kalmalı.
- Pasta grafik -> `çizgi grafik yap` => aynı veriyle çizgi grafik olmalı.
- TextStats sonrası başka metin yazdır -> `bunu pdf yap` => yeni metin PDF olmalı.
