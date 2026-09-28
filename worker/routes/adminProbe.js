// /api/admin/probe/* — probe havuzunu besleyen yönetici uç noktaları (scripts/probe/apply.mjs çağırır).

import { json, error, readJson } from "../lib/http.js";
import { requireAdmin } from "../lib/admin.js";
import { importRows, recomputeScores, MAX_IMPORT_ROWS } from "../lib/probeStore.js";
import { embedMissing } from "../lib/embeddings.js";
import qualityConfig from "../../config/quality.json";

export async function postImport({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  if (!Array.isArray(body?.rows)) return error("rows dizisi gerekli.", 400);
  if (body.rows.length > MAX_IMPORT_ROWS) return error(`Tek istekte en fazla ${MAX_IMPORT_ROWS} satır.`, 413);

  const result = await importRows(env.DB, body.rows);
  const rescore = body.rescore === false ? null : await recomputeScores(env.DB, qualityConfig);
  // Yeni onaylı videoların embedding'leri (Workers AI yoksa ya da hata olursa haftalık bakımda tekrar denenir)
  const embedding = await embedMissing(env).catch((err) => ({ embedded: 0, error: err.message }));
  return json({ ...result, scored: rescore?.scored ?? null, embedded: embedding.embedded });
}

export async function postRescore({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  return json(await recomputeScores(env.DB, qualityConfig));
}

export async function getStats({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  const { results: byStatus } = await env.DB
    .prepare("SELECT status, count(*) AS n FROM probe_videos GROUP BY status")
    .all();
  const { results: buckets } = await env.DB
    .prepare(
      `SELECT v.lang, v.category, count(*) AS n, round(avg(s.quality), 3) AS avg_quality
       FROM probe_videos v LEFT JOIN video_scores s ON s.video_id = v.video_id
       WHERE v.status = 'approved' GROUP BY v.lang, v.category ORDER BY v.lang, n DESC`
    )
    .all();
  return json({ byStatus, buckets });
}
