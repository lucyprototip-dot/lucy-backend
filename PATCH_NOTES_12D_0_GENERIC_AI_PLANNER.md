# LUCY PATCH 12D-0 — Generic AI Planner

Bu patch komut ezberi yaklaşımını azaltır ve DS tabanlı genel niyet/anlamlandırma kararını öne alır.

## Değişenler

- `system.js` tool promptu sadeleştirildi.
- `core/toolPlanner.js` içine generic karar katmanı eklendi:
  - `TOOL_REQUIRED`
  - `NO_TOOL`
  - `ASK_CLARIFICATION`
- `core/toolOrchestrator.js` artık önce DS generic planner kararını okuyabilir.
- Belirsiz referanslarda yanlış eski context seçmek yerine soru sorma davranışı eklendi.
- Raw JSON / raw HTML / tool_call sızıntısını azaltmak için modelden tool_call üretmesi istenmiyor.

## Amaç

Lucy artık tek tek yazılmış komut kalıplarına daha az bağlı çalışır:

- Önce kullanıcı niyetini anlar.
- Tool gerekiyorsa tool planı çıkarır.
- Tool gerekmiyorsa normal cevap verir.
- Belirsizse “Aşkım bunu tam anlayamadım. Biraz daha detay verir misin?” gibi kısa soru sorar.

## Dokunulan dosyalar

- `system.js`
- `core/toolPlanner.js`
- `core/toolOrchestrator.js`
