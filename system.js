require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function normalizeMessages(body = {}) {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  if (rawMessages.length > 0) {
    return rawMessages
      .filter((m) => m && typeof m.content === 'string')
      .map((m) => ({
        role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
        content: m.content
      }));
  }

  const text =
    body.message ||
    body.text ||
    body.prompt ||
    body.content ||
    body.input ||
    '';

  return [{ role: 'user', content: String(text || '') }];
}

function buildMessages(body = {}) {
  const messages = normalizeMessages(body);

  const systemPrompt = process.env.LUCY_SYSTEM_PROMPT ||
    'Sen Lucy adında Türkçe konuşan sıcak, hızlı ve doğal bir sohbet asistanısın. Bu backend sıfır tool modundadır. PDF, Excel, ZIP, dosya oluşturma, kaydetme, export, web arama veya harici araç çalıştırma yoktur. Kullanıcı dosya isterse dosya oluşturamadığını kısa ve net söyle; asla dosya linki, LUCYFILEREF, indirme bağlantısı veya sahte çıktı üretme. Normal sohbetlerde doğrudan cevap ver.';

  return [
    { role: 'system', content: systemPrompt },
    ...messages.filter((m) => m.role !== 'system')
  ];
}

async function callDeepSeek(body = {}, stream = false) {
  if (!DEEPSEEK_API_KEY) {
    const err = new Error('DEEPSEEK_API_KEY eksik. Railway Variables içine ekle.');
    err.status = 500;
    throw err;
  }

  const payload = {
    model: body.model || DEEPSEEK_MODEL,
    messages: buildMessages(body),
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 1600,
    stream
  };

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const err = new Error(`DeepSeek API hata: ${response.status} ${errorText}`);
    err.status = response.status;
    throw err;
  }

  return response;
}

async function chatHandler(req, res) {
  try {
    const ds = await callDeepSeek(req.body, false);
    const data = await ds.json();
    const reply = data?.choices?.[0]?.message?.content || '';

    res.json({
      ok: true,
      reply,
      message: reply,
      content: reply,
      text: reply,
      model: data?.model || DEEPSEEK_MODEL,
      usage: data?.usage || null
    });
  } catch (err) {
    console.error('[chat error]', err);
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Chat hatası'
    });
  }
}

async function streamHandler(req, res) {
  try {
    const ds = await callDeepSeek(req.body, true);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of ds.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content || '';
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta, content: delta, text: delta })}\n\n`);
          }
        } catch (_) {
          // Ignore malformed stream chunk
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[stream error]', err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ ok: false, error: err.message || 'Stream hatası' });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Stream hatası' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'Lucy Backend', mode: 'ZERO_DS_ONLY', tools: false });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, mode: 'ZERO_DS_ONLY', model: DEEPSEEK_MODEL });
});

app.post('/api/chat', chatHandler);
app.post('/chat', chatHandler);
app.post('/api/message', chatHandler);
app.post('/message', chatHandler);

app.post('/api/chat-stream', streamHandler);
app.post('/chat-stream', streamHandler);
app.post('/api/stream', streamHandler);
app.post('/stream', streamHandler);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Endpoint yok. Bu backend sadece DS sohbet modunda çalışır.',
    mode: 'ZERO_DS_ONLY'
  });
});

app.listen(PORT, () => {
  console.log(`Lucy ZERO DS-ONLY backend running on port ${PORT}`);
});
