const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, 'gemini-api-key.txt');
const LEGACY_KEY_FILE = path.join(__dirname, 'claude-api-key.txt');
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
].filter(Boolean);

/** Keep only ASCII printable chars so Authorization/query never gets Hangul/BOM junk. */
function sanitizeApiKey(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  // Strip BOM / zero-width / non-ASCII that can leak from editors or copy-paste
  const ascii = trimmed.replace(/[^\x21-\x7E]/g, '');
  return ascii.trim();
}

function readApiKey() {
  if (process.env.GEMINI_API_KEY) {
    const fromEnv = sanitizeApiKey(process.env.GEMINI_API_KEY);
    if (fromEnv) return fromEnv;
  }
  if (process.env.GOOGLE_API_KEY) {
    const fromEnv = sanitizeApiKey(process.env.GOOGLE_API_KEY);
    if (fromEnv) return fromEnv;
  }

  for (const file of [KEY_FILE, LEGACY_KEY_FILE]) {
    if (!fs.existsSync(file)) continue;
    const line = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.includes('REPLACE'));
    const cleaned = sanitizeApiKey(line);
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('대화 메시지가 비어 있습니다.');
  }

  const cleaned = [];
  for (const item of messages) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content || '').trim();
    if (!content) continue;
    if (!cleaned.length && role === 'assistant') continue;
    cleaned.push({ role, content });
  }

  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('마지막 메시지는 사용자 메시지여야 합니다.');
  }

  return cleaned;
}

function toGeminiContents(messages) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n${message.content}`;
      continue;
    }
    contents.push({
      role,
      parts: [{ text: message.content }]
    });
  }
  return contents;
}

async function requestGemini({ apiKey, model, system, messages }) {
  const key = sanitizeApiKey(apiKey);
  if (!key || /[^\x21-\x7E]/.test(key)) {
    throw new Error('Gemini API 키가 ASCII가 아니거나 비어 있습니다.');
  }

  // Google AI Studio standard: pass key as query param — never put user names in Authorization
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(key)}`;
  const payload = {
    systemInstruction: {
      parts: [{ text: String(system || 'You are a helpful assistant.').trim() }]
    },
    contents: toGeminiContents(messages),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (_err) {
    body = null;
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error?.status ||
      `Gemini API 오류 (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.model = model;
    throw error;
  }

  const text = (body?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('\n')
    .trim();

  if (!text) {
    const blockReason = body?.candidates?.[0]?.finishReason || 'UNKNOWN';
    throw new Error(`Gemini가 빈 응답을 반환했습니다. (${blockReason})`);
  }

  return { text, model };
}

async function sendGeminiChat({ messages, system }) {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error(
      'Gemini API 키가 없습니다. dashboard/gemini-api-key.txt 파일에 키를 넣어 주세요.'
    );
  }

  const normalized = normalizeMessages(messages);
  const errors = [];

  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await requestGemini({
        apiKey,
        model,
        system,
        messages: normalized
      });
      return result;
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      console.warn(`[GEMINI][${model}]`, err.message);
    }
  }

  throw new Error(errors.join(' | ') || 'Gemini API 호출에 실패했습니다.');
}

module.exports = {
  sendGeminiChat,
  readApiKey,
  MODEL_CANDIDATES
};
