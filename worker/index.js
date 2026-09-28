// Cloudflare Worker giriş noktası.
// /api/* istekleri aşağıdaki yönlendiriciye, geri kalan her şey statik dosyalara (public/) gider.

import { onRequestGet as suggestGet, onRequestPost as suggestPost } from "./suggest.js";
import { getProfile, putLanguages, putTracking } from "./routes/profile.js";
import { ensureMigrated } from "./lib/migrate.js";
import { error } from "./lib/http.js";

/** path → { METHOD: handler(context) }. `db: true` olan rotalar D1 migration'ını bekler. */
export const ROUTES = {
  "/api/suggest": { GET: suggestGet, POST: suggestPost },
  "/api/profile": { db: true, GET: getProfile },
  "/api/profile/languages": { db: true, PUT: putLanguages },
  "/api/profile/tracking": { db: true, PUT: putTracking },
};

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
};
