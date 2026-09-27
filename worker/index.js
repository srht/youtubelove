// Cloudflare Worker giriş noktası.
// /api/suggest isteklerini yapay zekâ uç noktasına, geri kalan her şeyi statik dosyalara yollar.

import { onRequestGet, onRequestPost } from "./suggest.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/suggest") {
      const context = { request, env, waitUntil: (p) => ctx.waitUntil(p) };
      if (request.method === "GET") return onRequestGet(context);
      if (request.method === "POST") return onRequestPost(context);
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    return env.ASSETS.fetch(request);
  },
};
