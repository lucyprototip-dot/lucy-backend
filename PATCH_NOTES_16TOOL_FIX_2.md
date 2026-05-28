# LUCY Backend — 16 Tool Fix 2

Bu patch, 16 tool test turundan sonra kalan iki kritik intent hatasına odaklanır.

## Düzeltilenler

### 1. Time false-positive guard

Şu komut artık `time` tool'u tetiklememeli:

- `saat tarzı premium olsun`
- `saat tasarımı güzel olsun`
- `saat ikonu ekle`

`time` sadece gerçek saat/tarih sorularında çalışmalı:

- `saat kaç`
- `bugün tarih ne`
- `şu an saat kaç`

### 2. FileManager > WebFetch önceliği

Şu komutlar artık model yanlışlıkla `webFetch` üretse bile deterministic olarak `fileManager`'a yönlendirilir:

- `son oluşturulan dosyayı oku`
- `son dosyayı oku`
- `oluşturulan dosyaları listele`

Böylece `son oluşturulan dosyayı oku` komutunda `webFetch sonucu.json` gibi yanlış dosya üretilmesi engellenir.

### 3. Explicit tool_call güvenlik filtresi

Model explicit JSON tool_call üretse bile bu çağrı artık son kullanıcı niyetiyle kontrol edilir:

- `time` için `wantsTimeFromText()` şartı
- `webFetch` için `wantsWebFetchFromText()` şartı
- `fileManager` komutlarında sadece `fileManager` kabulü
- `ocr` için explicit OCR/görsel okuma niyeti şartı

### 4. Regex control-character temizliği

`styleMutationText` içindeki gizli control-character sınırları temizlenip normal `\b` regex sınırına çevrildi.

## Dokunulan dosya

- `core/toolOrchestrator.js`

## Test önerisi

Deploy sonrası test:

```txt
saat tarzı premium olsun
```
Beklenen: `time` çalışmamalı.

```txt
son oluşturulan dosyayı oku
```
Beklenen: `fileManager` çalışmalı, `webFetch` çalışmamalı.

```txt
saat kaç
```
Beklenen: `time` çalışmalı.

```txt
https://example.com sayfasını oku
```
Beklenen: `webFetch` çalışmalı.
