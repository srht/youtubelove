// Yabancı dildeki video başlıklarını kullanıcının diline çevirir; D1'de önbelleğe alır.
// Workers AI m2m100 (anahtarsız) kullanılır; yoksa Claude.

import { createClaude, askClaude, DEFAULT_CLAUDE_MODEL } from "./claude.js";

const M2M100 = "@cf/meta/m2m100-1.2b";

async function translateOne(env, text, from, to) {
  if (env.AI) {
    const result = await env.AI.run(M2M100, { text, source_lang: from, target_lang: to });
    if (result?.translated_text) return { title: result.translated_text.trim(), source: "m2m100" };
  }
  if (env.ANTHROPIC_API_KEY) {
    const client = createClaude({ apiKey: env.ANTHROPIC_API_KEY });
    const out = await askClaude(client, {
      system: "Video başlıklarını çeviriyorsun. Yalnızca çeviriyi yaz; açıklama ekleme, tırnak koyma.",
      user: `Kaynak dil: ${from}\nHedef dil: ${to}\nBaşlık: ${text}`,
      model: env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
      maxTokens: 1000,
      effort: "low",
    });
    return { title: String(out).trim(), source: "claude" };
  }
  return null;
}

/**
 * @param {Array<{videoId:string, title:string, lang:string}>} items
 * @returns {Promise<Map<string, string>>} videoId → çevrilmiş başlık (çevrilemeyenler yok)
 */
export async function translateTitles(env, items, to, now = Date.now()) {
  const out = new Map();
  const todo = items.filter((i) => i.lang !== to && i.lang !== "zxx" && i.lang !== "und");
  if (!todo.length || !env.DB) return out;

  const placeholders = todo.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`SELECT video_id, title FROM video_title_translations WHERE lang = ? AND video_id IN (${placeholders})`)
    .bind(to, ...todo.map((i) => i.videoId))
    .all();
  for (const r of results) out.set(r.video_id, r.title);

  const missing = todo.filter((i) => !out.has(i.videoId));
  const fresh = await Promise.all(
    missing.map(async (i) => {
      try {
        const t = await translateOne(env, i.title, i.lang, to);
        return t ? { ...t, videoId: i.videoId } : null;
      } catch {
        return null; // çeviri olmadan orijinal başlık gösterilir
      }
    })
  );
  const statements = [];
  for (const t of fresh.filter(Boolean)) {
    out.set(t.videoId, t.title);
    statements.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO video_title_translations (video_id, lang, title, source, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(t.videoId, to, t.title, t.source, now)
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return out;
}
