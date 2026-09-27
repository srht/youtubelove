// Sağlayıcıdan bağımsız LLM istemcisi.
//
// Bu site build adımı olmayan saf tarayıcı JS'i olduğu için resmî SDK'lar yerine
// doğrudan HTTP (fetch) kullanılır. Her sağlayıcı için istek/yanıt biçimi aşağıdaki
// adaptörlerde toplanmıştır; üst katman tek bir arayüz görür.
//
// Model kimlikleri zamanla değişebildiği için ayarlarda model adı elle
// düzenlenebilir ve "Bağlantıyı test et" düğmesi vardır.

import { getLlmConfig, getProvider } from "./llmSettings.js";
import { SYSTEM_PROMPT, buildUserPrompt, normalizeSuggestions, parseJsonArray } from "./aiPrompt.js";

const TEST_TIMEOUT_MS = 30_000;
// Öneri üretimi daha uzun sürebilir (bazı modellerde düşünme adımı açıktır).
const GENERATE_TIMEOUT_MS = 60_000;

const ADAPTERS = {
  anthropic: {
    buildRequest({ apiKey, model }, { system, user, maxTokens }) {
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          // Tarayıcıdan doğrudan çağrı için gerekli (CORS).
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        },
      };
    },
    extractText(data) {
      return (data?.content ?? [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n");
    },
    extractError(data) {
      return data?.error?.message ?? null;
    },
    // Yanıt token sınırına takıldıysa JSON yarıda kesilmiş olur.
    isTruncated(data) {
      return data?.stop_reason === "max_tokens";
    },
  },

  openai: {
    buildRequest({ apiKey, model }, { system, user, maxTokens }) {
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: {
          model,
          max_completion_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? "";
    },
    extractError(data) {
      return data?.error?.message ?? null;
    },
    isTruncated(data) {
      return data?.choices?.[0]?.finish_reason === "length";
    },
  },

  gemini: {
    buildRequest({ apiKey, model }, { system, user, maxTokens }) {
      return {
        url:
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
          `:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        },
      };
    },
    extractText(data) {
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p?.text ?? "").join("");
    },
    extractError(data) {
      return data?.error?.message ?? null;
    },
    isTruncated(data) {
      return data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
    },
  },
};

/** Ham HTTP çağrısı; zaman aşımı ve okunabilir hata mesajı ile. */
async function callProvider(config, payload) {
  const adapter = ADAPTERS[config.provider];
  if (!adapter) throw new Error(`Bilinmeyen sağlayıcı: ${config.provider}`);

  const timeoutMs = payload.timeoutMs ?? TEST_TIMEOUT_MS;
  const { url, headers, body } = adapter.buildRequest(config, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      throw new Error(`İstek zaman aşımına uğradı (${Math.round(timeoutMs / 1000)} sn).`);
    }
    // Tarayıcı CORS hatalarını da buraya düşürür; ayrımı kullanıcıya açıklayalım.
    throw new Error(
      "Sağlayıcıya ulaşılamadı. İnternet bağlantını, anahtarını ve sağlayıcının " +
        "tarayıcıdan doğrudan çağrıya izin verip vermediğini kontrol et."
    );
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* gövde JSON değilse aşağıda durum koduna göre hata veririz */
  }

  if (!response.ok) {
    const detail = adapter.extractError(data);
    const hint =
      response.status === 401 || response.status === 403
        ? " API anahtarını kontrol et."
        : response.status === 404
          ? " Model adını kontrol et."
          : response.status === 429
            ? " Kota veya hız sınırına takıldın."
            : "";
    throw new Error(`Sağlayıcı ${response.status} döndü.${hint}${detail ? ` (${detail})` : ""}`);
  }

  const text = adapter.extractText(data);
  if (!text) {
    if (adapter.isTruncated?.(data)) {
      throw new Error(
        "Model, metin üretmeden token sınırına takıldı. Ayarlar'dan öneri sayısını " +
          "azaltmayı ya da daha küçük/hızlı bir model denemeyi düşünebilirsin."
      );
    }
    throw new Error("Sağlayıcı boş yanıt döndürdü.");
  }
  return { text, truncated: Boolean(adapter.isTruncated?.(data)) };
}

/** Ayarların çalışıp çalışmadığını doğrulayan küçük bir istek. */
export async function testConnection(config = getLlmConfig()) {
  // Düşünme adımı açık olan modellerde 16 token'lık bütçe metin bırakmayabilir.
  const { text } = await callProvider(config, {
    system: "Sadece istenen kelimeyi yaz, başka hiçbir şey ekleme.",
    user: "Yalnızca şu kelimeyi yaz: TAMAM",
    maxTokens: 2000,
    timeoutMs: TEST_TIMEOUT_MS,
  });
  return text.trim().slice(0, 40);
}

/**
 * Kullanıcının kendi anahtarıyla, tarayıcıdan doğrudan öneri ister.
 * (Varsayılan yol sitenin kendi sunucu fonksiyonudur; bkz. aiClient.js.)
 */
export async function generateLlmSuggestions(context, options = {}) {
  const config = getLlmConfig();
  const count = options.count ?? 6;
  const { text, truncated } = await callProvider(config, {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({ ...options, context, count }),
    maxTokens: 8000,
    timeoutMs: GENERATE_TIMEOUT_MS,
  });
  return normalizeSuggestions(parseJsonArray(text, { truncated }), count);
}

export { getProvider };
