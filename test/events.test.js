import { describe, it, expect } from "vitest";
import { api, cookieFrom, env, probeRow, seedPool } from "./helpers.js";
import { validateEvent } from "../worker/routes/events.js";

const SESSION = "sess-0001-abcdef";

async function setup() {
  const rows = [
    probeRow({ category: "muzik", tone: "sakin", lang: "tr", duration_seconds: 600 }),
    probeRow({ category: "gezi", tone: "heyecanli", lang: "en", has_captions: true, duration_seconds: 600 }),
  ];
  await seedPool(rows);
  const cookie = cookieFrom(await api("/api/profile"));
  await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }] } });
  return { cookie, tr: rows[0].video_id, en: rows[1].video_id };
}

let seq = 0;
const ev = (type, videoId, extra = {}) => ({ type, videoId, seq: ++seq, at: Date.now(), surface: "onboarding", round: 1, position: 0, ...extra });

describe("olay doğrulama", () => {
  it("bilinmeyen tür, bozuk video id ve sıra no reddedilir; alanlar kırpılır", () => {
    const now = Date.now();
    expect(validateEvent({ type: "keylog", videoId: "abcdefghijk", seq: 1 }, now)).toBeNull();
    expect(validateEvent({ type: "play", videoId: "x", seq: 1 }, now)).toBeNull();
    expect(validateEvent({ type: "play", videoId: "abcdefghijk", seq: -1 }, now)).toBeNull();
    const v = validateEvent({ type: "seek", videoId: "abcdefghijk", seq: 3, from: 10, to: 90, at: now + 10 * 86400000, surface: "hack", secret: "x" }, now);
    expect(v).toMatchObject({ surface: "foryou", clientAt: now, extra: { from: 10, to: 90 } });
    expect(v.extra.secret).toBeUndefined();
  });
});

describe("/api/events", () => {
  it("olayları kaydeder, sinyal türetir ve profili günceller", async () => {
    const { cookie, tr, en } = await setup();
    const events = [
      ev("impression", tr), ev("click", tr, { target: "watch" }), ev("play", tr, { mode: "watch" }),
      ev("heartbeat", tr, { mode: "watch", watched: 5 }), ev("exit", tr, { mode: "watch", watched: 350, duration: 600 }),
      ev("impression", en), ev("click", en, { target: "watch" }), ev("play", en, { mode: "watch" }),
      ev("ended", en, { mode: "watch", watched: 590 }), ev("exit", en, { mode: "watch", watched: 590 }),
    ];
    const r = await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ stored: 10, rejected: 0, signalsUpdated: 2 });

    const uid = cookie.split("=")[1];
    const signals = await env.DB.prepare("SELECT video_id, weight, label FROM video_signals WHERE user_id = ? ORDER BY weight").bind(uid).all();
    expect(signals.results).toEqual([
      { video_id: tr, weight: 2, label: "yarısından fazlasını izledi" },
      { video_id: en, weight: 4, label: "bitirdi, yabancı dilde altyazıyla" }, // 3 × 1.5 = 4.5 → tavan 4
    ]);
    const belief = await env.DB.prepare("SELECT alpha, beta FROM user_axis_beliefs WHERE user_id = ? AND axis = 'category' AND value = 'gezi'").bind(uid).first();
    expect(belief).toEqual({ alpha: 1 + 3, beta: 1 }); // profil güncellemesinde tek video tavanı 3

    const profile = await (await api("/api/profile", { cookie })).json();
    const enLang = profile.languages.find((l) => l.lang === "en");
    expect(enLang.weight).toBeCloseTo(7 / 11, 3); // subtitles önseli 4/4 + 3
  });

  it("aynı olaylar tekrar gelince çift sayılmaz", async () => {
    const { cookie, tr } = await setup();
    const events = [ev("impression", tr), ev("click", tr, { target: "watch" }), ev("exit", tr, { mode: "watch", watched: 3 })];
    await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events } });
    await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events } });
    const uid = cookie.split("=")[1];
    const n = await env.DB.prepare("SELECT count(*) AS n FROM events WHERE user_id = ?").bind(uid).first();
    expect(n.n).toBe(3);
    const b = await env.DB.prepare("SELECT beta FROM user_axis_beliefs WHERE user_id = ? AND axis = 'category' AND value = 'muzik'").bind(uid).first();
    expect(b.beta).toBe(2); // -1 bir kez
  });

  it("dil seviyesi değişince öğrenilmiş dil ağırlığı sinyallerden yeniden hesaplanır", async () => {
    const { cookie, en } = await setup();
    await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events: [
      ev("click", en, { target: "watch" }), ev("exit", en, { mode: "watch", watched: 590 }),
    ] } });
    const body = await (await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }, { lang: "en", level: "fluent" }] } })).json();
    // fluent önseli 8/2 + sinyal 3 (tavan) → 11/13
    expect(body.languages.find((l) => l.lang === "en").weight).toBeCloseTo(11 / 13, 3);
  });

  it("havuzda olmayan video saklanır ama profile katkı vermez; bozuk olaylar sayılır", async () => {
    const { cookie } = await setup();
    const r = await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events: [
      ev("impression", "zzzzzzzzzzz"), { type: "nope", videoId: "zzzzzzzzzzz", seq: 99 },
    ] } });
    expect(await r.json()).toMatchObject({ stored: 1, rejected: 1, signalsUpdated: 0 });
  });

  it("takip kapalıysa hiçbir şey kaydetmez", async () => {
    const { cookie, tr } = await setup();
    await api("/api/profile/tracking", { method: "PUT", cookie, body: { enabled: false } });
    const r = await api("/api/events", { method: "POST", cookie, body: { sessionId: SESSION, events: [ev("impression", tr)] } });
    expect(await r.json()).toMatchObject({ stored: 0, tracking: false });
  });

  it("gövde ve oturum doğrulaması", async () => {
    expect((await api("/api/events", { method: "POST", body: { events: [] } })).status).toBe(400);
    expect((await api("/api/events", { method: "POST", body: { sessionId: "x", events: [] } })).status).toBe(400);
    expect((await api("/api/events", { method: "POST", body: { sessionId: SESSION, events: Array(201).fill({}) } })).status).toBe(413);
  });
});
