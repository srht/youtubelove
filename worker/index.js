// Cloudflare Worker giriş noktası.
// /api/* istekleri aşağıdaki yönlendiriciye, geri kalan her şey statik dosyalara (public/) gider.

import { onRequestGet as suggestGet, onRequestPost as suggestPost } from "./suggest.js";
import { getProfile, putLanguages, putTracking } from "./routes/profile.js";
import { postImport, postRescore, getStats } from "./routes/adminProbe.js";
import { postNext, postReset } from "./routes/onboarding.js";
import { ensureMigrated } from "./lib/migrate.js";
import { refreshStats, recomputeScores } from "./lib/probeStore.js";
import qualityConfig from "../config/quality.json";
import { error } from "./lib/http.js";

/** path → { METHOD: handler(context) }. `db: true` olan rotalar D1 migration'ını bekler. */
export const ROUTES = {
  "/api/suggest": { GET: suggestGet, POST: suggestPost },
  "/api/profile": { db: true, GET: getProfile },
  "/api/profile/languages": { db: true, PUT: putLanguages },
  "/api/profile/tracking": { db: true, PUT: putTracking },
  "/api/onboarding/next": { db: true, POST: postNext },
  "/api/onboarding/reset": { db: true, POST: postReset },
  "/api/admin/probe/import": { db: true, POST: postImport },
  "/api/admin/probe/rescore": { db: true, POST: postRescore },
  "/api/admin/probe/stats": { db: true, GET: getStats },
};

/**
 * Haftalık bakım (wrangler.toml [triggers]): probe havuzunun izlenme anlık görüntülerini
 * yeniler ve kalite skorlarını yeniden hesaplar. YOUTUBE_API_KEY yoksa yalnızca yeniden hesaplar.
 */
export async function runMaintenance(env, now = Date.now()) {
  if (!env.DB) return { skipped: "DB yok" };
  await ensureMigrated(env.DB);
  const refresh = env.YOUTUBE_API_KEY ? await refreshStats(env.DB, env.YOUTUBE_API_KEY, { now }) : null;
  const rescore = await recomputeScores(env.DB, qualityConfig, now);
  return { refresh, rescore };
}

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];
  if (!route) return error("Bulunamadı.", 404);
  const handler = route[request.method];
  if (!handler) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: Object.keys(route).filter((k) => k !== "db").join(", ") },
    });
  }
  if (route.db) {
    if (!env.DB) return error("Veritabanı bağlı değil.", 503);
    await ensureMigrated(env.DB);
  }
  return handler({ request, env, ctx, url });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMaintenance(env, event.scheduledTime));
  },
};
