import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { ensureMigrated } from "../worker/lib/migrate.js";
import { getOrCreateUser, readUid } from "../worker/lib/user.js";

beforeAll(() => ensureMigrated(env.DB));

describe("anonim kullanıcı", () => {
  it("çerez yoksa oluşturur, çerezle aynı kullanıcıyı döndürür", async () => {
    const first = await getOrCreateUser(new Request("https://x"), env.DB);
    expect(first.cookie).toMatch(/^yl_uid=[0-9a-f-]{36}; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);
    const cookie = first.cookie.split(";")[0];
    const again = await getOrCreateUser(new Request("https://x", { headers: { cookie } }), env.DB);
    expect(again.user.id).toBe(first.user.id);
    expect(again.cookie).toBeNull();
  });

  it("bozuk ya da bilinmeyen çerezde yeni kullanıcı açar", async () => {
    expect(readUid(new Request("https://x", { headers: { cookie: "yl_uid=../../etc" } }))).toBeNull();
    const unknown = "yl_uid=00000000-0000-0000-0000-000000000000";
    const r = await getOrCreateUser(new Request("https://x", { headers: { cookie: unknown } }), env.DB);
    expect(r.user.id).not.toBe("00000000-0000-0000-0000-000000000000");
    expect(r.cookie).not.toBeNull();
  });
});
