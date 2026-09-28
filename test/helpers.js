import { env } from "cloudflare:workers";
import { handleApi } from "../worker/index.js";

/** /api isteğini doğrudan yönlendiriciye verir; `overrides` ile env parçaları değiştirilebilir. */
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
  return handleApi(request, { ...env, ...overrides }, ctx);
}

/** Set-Cookie'deki yl_uid değerini "yl_uid=..." biçiminde döndürür. */
export function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] || null;
}

export { env };
