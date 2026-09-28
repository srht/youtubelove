// Dil başına "native" YouTube arama sorguları üretimi (Claude).
// Çeviri değil: o dili konuşan birinin gerçekten yazacağı, o kültürün kendi yapımcılarını,
// türlerini ve deyişlerini bulduran aramalar. Probe toplama scripti ve çok dilli keşif kullanır.

import { askClaude, DEFAULT_CLAUDE_MODEL } from "./claude.js";
import { LANGUAGES } from "./languages.js";

export const NATIVE_QUERY_SYSTEM = `YouTube'da amaçsız kaydırma yerine izlemeye değer içerik bulduran arama sorguları yazıyorsun.
Kurallar:
- Sorguları İSTENEN DİLDE ve o dili ana dili olarak konuşan birinin YouTube arama kutusuna
  gerçekten yazacağı biçimde yaz. Türkçe ya da İngilizce bir sorguyu çevirme; o dilin kendi
  kültüründen, kendi yapımcılarından, kendi tür adlarından ve deyişlerinden yola çık.
- Kaliteli, ufuk açan, iyi hissettiren içerik bulduracak sorgular seç; tık tuzağı, magazin,
  drama, öfke ya da kaygı pompalayan içerikten uzak dur.
- Sorgular birbirinden farklı alt konulara gitsin; 2-6 kelime, doğal arama dili.
- "intent" alanına sorgunun ne bulduracağını tek kısa Türkçe cümleyle yaz.`;

export const NATIVE_QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: { query: { type: "string" }, intent: { type: "string" } },
        required: ["query", "intent"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries"],
  additionalProperties: false,
};

export function buildNativeQueryPrompt({ lang, topic, context = "", count = 3, avoid = [] }) {
  const language = LANGUAGES.find((l) => l.code === lang);
  const langName = language ? `${language.name} (${language.native}, ${lang})` : lang;
  return [
    `Dil: ${langName}`,
    `Konu: ${topic}`,
    context ? `Bağlam: ${context}` : "",
    avoid.length ? `Şunlara benzer sorgular yazma: ${avoid.slice(0, 30).join(" | ")}` : "",
    `${count} arama sorgusu üret.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** @returns {Promise<Array<{query:string, intent:string}>>} */
export async function generateNativeQueries(client, options, { model = DEFAULT_CLAUDE_MODEL } = {}) {
  const result = await askClaude(client, {
    system: NATIVE_QUERY_SYSTEM,
    user: buildNativeQueryPrompt(options),
    schema: NATIVE_QUERY_SCHEMA,
    model,
    maxTokens: 4000,
  });
  const seen = new Set();
  return (result.queries ?? [])
    .map((q) => ({ query: String(q.query ?? "").trim().slice(0, 100), intent: String(q.intent ?? "").trim().slice(0, 200) }))
    .filter((q) => q.query && !seen.has(q.query.toLocaleLowerCase()) && seen.add(q.query.toLocaleLowerCase()))
    .slice(0, options.count ?? 3);
}
