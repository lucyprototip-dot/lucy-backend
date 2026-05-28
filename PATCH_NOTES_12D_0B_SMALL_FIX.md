# LUCY PATCH 12D-0B — Small Planner/Chart Fix

## Değişenler

- Clarification follow-up hafızası eklendi.
  - “bu grafiği dedim” / “tablo yap dedim” gibi cevaplar önceki soruya bağlanır.
- Net typed reference varsa DS tekrar soru sormaz.
  - “bu grafiği pdf yap” doğrudan grafiği PDF’e yollar.
- Pastel renk intent’i chart style mutation içine alındı.
- Chart style modify chart tipini korur.
  - Pasta grafik pastel yapılınca tabloya düşmemesi hedeflendi.
- PDF tool chart-only input kabul eder.
- PDF render motoru `input.chart` içindeki gerçek chart verisini PDF’e gömme yoluna aldı.

## SRC

- Değişmedi.
