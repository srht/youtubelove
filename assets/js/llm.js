// Sağlayıcıdan bağımsız LLM istemcisi.
//
// Bu site build adımı olmayan saf tarayıcı JS'i olduğu için resmî SDK'lar yerine
// doğrudan HTTP (fetch) kullanılır. Her sağlayıcı için istek/yanıt biçimi aşağıdaki
// adaptörlerde toplanmıştır; üst katman tek bir arayüz görür.
//
// Model kimlikleri zamanla değişebildiği için ayarlarda model adı elle
// düzenlenebilir ve "Bağlantıyı test et" düğmesi vardır.

import { getLlmConfig, getProvider } from "./llmSettings.js";

const TIMEOUT_MS = 30_000;

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
  },
};

/** Ham HTTP çağrısı; zaman aşımı ve okunabilir hata mesajı ile. */
async function callProvider(config, payload) {
  const adapter = ADAPTERS[config.provider];
  if (!adapter) throw new Error(`Bilinmeyen sağlayıcı: ${config.provider}`);

  const { url, headers, body } = adapter.buildRequest(config, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
      throw new Error("İstek zaman aşımına uğradı (30 sn).");
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
  if (!text) throw new Error("Sağlayıcı boş yanıt döndürdü.");
  return text;
}

/** Ayarların çalışıp çalışmadığını doğrulayan küçük bir istek. */
export async function testConnection(config = getLlmConfig()) {
  const text = await callProvider(config, {
    system: "Sadece istenen kelimeyi yaz, başka hiçbir şey ekleme.",
    user: 'Yalnızca şu kelimeyi yaz: TAMAM',
    maxTokens: 16,
  });
  return text.trim().slice(0, 40);
}

/**
 * Modelin döndürdüğü metinden JSON dizisini çıkarır.
 * Modeller sık sık ```json çitleri veya açıklama cümlesi ekler; bunları toleranslı ayıklarız.
 */
function parseJsonArray(text) {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const candidates = [cleaned];
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.suggestions)) return parsed.suggestions;
    } catch {
      /* sıradaki adayı dene */
    }
  }
  throw new Error("Modelin yanıtı beklenen JSON biçiminde değil.");
}

const SYSTEM_PROMPT = `Sen "YouTubeLove" adlı bir siteye öneri üreten yardımcısın.
Sitenin amacı: kullanıcıyı YouTube'un sonsuz akışından çıkarıp, kendini iyi hissettiren
ve kişisel gelişimini destekleyen içeriklere yönlendirmek. Kullanıcı Türk ve arayüz Türkçe.

Sana kullanıcının geçmiş seçimlerinden çıkarılmış bir zevk profili verilecek.
Buna göre YouTube'da aratılacak öneriler üret.

Kurallar:
- Yanıtın SADECE geçerli bir JSON dizisi olsun. Açıklama, selamlama, markdown çiti ekleme.
- Her öge şu alanlara sahip olsun:
  {"title": "kısa başlık", "query": "youtube arama metni", "why": "neden bu kişiye uygun (tek cümle)", "kind": "video" | "dizi" | "film"}
- "query" gerçekten YouTube'da aratıldığında sonuç verecek, doğal bir arama metni olsun.
- Türkçe içerik ağırlıklı olsun; uygun düştüğünde yabancı yapımlar da olabilir.
- Çeşitlilik olsun: hepsi aynı konuda olmasın.
- Tıbbi tavsiye verme, tanı koyma. Sansasyonel veya kaygı artırıcı içerik önerme.
- "why" alanı kullanıcıya "sen" diye hitap etsin ve kısa olsun.`;

/**
 * Zevk profiline göre LLM'den öneri ister.
 * @param {string} profileText - insan tarafından okunabilir profil özeti
 * @param {{ count?: number, avoid?: string[] }} [options]
 * @returns {Promise<Array<{title:string, query:string, why:string, kind:string}>>}
 */
export async function generateLlmSuggestions(profileText, options = {}) {
  const config = getLlmConfig();
  const count = options.count ?? config.count ?? 6;
  const avoid = options.avoid ?? [];

  const userPrompt = [
    `Kullanıcının zevk profili:`,
    profileText || "(Henüz belirgin bir profil yok — genel, yumuşak başlangıç önerileri ver.)",
    "",
    avoid.length > 0
      ? `Şunları ÖNERME (zaten gördü veya izledi): ${avoid.slice(0, 40).join(", ")}`
      : "",
    "",
    `Tam olarak ${count} öneri üret. Yalnızca JSON dizisi döndür.`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callProvider(config, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 2000,
  });

  return parseJsonArray(text)
    .filter((item) => item && typeof item.title === "string" && typeof item.query === "string")
    .map((item) => ({
      title: String(item.title).slice(0, 120),
      query: String(item.query).slice(0, 200),
      why: typeof item.why === "string" ? item.why.slice(0, 300) : "",
      kind: ["video", "dizi", "film"].includes(item.kind) ? item.kind : "video",
    }))
    .slice(0, count);
}

export { getProvider };
