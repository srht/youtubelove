// Sunucudaki anonim profil (/api/profile). Kimlik, sunucunun koyduğu yl_uid çerezidir.

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Sunucu hatası (${response.status})`);
  return data;
}

let cached = null;

/** Profili getirir; sunucu yoksa (ör. yerel statik sunucu) null döner. */
export async function getProfile({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  try {
    cached = await request("/api/profile");
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveLanguages(languages) {
  cached = await request("/api/profile/languages", { method: "PUT", body: { languages } });
  return cached;
}

export async function setTracking(enabled) {
  cached = await request("/api/profile/tracking", { method: "PUT", body: { enabled } });
  return cached;
}
