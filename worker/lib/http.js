// Worker'daki bütün uç noktaların ortak yanıt yardımcıları.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function error(message, status) {
  return json({ error: message }, status);
}

/** Gövdeyi JSON olarak okur; bozuksa null döner. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Response'a Set-Cookie ekler (Response başlıkları değiştirilemez olabilir, kopyalanır). */
export function withCookie(response, cookie) {
  if (!cookie) return response;
  const copy = new Response(response.body, response);
  copy.headers.append("set-cookie", cookie);
  return copy;
}
