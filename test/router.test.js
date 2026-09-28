import { describe, it, expect } from "vitest";
import { api } from "./helpers.js";

describe("yönlendirici", () => {
  it("bilinmeyen rota 404, yanlış metot 405", async () => {
    expect((await api("/api/yok")).status).toBe(404);
    const r = await api("/api/suggest", { method: "PUT" });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("GET, POST");
  });

  it("/api/suggest sahte AI ile öneri döndürür", async () => {
    const AI = { run: async () => ({ response: '[{"title":"yağmur sesi","query":"yağmur sesi 1 saat","why":"İyi gelir.","kind":"video","category":"Müzik"}]' }) };
    const r = await api("/api/suggest", { method: "POST", body: { count: 1 }, overrides: { AI } });
    expect(r.status).toBe(200);
    expect((await r.json()).suggestions[0].title).toBe("yağmur sesi");
  });
});
