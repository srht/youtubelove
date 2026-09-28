import { env } from "cloudflare:workers";
import { handleApi } from "../worker/index.js";

/**
 * /api isteğini doğrudan yönlendiriciye verir; `overrides` ile env parçaları değiştirilebilir.
 * Workers AI testlerde uzak bağlantı gerektirdiği için varsayılan olarak kapalıdır; gereken test
 * kendi sahte `AI`'sını verir.
 */
export async function api(path, { method = "GET", body, cookie, headers = {}, overrides = {} } = {}) {
  const request = new Request(`https://test.local${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  return handleApi(request, { ...env, AI: undefined, ...overrides }, ctx);
}

/** Set-Cookie'deki yl_uid değerini "yl_uid=..." biçiminde döndürür. */
export function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] || null;
}

export { env };

let seq = 0;
/** Geçerli bir probe satırı (içe aktarma biçiminde). */
export function probeRow(extra = {}) {
  seq++;
  const id = `vid${String(seq).padStart(8, "0")}`;
  return {
    status: "approved", video_id: id, title: `Video ${seq}`, description: "Açıklama", channel_id: `ch${seq % 3}`,
    channel_title: "Kanal", subscribers: 1000 * (seq % 5 + 1), published_at: "2023-01-01T00:00:00Z",
    duration_seconds: 900, preview_start: 135, lang: "tr", lang_source: "fasttext", lang_confidence: 0.95,
    category: "bilim_doga", tone: "dusundurucu", depth: "orta", format: "belgesel", lang_dependency: 0.6,
    has_captions: true, clickbait: 0.1 * (seq % 10), label_source: "claude", views: 10000 * seq, likes: 300 * seq,
    comments: 20 * seq, captured_at: Date.parse("2026-08-01T00:00:00Z"), ...extra,
  };
}


/** Satırları doğrudan içe aktarır ve skorlar (yönetici uç noktasını atlayarak). */
export async function seedPool(rows) {
  const { importRows, recomputeScores } = await import("../worker/lib/probeStore.js");
  const { ensureMigrated } = await import("../worker/lib/migrate.js");
  const config = (await import("../config/quality.json")).default;
  await ensureMigrated(env.DB);
  const result = await importRows(env.DB, rows);
  await recomputeScores(env.DB, config);
  return result;
}
