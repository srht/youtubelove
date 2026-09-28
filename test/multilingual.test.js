import { describe, it, expect } from "vitest";
import { buildUserPrompt, languageInstructions, normalizeSuggestions, SYSTEM_PROMPT } from "../public/assets/js/aiPrompt.js";
import { api, cookieFrom } from "./helpers.js";

describe("dil farkındalıklı istem", () => {
  it("dilleri seviye ve öğrenilmiş paylarıyla yazar", () => {
    const text = languageInstructions([
      { lang: "tr", level: "fluent", weight: 0.8 },
      { lang: "de", level: "subtitles", weight: 0.2 },
    ]);
    expect(text).toContain("Türkçe (tr): rahat anlıyor; önerilerdeki payı yaklaşık %80");
    expect(text).toContain("Almanca (de): altyazıyla izleyebiliyor; önerilerdeki payı yaklaşık %20");
    expect(languageInstructions([])).toBe("");
  });

  it("dil yoksa istem eskisi gibi; sistem istemi çeviri yasağını içerir", () => {
    expect(buildUserPrompt({ context: "x" })).not.toContain("izleyebildiği diller");
    expect(SYSTEM_PROMPT).toMatch(/çevirisi OLMASIN/);
  });

  it("lang ve gloss normalize edilir", () => {
    const [a, b, c] = normalizeSuggestions([
      { title: "Naturdoku Alpen", query: "Naturdoku Alpen", lang: "DE", gloss: "Alpler doğa belgeseli" },
      { title: "yağmur sesi", query: "yağmur sesi", lang: "tr", gloss: "gereksiz" },
      { title: "x", query: "x", lang: "german" },
    ]);
    expect([a.lang, a.gloss]).toEqual(["de", "Alpler doğa belgeseli"]);
    expect([b.lang, b.gloss]).toEqual(["tr", ""]);
    expect(c.lang).toBe("tr");
  });
});

describe("/api/suggest kullanıcı dilleriyle", () => {
  it("kayıtlı dilleri isteme koyar ve seçilmeyen dildeki öneriyi atar", async () => {
    const cookie = cookieFrom(await api("/api/profile"));
    await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "de", level: "subtitles" }] } });

    let prompt = "";
    const AI = { run: async (_model, input) => {
      prompt = input.messages[1].content;
      return { response: JSON.stringify([
        { title: "yağmur sesi", query: "yağmur sesi 1 saat", why: "a", kind: "video", category: "Müzik", lang: "tr", gloss: "" },
        { title: "Naturdoku Alpen", query: "Naturdoku Alpen", why: "b", kind: "video", category: "Belgesel", lang: "de", gloss: "Alpler doğa belgeseli" },
        { title: "rain sounds", query: "rain sounds", why: "c", kind: "video", category: "Müzik", lang: "en", gloss: "yağmur sesi" },
      ]) };
    } };
    const r = await api("/api/suggest", { method: "POST", cookie, body: { count: 3 }, overrides: { AI } });
    const body = await r.json();
    expect(prompt).toContain("Almanca (de): altyazıyla izleyebiliyor");
    expect(body.suggestions.map((s) => s.lang)).toEqual(["tr", "de"]);
  });

  it("çerez yoksa kullanıcı oluşturmadan Türkçe ağırlıklı çalışır", async () => {
    let prompt = "";
    const AI = { run: async (_m, input) => { prompt = input.messages[1].content; return { response: '[{"title":"a","query":"a","why":"","kind":"video","category":"Müzik"}]' }; } };
    const r = await api("/api/suggest", { method: "POST", body: { count: 1 }, overrides: { AI } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(prompt).not.toContain("izleyebildiği diller");
  });
});
