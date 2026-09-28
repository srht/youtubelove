// /api/suggest uç noktası (worker/index.js yönlendirir)
//
// Sitenin bütün önerileri buradan gelir. Ziyaretçiden hiçbir anahtar istenmez.
// Yapay zekâ, kullanıcının YouTube'da aratacağı arama başlıklarını üretir; tarayıcı her başlığı
// izlenmeye göre sıralı bir YouTube arama bağlantısına çevirir.
//
//   - Varsayılan: Cloudflare Workers AI (wrangler.toml'daki `ai` bağlaması, anahtar gerekmez).
//   - Site sahibi isterse ANTHROPIC_API_KEY gizli değişkeni tanımlayıp Claude'a geçebilir.
//
// GET  /api/suggest → yapay zekânın açık olup olmadığını söyler (sağlık kontrolü).
// POST /api/suggest → { context, focus, count, avoid, lucky } → { suggestions, provider }

import { createClaude, askClaude, DEFAULT_CLAUDE_MODEL } from "./lib/claude.js";
import { readUid } from "./lib/user.js";
import { ensureMigrated } from "./lib/migrate.js";
import { languageWeight } from "./lib/languages.js";
import {
  AI_CATEGORIES,
  SYSTEM_PROMPT,
  buildUserPrompt,
  normalizeSuggestions,
  parseJsonArray,
} from "../public/assets/js/aiPrompt.js";

const WORKERS_AI_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function providerOf(env) {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.AI) return "workers-ai";
  return null;
}

// --- Yapay zekâ -----------------------------------------------------------

async function askWorkersAi(env, system, user) {
  let lastError = null;
  for (const model of WORKERS_AI_MODELS) {
    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 2048,
        temperature: 0.9,
      });
      const response = result?.response;
      // Bazı modeller JSON gördüğünde yanıtı nesne olarak döndürebilir.
      const text = typeof response === "string" ? response : JSON.stringify(response ?? "");
      if (text && text !== '""') return text;
      lastError = new Error("Model boş yanıt döndürdü.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Yapay zekâ yanıt vermedi.");
}

/** Claude'dan şemaya uyan öneri listesi ister (JSON ayrıştırma hatası olmaz). */
export const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          query: { type: "string" },
          why: { type: "string" },
          kind: { type: "string", enum: ["video", "dizi", "film"] },
          category: { type: "string", enum: AI_CATEGORIES },
          year: { type: "string" },
          lang: { type: "string" },
          gloss: { type: "string" },
        },
        required: ["title", "query", "why", "kind", "category", "year", "lang", "gloss"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

async function askAnthropic(env, system, user) {
  const client = createClaude({ apiKey: env.ANTHROPIC_API_KEY });
  const result = await askClaude(client, {
    system,
    user,
    schema: SUGGESTION_SCHEMA,
    model: env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
  });
  return result.suggestions;
}

/**
 * Çerezdeki kullanıcının dil tercihlerini (öğrenilmiş ağırlıklarıyla) okur. Kullanıcı ya da
 * veritabanı yoksa boş liste — istem o zaman Türkçe ağırlıklı kalır. Yeni kullanıcı OLUŞTURMAZ.
 */
export async function userLanguages(request, env) {
  const uid = readUid(request);
  if (!uid || !env.DB) return [];
  try {
    await ensureMigrated(env.DB);
    const { results } = await env.DB
      .prepare("SELECT lang, level, alpha, beta FROM user_languages WHERE user_id = ? ORDER BY level, lang")
      .bind(uid)
      .all();
    return results.map((r) => ({ lang: r.lang, level: r.level, weight: languageWeight(r) }));
  } catch {
    return []; // dil bilgisi olmadan da öneri verilebilir
  }
}

// --- İstek işleyicileri ----------------------------------------------------

export async function onRequestGet({ env }) {
  return json({
    available: Boolean(providerOf(env)),
    provider: providerOf(env),
  });
}

export async function onRequestPost({ request, env }) {
  const provider = providerOf(env);
  if (!provider) {
    return json(
      {
        error:
          "Sunucuda yapay zekâ tanımlı değil. wrangler.toml içindeki [ai] bağlamasının " +
          "dağıtıldığından emin ol.",
      },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }

  const count = Math.min(12, Math.max(1, Number(body.count) || 6));
  const options = {
    context: String(body.context ?? "").slice(0, 2000),
    focus: ["video", "show", "any"].includes(body.focus) ? body.focus : "any",
    count,
    avoid: (Array.isArray(body.avoid) ? body.avoid : []).map((x) => String(x).slice(0, 120)).slice(0, 40),
    lucky: Boolean(body.lucky),
    languages: await userLanguages(request, env),
  };

  let suggestions;
  try {
    const user = buildUserPrompt(options);
    const raw =
      provider === "anthropic"
        ? await askAnthropic(env, SYSTEM_PROMPT, user)
        : parseJsonArray(await askWorkersAi(env, SYSTEM_PROMPT, user));
    suggestions = normalizeSuggestions(raw, count);
  } catch (error) {
    return json({ error: `Yapay zekâ öneri üretemedi: ${error.message}` }, 502);
  }

  if (suggestions.length === 0) {
    return json({ error: "Yapay zekâ bu sefer öneri üretemedi, tekrar dene." }, 502);
  }

  // Kullanıcının seçmediği bir dilde gelen öneriyi at (model talimata uymadıysa)
  if (options.languages.length) {
    const allowed = new Set(options.languages.map((l) => l.lang));
    const filtered = suggestions.filter((s) => allowed.has(s.lang));
    if (filtered.length) suggestions = filtered;
  }

  return json({ suggestions, provider });
}
