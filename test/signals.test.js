import { describe, it, expect } from "vitest";
import { deriveSignal, WEIGHTS, FOREIGN_SUBTITLE_BONUS } from "../worker/lib/signals.js";
import { accumulateBeliefs, accumulateLanguages } from "../worker/lib/profileUpdate.js";

const video = { durationSeconds: 600, lang: "tr" };
const watch = (watched, extra = []) => [
  { type: "impression" },
  { type: "click", target: "watch" },
  { type: "play", mode: "watch" },
  ...extra,
  { type: "exit", mode: "watch", watched },
];

describe("sinyal türetme", () => {
  it("gösterildi, tıklanmadı → zayıf negatif", () => {
    expect(deriveSignal([{ type: "impression" }], video)).toMatchObject({ weight: WEIGHTS.impressionOnly, label: "gösterildi, tıklanmadı" });
  });

  it("izleme süresine göre: <10 sn negatif, 30 sn+ orta, %50+ güçlü, bitirme çok güçlü", () => {
    expect(deriveSignal(watch(4), video).weight).toBe(-1);
    expect(deriveSignal(watch(20), video).weight).toBe(WEIGHTS.neutral);
    expect(deriveSignal(watch(45), video).weight).toBe(1);
    expect(deriveSignal(watch(320), video).weight).toBe(2);
    expect(deriveSignal(watch(580), video).weight).toBe(3);
    expect(deriveSignal([...watch(200), { type: "ended", mode: "watch", watched: 600 }], video)).toMatchObject({ weight: 3, label: "bitirdi" });
  });

  it("tekrar izleme çok güçlü", () => {
    const events = [...watch(60), { type: "play", mode: "watch" }, { type: "exit", mode: "watch", watched: 50 }];
    expect(deriveSignal(events, video)).toMatchObject({ weight: 3, label: "tekrar izledi" });
  });

  it("eşikler süreye göre ölçeklenir: 90 sn'lik videoda 25 sn = orta pozitif", () => {
    const short = { durationSeconds: 90, lang: "tr" };
    expect(deriveSignal(watch(25), short).weight).toBe(1);   // eşik min(30, 22.5)
    expect(deriveSignal(watch(8), short).weight).toBe(-1);   // eşik min(10, 9)
    expect(deriveSignal(watch(10), short).weight).toBe(WEIGHTS.neutral);
  });

  it("ileri sarma karışık: pozitif azalır, çok sarıp az izlemek 0", () => {
    const seek = (from, to) => ({ type: "seek", mode: "watch", from, to });
    expect(deriveSignal(watch(45, [seek(10, 100)]), video).weight).toBe(0.7);
    expect(deriveSignal(watch(45, [seek(10, 100), seek(120, 200), seek(210, 400)]), video).weight).toBe(0);
    expect(deriveSignal(watch(45, [seek(100, 50)]), video).weight).toBe(1.2); // geri sarma küçük bonus
  });

  it("önizleme hafif sinyal; önizlemenin heartbeat'i izleme sayılmaz", () => {
    const pv = (w) => [{ type: "impression" }, { type: "preview_start" }, { type: "heartbeat", mode: "preview", watched: w }, { type: "preview_end", mode: "preview", watched: w }];
    expect(deriveSignal(pv(22), video)).toMatchObject({ weight: WEIGHTS.previewLong });
    expect(deriveSignal(pv(2), video)).toMatchObject({ weight: WEIGHTS.previewSkip });
    expect(deriveSignal(pv(9), video).weight).toBe(0);
  });

  it("yabancı dilde altyazıyla uzun izleme ekstra ağırlık alır", () => {
    const en = { durationSeconds: 600, lang: "en" };
    expect(deriveSignal(watch(320), en, { level: "subtitles" }).weight).toBe(2 * FOREIGN_SUBTITLE_BONUS);
    expect(deriveSignal(watch(320), en, { level: "fluent" }).weight).toBe(2);
    expect(deriveSignal(watch(45), en, { level: "subtitles" }).weight).toBe(1); // 60 sn / %50 altında bonus yok
    expect(deriveSignal(watch(4), en, { level: "subtitles" }).weight).toBe(-1); // negatife bonus yok
  });

  it("olay yoksa null", () => {
    expect(deriveSignal([], video)).toBeNull();
    expect(deriveSignal([{ type: "hover", ms: 100 }], video)).toBeNull();
  });
});

describe("profil birikimi", () => {
  const sig = (weight, extra = {}) => ({ weight, category: "muzik", tone: "sakin", depth: "hafif", format: "performans", duration_bucket: "orta", lang: "en", ...extra });

  it("pozitif alpha'ya, negatif beta'ya; tek video tavanla sınırlı", () => {
    const acc = accumulateBeliefs([sig(2), sig(-0.3, { category: "gezi" }), sig(4.5)]);
    expect(acc.get("category\tmuzik")).toEqual({ alpha: 1 + 2 + 3, beta: 1 });
    expect(acc.get("category\tgezi")).toEqual({ alpha: 1, beta: 1.3 });
    expect(acc.get("duration\torta").alpha).toBe(6);
  });

  it("dil ağırlığı: seviye önseli + o dildeki sinyaller; seçilmemiş dil etkilenmez", () => {
    const out = accumulateLanguages(
      [{ lang: "tr", level: "fluent" }, { lang: "en", level: "subtitles" }],
      [sig(3), sig(-1), sig(2, { lang: "ja" })]
    );
    expect(out.get("en")).toEqual({ alpha: 7, beta: 5 });
    expect(out.get("tr")).toEqual({ alpha: 8, beta: 2 });
    expect(out.has("ja")).toBe(false);
  });
});
