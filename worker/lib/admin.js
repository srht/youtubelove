// Yönetici uç noktaları için Bearer token kontrolü (ADMIN_TOKEN gizli değişkeni).

import { error } from "./http.js";

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

/** Yetkisizse hata yanıtı, yetkiliyse null döner. */
export function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return error("ADMIN_TOKEN tanımlı değil; yönetici uç noktaları kapalı.", 503);
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) return error("Yetkisiz.", 401);
  return null;
}
