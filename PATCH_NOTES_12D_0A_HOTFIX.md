# LUCY PATCH 12D-0A — Generic AI Planner Hotfix

## Değişenler

- Chart isteklerinde planner null/eksik plan döndürürse backend artık patlamaz.
- `Cannot read properties of null (reading 'data')` regresyonu için chart fallback güçlendirildi.
- `Ocak 12000, Şubat 18000...` gibi direkt etiket+sayı verileri generic inline parser ile yakalanır.
- Yeni kullanıcı verisi eski context'ten önce gelir; eski Kalem/Defter/Silgi verisine düşme azaltıldı.
- AI planner eksik tool planlarsa deterministic implicit planner devreye girer.
- Tek tool çalışırken hata olursa bütün chat endpoint 500'e düşmez; temiz tool hata cevabı döner.

## SRC

- SRC değişmedi.
