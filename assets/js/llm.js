// Sağlayıcıdan bağımsız LLM istemcisi.
//
// Bu site build adımı olmayan saf tarayıcı JS'i olduğu için resmî SDK'lar yerine
// doğrudan HTTP (fetch) kullanılır. Her sağlayıcı için istek/yanıt biçimi aşağıdaki
// adaptörlerde toplanmıştır; üst katman tek bir arayüz görür.
//
// Model kimlikleri zamanla değişebildiği için ayarlarda model adı elle
// düzenlenebilir ve "Bağlantıyı test et" düğmesi vardır.

import { getLlmConfig, getProvider } from "./llmSettings.js";

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

/** JSON.parse dener; dizi ya da bilinen bir sarmalayıcı anahtar döndürür. */
function tryParseArray(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value;
    for (const key of ["suggestions", "items", "oneriler", "öneriler", "results", "data"]) {
      if (Array.isArray(value?.[key])) return value[key];
    }
  } catch {
    /* çağıran sıradaki adayı dener */
  }
  return null;
}

/** ```json ... ``` bloğu varsa içeriğini alır (metnin herhangi bir yerinde olabilir). */
function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

/**
 * Metindeki dengeli [ ... ] bloklarını bulur.
 * Dize içindeki köşeli parantezleri ve kaçış karakterlerini dikkate alır; böylece
 * "why" metninde geçen bir parantez ayrıştırmayı bozmaz.
 */
function findBalancedArrays(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Yanıt token sınırında kesildiyse dizi kapanmamış olur.
 * Bu durumda tamamlanmış { ... } nesnelerini toplayıp kısmi sonuç kurtarırız.
 */
function salvageObjects(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;

  const objects = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        try {
          objects.push(JSON.parse(text.slice(objectStart, i + 1)));
        } catch {
          /* bozuk nesneyi atla */
        }
        objectStart = -1;
      }
    }
  }
  return objects.length > 0 ? objects : null;
}

/**
 * Modelin döndürdüğü metinden öneri dizisini çıkarır.
 * Modeller sık sık kod çiti, giriş cümlesi ekler ya da yanıtı yarıda keser;
 * hepsine karşı sırayla tolerans gösterilir.
 */
function parseJsonArray(text, { truncated = false } = {}) {
  const unfenced = stripCodeFence(text);

  // 1) Doğrudan ayrıştır
  const direct = tryParseArray(unfenced);
  if (direct) return direct;

  // 2) Metin içindeki dengeli dizileri dene (en uzundan başlayarak)
  const candidates = [...findBalancedArrays(unfenced), ...findBalancedArrays(text)]
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const parsed = tryParseArray(candidate);
    if (parsed) return parsed;
  }

  // 3) Kesilmiş yanıt: tamamlanmış nesneleri kurtar
  const salvaged = salvageObjects(unfenced) ?? salvageObjects(text);
  if (salvaged) return salvaged;

  // 4) Teşhis edilebilir bir hata ver
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
  if (truncated) {
    throw new Error(
      "Modelin yanıtı token sınırında kesilmiş. Ayarlar'dan öneri sayısını azaltmayı dene. " +
        `Yanıtın başı: “${preview}”`
    );
  }
  throw new Error(`Modelin yanıtı JSON olarak okunamadı. Yanıtın başı: “${preview}”`);
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

/** Bölüme göre modelden ne tür öneri istendiğini belirtir. */
const FOCUS_INSTRUCTIONS = {
  video: 'Yalnızca video/içerik önerisi ver; "kind" alanı hep "video" olsun.',
  show: 'Yalnızca dizi ve film öner; "kind" alanı "dizi" veya "film" olsun. ' +
    '"query" alanı yapımın adıyla birlikte YouTube\'da aratılacak metin olsun ' +
    '(örn. "Bizimkiler dizisi bölüm").',
  any: "Video önerileriyle dizi/film önerilerini karıştır.",
};

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
  const focus = FOCUS_INSTRUCTIONS[options.focus] ?? FOCUS_INSTRUCTIONS.any;

  const userPrompt = [
    `Kullanıcı hakkında bildiklerim:`,
    profileText || "(Henüz belirgin bir profil yok — genel, yumuşak başlangıç önerileri ver.)",
    "",
    focus,
    "",
    avoid.length > 0
      ? `Şunları ÖNERME (zaten gördü veya izledi): ${avoid.slice(0, 40).join(", ")}`
      : "",
    "",
    `Tam olarak ${count} öneri üret. Yalnızca JSON dizisi döndür.`,
  ]
    .filter(Boolean)
    .join("\n");

  // Bazı modellerde düşünme adımı açıktır ve bu bütçeden yer kapar; bol pay bırakıyoruz.
  const { text, truncated } = await callProvider(config, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 8000,
    timeoutMs: GENERATE_TIMEOUT_MS,
  });

  return parseJsonArray(text, { truncated })
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
