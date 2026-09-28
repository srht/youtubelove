import { describe, it, expect } from "vitest";
import { seededRandom, sampleBeta, betaMean, shuffle } from "../worker/lib/bandit.js";
import { beliefMap, axisUncertainty, mostUncertainAxes } from "../worker/lib/beliefs.js";
import { pickRound, ROUNDS } from "../worker/lib/onboardingPicker.js";
import { languageFit, userLangMap, primaryLanguage } from "../worker/lib/langFilter.js";
import { translateTitles } from "../worker/lib/translate.js";
import { AXIS_IDS } from "../worker/lib/axes.js";
import { api, cookieFrom, env, probeRow, seedPool } from "./helpers.js";

describe("Beta / Thompson yardımcıları", () => {
  it("Beta örneklerinin ortalaması beklenen değere yakın ve tohumla tekrarlanabilir", () => {
    const rng = seededRandom(42);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += sampleBeta(8, 2, rng);
    expect(sum / 4000).toBeCloseTo(0.8, 1);
    expect(sampleBeta(0.5, 0.5, seededRandom(1))).toBe(sampleBeta(0.5, 0.5, seededRandom(1)));
    expect(betaMean({ alpha: 3, beta: 1 })).toBe(0.75);
    expect(shuffle([1, 2, 3, 4], seededRandom(3)).sort()).toEqual([1, 2, 3, 4]);
  });

  it("veri yoksa belirsizlik 1; gözlem arttıkça düşer; en belirsiz eksenler sıralanır", () => {
    const empty = beliefMap();
    expect(axisUncertainty(empty, "tone")).toBeCloseTo(1, 5);
    const rows = AXIS_IDS.tone.map((value) => ({ axis: "tone", value, alpha: 20, beta: 20 }));
    const learned = beliefMap(rows);
    expect(axisUncertainty(learned, "tone")).toBeLessThan(0.2);
    expect(mostUncertainAxes(learned, 5).at(-1).axis).toBe("tone");
  });
});

describe("dil filtresi", () => {
  const langs = userLangMap([{ lang: "tr", level: "fluent", weight: 0.8 }, { lang: "en", level: "subtitles", weight: 0.5 }]);
  it("rahat dil geçer; altyazılı dil altyazı ya da görsel anlatım ister; bilinmeyen dil yalnızca dil bağımsızsa", () => {
    expect(languageFit({ lang: "tr", lang_dependency: 1, has_captions: 0 }, langs)).toMatchObject({ ok: true, factor: 0.8 });
    expect(languageFit({ lang: "en", lang_dependency: 0.9, has_captions: 1 }, langs)).toMatchObject({ ok: true, factor: 0.5 });
    expect(languageFit({ lang: "en", lang_dependency: 0.9, has_captions: 0 }, langs).ok).toBe(false);
    expect(languageFit({ lang: "en", lang_dependency: 0.4, has_captions: 0 }, langs)).toMatchObject({ ok: true, factor: 0.35 });
    expect(languageFit({ lang: "ja", lang_dependency: 0.1, has_captions: 0 }, langs)).toMatchObject({ ok: true, factor: 0.9 });
    expect(languageFit({ lang: "ja", lang_dependency: 0.6, has_captions: 1 }, langs).ok).toBe(false);
    expect(primaryLanguage([{ lang: "en", level: "subtitles", weight: 0.9 }, { lang: "de", level: "fluent", weight: 0.7 }])).toBe("de");
  });
});

describe("tur seçimi", () => {
  const cand = (i, extra = {}) => ({
    videoId: `v${i}`, category: AXIS_IDS.category[i % 8], tone: AXIS_IDS.tone[i % 6], depth: AXIS_IDS.depth[i % 3],
    format: AXIS_IDS.format[i % 8], duration: AXIS_IDS.duration[i % 4], quality: (i % 10) / 10, langFactor: 1, ...extra,
  });
  const pool = Array.from({ length: 120 }, (_, i) => cand(i));

  it("ilk tur 9 kart, olabildiğince farklı kategoriler", () => {
    const { cards, focusAxes, done } = pickRound({ candidates: pool, beliefs: beliefMap(), round: 1, rng: seededRandom(7) });
    expect(done).toBe(false);
    expect(focusAxes).toEqual([]);
    expect(cards).toHaveLength(9);
    expect(new Set(cards.map((c) => c.category)).size).toBe(8);
    expect(new Set(cards.map((c) => c.videoId)).size).toBe(9);
  });

  it("odaklı tur en belirsiz ekseni sınar: o eksenin farklı değerlerini gösterir", () => {
    // tone dışındaki eksenler netleşmiş olsun → tone en belirsiz
    const rows = [];
    for (const axis of ["category", "depth", "format", "duration"]) {
      for (const value of AXIS_IDS[axis]) rows.push({ axis, value, alpha: 30, beta: 30 });
    }
    const beliefs = beliefMap(rows);
    const { cards, focusAxes } = pickRound({ candidates: pool, beliefs, round: 2, rng: seededRandom(11) });
    expect(focusAxes[0]).toBe("tone");
    expect(cards).toHaveLength(ROUNDS[1].cards);
    expect(new Set(cards.map((c) => c.tone)).size).toBe(AXIS_IDS.tone.length);
  });

  it("Thompson: çok sevilen değer, sevilmeyen değerden çok daha sık seçilir", () => {
    const rows = [];
    for (const axis of ["category", "depth", "format", "duration", "tone"]) {
      for (const value of AXIS_IDS[axis]) rows.push({ axis, value, alpha: 2, beta: 2 });
    }
    rows.push({ axis: "category", value: AXIS_IDS.category[0], alpha: 40, beta: 2 });
    rows.push({ axis: "category", value: AXIS_IDS.category[1], alpha: 2, beta: 40 });
    const beliefs = beliefMap(rows);
    let liked = 0;
    let disliked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { cards } = pickRound({ candidates: pool, beliefs, round: 3, rng: seededRandom(seed) });
      liked += cards.filter((c) => c.category === AXIS_IDS.category[0]).length;
      disliked += cards.filter((c) => c.category === AXIS_IDS.category[1]).length;
    }
    expect(liked).toBeGreaterThan(disliked * 2);
  });

  it("3. turdan sonra her şey netse durur; 5. tur yok", () => {
    const rows = [];
    for (const axis of ["category", "tone", "depth", "format", "duration"]) {
      for (const value of AXIS_IDS[axis]) rows.push({ axis, value, alpha: 30, beta: 30 });
    }
    expect(pickRound({ candidates: pool, beliefs: beliefMap(rows), round: 4, rng: seededRandom(1) }).done).toBe(true);
    expect(pickRound({ candidates: pool, beliefs: beliefMap(), round: 4, rng: seededRandom(1) }).done).toBe(false);
    expect(pickRound({ candidates: pool, beliefs: beliefMap(), round: 5, rng: seededRandom(1) }).done).toBe(true);
  });
});

describe("başlık çevirisi", () => {
  it("m2m100 ile çevirir, önbelleğe alır, hedef dildekini ve konuşmasızı atlar", async () => {
    await seedPool([]);
    const calls = [];
    const AI = { run: async (model, input) => { calls.push([model, input]); return { translated_text: `[${input.target_lang}] ${input.text}` }; } };
    const items = [
      { videoId: "a0000000001", title: "Rain in the forest", lang: "en" },
      { videoId: "a0000000002", title: "Yağmur", lang: "tr" },
      { videoId: "a0000000003", title: "Piano", lang: "zxx" },
    ];
    const first = await translateTitles({ ...env, AI }, items, "tr");
    expect([...first]).toEqual([["a0000000001", "[tr] Rain in the forest"]]);
    expect(calls[0]).toEqual(["@cf/meta/m2m100-1.2b", { text: "Rain in the forest", source_lang: "en", target_lang: "tr" }]);
    const second = await translateTitles({ ...env, AI }, items, "tr");
    expect(second.get("a0000000001")).toBe("[tr] Rain in the forest");
    expect(calls).toHaveLength(1); // önbellekten
  });

  it("çeviri hatası sessizce atlanır", async () => {
    const AI = { run: async () => { throw new Error("model yok"); } };
    const out = await translateTitles({ ...env, AI, ANTHROPIC_API_KEY: undefined }, [{ videoId: "b0000000001", title: "x", lang: "de" }], "tr");
    expect(out.size).toBe(0);
  });
});

describe("/api/onboarding", () => {
  async function userWith(languages) {
    const cookie = cookieFrom(await api("/api/profile"));
    if (languages) await api("/api/profile/languages", { method: "PUT", cookie, body: { languages } });
    return cookie;
  }
  const AI = { run: async (_m, input) => ({ translated_text: `TR: ${input.text}` }) };

  it("dil seçilmeden 409", async () => {
    const cookie = await userWith(null);
    expect((await api("/api/onboarding/next", { method: "POST", cookie })).status).toBe(409);
  });

  it("turlar ilerler, gösterilen tekrar gelmez, dil filtresi ve çeviri uygulanır, sonunda biter", async () => {
    const cats = AXIS_IDS.category;
    await seedPool([
      ...Array.from({ length: 40 }, (_, i) => probeRow({ category: cats[i % cats.length], tone: AXIS_IDS.tone[i % 6] })),
      ...Array.from({ length: 8 }, () => probeRow({ lang: "en", has_captions: true, title: "Deep sea documentary" })),
      ...Array.from({ length: 8 }, () => probeRow({ lang: "ja", lang_dependency: 0.9, title: "日本語の講義" })), // anlaşılmaz → hiç gelmemeli
    ]);
    const cookie = await userWith([{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }]);
    const seen = new Set();
    const rounds = [];
    for (let i = 0; i < 6; i++) {
      const body = await (await api("/api/onboarding/next", { method: "POST", cookie, overrides: { AI } })).json();
      if (body.done) break;
      rounds.push(body);
      for (const c of body.cards) {
        expect(seen.has(c.videoId)).toBe(false);
        seen.add(c.videoId);
        expect(c.lang).not.toBe("ja");
        if (c.lang === "en") expect(c.translatedTitle).toBe("TR: Deep sea documentary");
        if (c.lang === "tr") expect(c.translatedTitle).toBeNull();
        expect(c).toHaveProperty("previewStart");
      }
    }
    expect(rounds.map((r) => r.cards.length)).toEqual([9, 8, 6, 6]);
    expect(rounds[0].focusAxes).toEqual([]);
    expect(rounds[1].focusAxes).toHaveLength(2);
    const profile = await (await api("/api/profile", { cookie })).json();
    expect(profile.onboarded).toBe(true);

    await api("/api/onboarding/reset", { method: "POST", cookie });
    const again = await (await api("/api/onboarding/next", { method: "POST", cookie, overrides: { AI } })).json();
    expect(again.round).toBe(1);
  });

  it("havuz boşsa boş ve bitmiş döner", async () => {
    await seedPool([]);
    await env.DB.batch(["video_scores", "video_stats", "probe_videos"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    const cookie = await userWith([{ lang: "tr", level: "fluent" }]);
    const body = await (await api("/api/onboarding/next", { method: "POST", cookie })).json();
    expect(body).toMatchObject({ done: true, empty: true });
  });
});
