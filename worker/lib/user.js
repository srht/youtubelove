// Anonim kullanıcı kimliği: `yl_uid` çerezi + D1'de bir satır.

export const COOKIE_NAME = "yl_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;
const UID_PATTERN = /^[0-9a-f-]{36}$/;

export function readUid(request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE_NAME) {
      const value = rest.join("=");
      return UID_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

export function uidCookie(uid) {
  return `${COOKIE_NAME}=${uid}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Çerezdeki kullanıcıyı getirir, yoksa oluşturur.
 * @returns {Promise<{user: object, cookie: string|null}>} cookie yalnızca yeni kullanıcıda dolu.
 */
export async function getOrCreateUser(request, db, now = Date.now()) {
  const uid = readUid(request);
  if (uid) {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
    if (user) {
      if (now - user.last_seen_at > 60 * 60 * 1000) {
        await db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, uid).run();
        user.last_seen_at = now;
      }
      return { user, cookie: null };
    }
  }
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)")
    .bind(id, now, now)
    .run();
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return { user, cookie: uidCookie(id) };
}
