import { describe, it, expect } from "vitest";
import { api, cookieFrom, env } from "./helpers.js";

describe("/api/profile", () => {
  it("ilk ziyarette çerez verir ve tarayıcı dilinden öneri doldurur", async () => {
    const r = await api("/api/profile", { headers: { "accept-language": "en-US,en;q=0.9,tr;q=0.8" } });
    expect(r.status).toBe(200);
    expect(cookieFrom(r)).toMatch(/^yl_uid=/);
    const body = await r.json();
    expect(body.languagesSaved).toBe(false);
    expect(body.onboarded).toBe(false);
    expect(body.trackingEnabled).toBe(true);
    expect(body.suggestedLanguages).toEqual([{ lang: "en", level: "fluent" }, { lang: "tr", level: "subtitles" }]);
    expect(body.supportedLanguages.find((l) => l.code === "tr").name).toBe("Türkçe");
  });

  it("dilleri kaydeder, listede olmayanı siler, aynı seviyedeki öğrenilmiş ağırlığı korur", async () => {
    const cookie = cookieFrom(await api("/api/profile"));
    let r = await api("/api/profile/languages", {
      method: "PUT", cookie,
      body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }, { lang: "de", level: "subtitles" }] },
    });
    expect(r.status).toBe(200);
    let body = await r.json();
    expect(body.languagesSaved).toBe(true);
    expect(body.suggestedLanguages).toBeNull();
    expect(body.languages.map((l) => [l.lang, l.level, l.weight])).toEqual([
      ["tr", "fluent", 0.8], ["de", "subtitles", 0.5], ["en", "subtitles", 0.5],
    ]);

    // Davranıştan öğrenilmiş gibi İngilizce ağırlığını değiştir
    const uid = cookie.split("=")[1];
    await env.DB.prepare("UPDATE user_languages SET alpha = 9, beta = 1 WHERE user_id = ? AND lang = 'en'").bind(uid).run();

    r = await api("/api/profile/languages", {
      method: "PUT", cookie,
      body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }] },
    });
    body = await r.json();
    expect(body.languages.map((l) => [l.lang, l.weight])).toEqual([["tr", 0.8], ["en", 0.9]]); // de silindi, en korundu

    r = await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "en", level: "fluent" }] } });
    body = await r.json();
    expect(body.languages.find((l) => l.lang === "en").weight).toBe(0.8); // seviye değişti → beyana göre sıfırlandı
  });

  it("hatalı dil girdisine 400", async () => {
    const r = await api("/api/profile/languages", { method: "PUT", body: { languages: [{ lang: "en", level: "subtitles" }] } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/rahat/);
    expect((await api("/api/profile/languages", { method: "PUT", body: "{bozuk" })).status).toBe(400);
  });

  it("olay takibini kapatıp açar", async () => {
    const cookie = cookieFrom(await api("/api/profile"));
    const off = await (await api("/api/profile/tracking", { method: "PUT", cookie, body: { enabled: false } })).json();
    expect(off.trackingEnabled).toBe(false);
    expect((await api("/api/profile/tracking", { method: "PUT", cookie, body: { enabled: "evet" } })).status).toBe(400);
  });

  it("DB yoksa 503", async () => {
    expect((await api("/api/profile", { overrides: { DB: undefined } })).status).toBe(503);
  });
});
