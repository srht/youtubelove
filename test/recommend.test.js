import { describe, it, expect } from "vitest";
import { recommend, axisAffinity, EXPLORATION_SHARE } from "../worker/lib/recommend.js";
import { applySessionContext } from "../worker/lib/mood.js";
import { profileVector, normalize, dot, toBlob, fromBlob, embedMissing, EMBEDDING_MODEL } from "../worker/lib/embeddings.js";
import { beliefMap } from "../worker/lib/beliefs.js";
import { seededRandom } from "../worker/lib/bandit.js";
import { AXIS_IDS } from "../worker/lib/axes.js";
import { api, cookieFrom, env, probeRow, seedPool } from "./helpers.js";

const DIM = 8;
const cats = AXIS_IDS.category;
const unit = (i) => { const v = new Float32Array(DIM); v[i % DIM] = 1; return v; };

describe("vektör yardımcıları", () => {
  it("BLOB gidiş-dönüş (ArrayBuffer ve sayı dizisi)", () => {
    const v = normalize([3, 4, 0]);
    expect([...fromBlob(toBlob(v))]).toEqual([...v]);
    expect([...fromBlob([...new Uint8Array(toBlob(v))])]).toEqual([...v]);
    expect(fromBlob(null)).toBeNull();
  });

  it("profil vektörü: pozitife yaklaşır, negatiften uzaklaşır; pozitif yoksa null", () => {
    const p = profileVector([{ weight: 2, vector: unit(0) }, { weight: -1, vector: unit(1) }]);
    expect(dot(p, unit(0))).toBeGreaterThan(0.8);
    expect(dot(p, unit(1))).toBeLessThan(0);
    expect(profileVector([{ weight: -1, vector: unit(0) }])).toBeNull();
  });
});

describe("oturum (mood) katmanı", () => {
  const vids = [
    ...Array.from({ length: 8 }, (_, i) => ({ video_id: `s${i}`, tone: "sakin", duration_bucket: "orta" })),
    ...Array.from({ length: 8 }, (_, i) => ({ video_id: `h${i}`, tone: "heyecanli", duration_bucket: "uzun" })),
  ];
  it("kaygılıyken sakin içerik yeterliyse yalnız onlar kalır", () => {
    const out = applySessionContext(vids, { mood: "kaygili" }, 6);
    expect(out.every((x) => x.video.tone === "sakin" && x.factor === 1.3)).toBe(true);
  });
  it("tercih edilen az ise filtre yerine çarpan; süre niyeti filtreler", () => {
    const out = applySessionContext(vids, { mood: "kaygili" }, 12);
    expect(out.find((x) => x.video.tone === "heyecanli").factor).toBe(0.5);
    expect(applySessionContext(vids, { duration: "uzun" }, 6).every((x) => x.video.duration_bucket === "uzun")).toBe(true);
    expect(applySessionContext(vids, {}, 6)).toHaveLength(16);
  });
});

describe("öneri motoru", () => {
  const video = (i, extra = {}) => ({
    video_id: `v${i}`, channel_id: `c${i}`, lang: "tr", lang_dependency: 0.8, has_captions: 1,
    category: cats[i % 6], tone: AXIS_IDS.tone[i % 6], depth: "orta", format: "belgesel", duration_bucket: "orta",
    quality: 0.5 + (i % 5) / 10, vector: unit(i % 6), ...extra,
  });
  const pool = Array.from({ length: 60 }, (_, i) => video(i));
  const languages = [{ lang: "tr", level: "fluent", weight: 0.8 }];

  it("profil benzerliği × kalite: profile yakın kategori öne çıkar; %10-20 keşif", () => {
    const out = recommend({ candidates: pool, profile: unit(2), beliefs: beliefMap(), languages, count: 12, rng: seededRandom(1) });
    expect(out).toHaveLength(12);
    const explore = out.filter((x) => x.explore);
    expect(explore.length).toBe(Math.round(12 * EXPLORATION_SHARE));
    expect(explore.length / 12).toBeGreaterThanOrEqual(0.1);
    expect(explore.length / 12).toBeLessThanOrEqual(0.2);
    const exploit = out.filter((x) => !x.explore);
    expect(exploit.slice(0, 3).every((x) => x.video.category === cats[2])).toBe(true);
    expect(explore[0].reason).toMatch(/^Keşif:/);
    expect(new Set(out.map((x) => x.video.video_id)).size).toBe(12);
  });

  it("aynı kanaldan en fazla 2", () => {
    const sameChannel = pool.map((v) => ({ ...v, channel_id: "tek" }));
    const out = recommend({ candidates: [...sameChannel.slice(0, 30), ...pool.slice(30)], profile: unit(0), beliefs: beliefMap(), languages, count: 12, rng: seededRandom(2) });
    expect(out.filter((x) => !x.explore && x.video.channel_id === "tek").length).toBeLessThanOrEqual(2 + 12);
    const exploitSame = out.filter((x) => !x.explore && x.video.channel_id === "tek");
    expect(exploitSame.length).toBeLessThanOrEqual(2);
  });

  it("dil filtresi: anlaşılmayan dil yalnızca dil bağımlılığı düşükse (müzik gibi) gelir", () => {
    const ja = [video(100, { lang: "ja", lang_dependency: 0.9 }), video(101, { lang: "ja", lang_dependency: 0.1, category: cats[2], vector: unit(2) })];
    const out = recommend({ candidates: [...ja, ...pool], profile: unit(2), beliefs: beliefMap(), languages, count: 30, rng: seededRandom(3) });
    const ids = out.map((x) => x.video.video_id);
    expect(ids).not.toContain("v100");
    expect(ids).toContain("v101");
  });

  it("vektör yoksa eksen inançlarına göre sıralar", () => {
    const rows = [{ axis: "category", value: cats[4], alpha: 20, beta: 1 }];
    const beliefs = beliefMap(rows);
    expect(axisAffinity(video(4), beliefs)).toBeGreaterThan(axisAffinity(video(3), beliefs));
    const out = recommend({ candidates: pool, profile: null, beliefs, languages, count: 6, rng: seededRandom(4) });
    expect(out.filter((x) => !x.explore)[0].video.category).toBe(cats[4]);
    expect(out.find((x) => !x.explore).reason).toContain("Sevdiklerine yakın");
  });
});

describe("/api/recommend uçtan uca", () => {
  it("embedding üretir, olaylardan profil vektörü çıkarır, ona yakın ve izlenmemiş videoları önerir", async () => {
    // Sahte bge-m3: başlıktaki konu kelimesine göre sabit vektör
    const topics = ["deniz", "dağ", "müzik", "tarih"];
    const AI = { run: async (model, input) => {
      if (model === EMBEDDING_MODEL) return { data: input.text.map((t) => { const v = new Array(DIM).fill(0.01); v[Math.max(0, topics.findIndex((k) => t.includes(k)))] = 1; return v; }) };
      return { translated_text: "çeviri" };
    } };
    const rows = [];
    topics.forEach((topic, ti) => {
      for (let i = 0; i < 6; i++) rows.push(probeRow({ title: `${topic} belgeseli ${i}`, channel_id: `ch-${ti}-${i}`, category: cats[ti] }));
    });
    await seedPool(rows);
    expect((await embedMissing({ ...env, AI })).embedded).toBe(24);

    const cookie = cookieFrom(await api("/api/profile"));
    await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }] } });

    // Kullanıcı iki "dağ" videosunu sonuna kadar izliyor
    const watched = rows.filter((r) => r.title.startsWith("dağ")).slice(0, 2);
    let seq = 0;
    const events = watched.flatMap((r) => [
      { type: "click", videoId: r.video_id, seq: ++seq, at: Date.now(), surface: "foryou", target: "watch" },
      { type: "ended", videoId: r.video_id, seq: ++seq, at: Date.now(), surface: "foryou", mode: "watch", watched: 900 },
    ]);
    await api("/api/events", { method: "POST", cookie, body: { sessionId: "sess-rec-000001", events } });

    const body = await (await api("/api/recommend", { method: "POST", cookie, body: { count: 6 }, overrides: { AI } })).json();
    expect(body.status).toMatchObject({ signals: 2, hasVector: true });
    const ids = body.cards.map((c) => c.videoId);
    for (const w of watched) expect(ids).not.toContain(w.video_id); // izlenen tekrar gelmez
    const exploit = body.cards.filter((c) => !c.explore);
    // 6 kartta aynı kategoriden en fazla 2 (çeşitlilik); ilk ikisi profile en yakın konu
    expect(exploit.slice(0, 2).every((c) => c.title.startsWith("dağ"))).toBe(true);
    expect(exploit.filter((c) => c.title.startsWith("dağ"))).toHaveLength(2);
    expect(body.cards.some((c) => c.explore)).toBe(true);
    expect(body.cards[0]).toHaveProperty("previewStart");
  });

  it("dil seçilmemişse onboarding ister", async () => {
    const cookie = cookieFrom(await api("/api/profile"));
    const body = await (await api("/api/recommend", { method: "POST", cookie, body: {} })).json();
    expect(body).toMatchObject({ needsOnboarding: true, cards: [] });
  });

  it("mood/goal/duration yalnızca bilinen değerlerle oturuma girer", async () => {
    const cookie = cookieFrom(await api("/api/profile"));
    await api("/api/profile/languages", { method: "PUT", cookie, body: { languages: [{ lang: "tr", level: "fluent" }] } });
    const body = await (await api("/api/recommend", { method: "POST", cookie, body: { mood: "kaygili", goal: "uydurma", duration: "orta" } })).json();
    expect(body.session).toEqual({ mood: "kaygili", goal: undefined, duration: "orta" });
  });
});
