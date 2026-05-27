// Legacy entry point guard.
// Asıl LUCY backend uygulaması system.js içindedir.
// Deploy yanlışlıkla `node server.js` çalıştırsa bile toolOrchestrator devre dışı kalmasın.
console.warn("[LUCY] server.js legacy wrapper: system.js başlatılıyor...");
require("./system.js");
