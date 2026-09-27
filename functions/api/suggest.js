// Cloudflare Pages Function — /api/suggest
//
// Sitenin bütün önerileri buradan gelir. Ziyaretçiden hiçbir anahtar istenmez:
//
//   1. Yapay zekâ: Cloudflare Workers AI (wrangler.toml'daki `ai` bağlaması, anahtar gerekmez).
//      Site sahibi isterse ANTHROPIC_API_KEY gizli değişkeni tanımlayıp Claude'a geçebilir.
//   2. YouTube: YOUTUBE_API_KEY gizli değişkeni tanımlıysa her öneri için YouTube'da
//      izlenme sayısına göre en üstteki gerçek video (başlık, kanal, kapak, izlenme) eklenir.
//      Tanımlı değilse öneriler, izlenmeye göre sıralı YouTube arama bağlantısıyla gelir.
//
// GET  /api/suggest → hangi özelliklerin açık olduğunu söyler (sağlık kontrolü).
// POST /api/suggest → { context, focus, count, avoid, lucky } → { suggestions, provider, youtube }

import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  normalizeSuggestions,
  parseJsonArray,
} from "../../assets/js/aiPrompt.js";

const WORKERS_AI_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
const YOUTUBE_CACHE_SECONDS = 60 * 60 * 24;

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

async function askAnthropic(env, system, user) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${data?.error?.message ?? "bilinmeyen hata"}`);
  }
  return (data?.content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// --- YouTube --------------------------------------------------------------

/**
 * Bir arama için YouTube'da izlenme sayısına göre en üstteki videoyu getirir.
 * Arama isteği kotadan 100 birim harcadığı için sonuç 24 saat önbellekte tutulur.
 */
async function topVideo(query, apiKey, waitUntil) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://youtubelove.cache/yt?q=${encodeURIComponent(query)}`);

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();
  }

  const search = new URL("https://www.googleapis.com/youtube/v3/search");
  search.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    order: "viewCount",
    maxResults: "1",
    q: query,
    regionCode: "TR",
    relevanceLanguage: "tr",
    safeSearch: "moderate",
    key: apiKey,
  }).toString();

  const searchResponse = await fetch(search);
  if (!searchResponse.ok) {
    const error = new Error(`YouTube ${searchResponse.status}`);
    error.status = searchResponse.status;
    throw error;
  }
  const searchData = await searchResponse.json();
  const hit = searchData.items?.[0];
  if (!hit?.id?.videoId) return null;

  let views = null;
  try {
    const stats = new URL("https://www.googleapis.com/youtube/v3/videos");
    stats.search = new URLSearchParams({ part: "statistics", id: hit.id.videoId, key: apiKey }).toString();
    const statsData = await (await fetch(stats)).json();
    views = Number(statsData.items?.[0]?.statistics?.viewCount ?? NaN);
    if (!Number.isFinite(views)) views = null;
  } catch {
    /* izlenme sayısı olmadan da gösterilebilir */
  }

  const video = {
    id: hit.id.videoId,
    title: hit.snippet?.title ?? "",
    channel: hit.snippet?.channelTitle ?? "",
    publishedAt: hit.snippet?.publishedAt ?? "",
    thumbnail:
      hit.snippet?.thumbnails?.high?.url ??
      hit.snippet?.thumbnails?.medium?.url ??
      `https://i.ytimg.com/vi/${hit.id.videoId}/hqdefault.jpg`,
    views,
  };

  if (cache) {
    const stored = new Response(JSON.stringify(video), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${YOUTUBE_CACHE_SECONDS}` },
    });
    const put = cache.put(cacheKey, stored);
    if (waitUntil) waitUntil(put);
    else await put;
  }
  return video;
}

async function attachVideos(suggestions, apiKey, waitUntil) {
  let quotaExhausted = false;
  await Promise.all(
    suggestions.map(async (suggestion) => {
      if (quotaExhausted) return;
      try {
        const video = await topVideo(suggestion.query, apiKey, waitUntil);
        if (video) suggestion.video = video;
      } catch (error) {
        // 403 genelde günlük kota dolduğunda gelir; öneriler videosuz da işe yarar.
        if (error.status === 403) quotaExhausted = true;
      }
    })
  );
  return !quotaExhausted;
}

// --- İstek işleyicileri ----------------------------------------------------

export async function onRequestGet({ env }) {
  return json({
    available: Boolean(providerOf(env)),
    provider: providerOf(env),
    youtube: Boolean(env.YOUTUBE_API_KEY),
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
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
  };

  let suggestions;
  try {
    const user = buildUserPrompt(options);
    const text =
      provider === "anthropic"
        ? await askAnthropic(env, SYSTEM_PROMPT, user)
        : await askWorkersAi(env, SYSTEM_PROMPT, user);
    suggestions = normalizeSuggestions(parseJsonArray(text), count);
  } catch (error) {
    return json({ error: `Yapay zekâ öneri üretemedi: ${error.message}` }, 502);
  }

  if (suggestions.length === 0) {
    return json({ error: "Yapay zekâ bu sefer öneri üretemedi, tekrar dene." }, 502);
  }

  let youtube = false;
  if (env.YOUTUBE_API_KEY) {
    youtube = await attachVideos(suggestions, env.YOUTUBE_API_KEY, waitUntil);
  }

  return json({ suggestions, provider, youtube });
}
