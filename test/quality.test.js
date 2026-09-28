import { describe, it, expect } from "vitest";
import { rawMetrics, percentileRanks, passesChannelSize, computeScores } from "../worker/lib/quality.js";
import config from "../config/quality.json";

const DAY = 86400000;
const NOW = Date.parse("2026-09-01T00:00:00Z");

describe("ham ölçüler", () => {
  it("oranlar; gizli beğeni ve sıfır izlenme null", () => {
    const m = rawMetrics({ views: 1000, likes: 50, comments: null, subscribers: 200, clickbait: 1.4 }, [], NOW, config);
    expect(m).toMatchObject({ outlier: 5, likeRate: 0.05, commentRate: null, evergreen: null, clickbait: 1 });
    expect(rawMetrics({ views: 0, likes: 0 }, [], NOW, config).likeRate).toBeNull();
  });

  it("evergreen: yaşlı videoda son dönem hızı / ömür boyu ortalama", () => {
    const published = new Date(NOW - 1000 * DAY).toISOString(); // 1000 günlük, 100.000 izlenme → ömür boyu 100/gün
    const snaps = [
      { capturedAt: NOW - 10 * DAY, views: 99000 },
      { capturedAt: NOW, views: 100000 }, // son 10 günde 1000 → 100/gün
    ];
    const m = rawMetrics({ views: 100000, publishedAt: published }, snaps, NOW, config);
    expect(m.evergreen).toBeCloseTo(1, 5);
  });

  it("evergreen: genç video ya da tek anlık görüntüde hesaplanmaz", () => {
    const young = new Date(NOW - 30 * DAY).toISOString();
    const snaps = [{ capturedAt: NOW - 10 * DAY, views: 1 }, { capturedAt: NOW, views: 2 }];
    expect(rawMetrics({ publishedAt: young }, snaps, NOW, config).evergreen).toBeNull();
    const old = new Date(NOW - 900 * DAY).toISOString();
    expect(rawMetrics({ publishedAt: old }, [snaps[1]], NOW, config).evergreen).toBeNull();
    // aralık minSnapshotGapDays'ten kısa
    expect(rawMetrics({ publishedAt: old }, [{ capturedAt: NOW - DAY, views: 1 }, snaps[1]], NOW, config).evergreen).toBeNull();
  });
});

describe("percentile ve kanal filtresi", () => {
  it("orta sıra percentile, null korunur", () => {
    expect(percentileRanks([10, null, 30, 20])).toEqual([0, null, 1, 0.5]);
    expect(percentileRanks([5, 5, 9])).toEqual([0.25, 0.25, 1]);
    expect(percentileRanks([7])).toEqual([0.5]);
  });

  it("kanal boyutu dile göre", () => {
    expect(passesChannelSize("tr", 600, config)).toBe(true);
    expect(passesChannelSize("en", 600, config)).toBe(false);
    expect(passesChannelSize("de", 600, config)).toBe(false); // default: 1000+
    expect(passesChannelSize("tr", 10_000_000, config)).toBe(false);
    expect(passesChannelSize("tr", null, config)).toBe(true);
  });
});

describe("kova içi skor", () => {
  const cfg = { ...config, minBucketSize: 3 };
  const item = (id, lang, category, metrics) => ({ id, lang, category, metrics: { outlier: null, likeRate: null, commentRate: null, evergreen: null, clickbait: null, ...metrics } });

  it("dil+kategori kovasında normalize eder; küçük kova dil kovasına düşer", () => {
    const items = [
      item("a", "tr", "muzik", { outlier: 1 }),
      item("b", "tr", "muzik", { outlier: 2 }),
      item("c", "tr", "muzik", { outlier: 3 }),
      item("d", "tr", "gezi", { outlier: 100 }),   // tek başına → tr:* kovası
      item("e", "en", "gezi", { outlier: 1000 }),  // en'de tek → global
    ];
    const s = computeScores(items, cfg);
    expect(s.get("a").bucket).toBe("tr:muzik");
    expect(s.get("c").components.outlier).toBe(1);
    expect(s.get("a").components.outlier).toBe(0);
    expect(s.get("d").bucket).toBe("tr:*");
    expect(s.get("d").components.outlier).toBe(1); // tr içinde en yüksek
    expect(s.get("e").bucket).toBe("*");
  });

  it("eksik bileşenler ağırlıkla birlikte düşer; hiç veri yoksa null", () => {
    const items = [
      item("a", "tr", "muzik", { outlier: 1, clickbait: 0 }),
      item("b", "tr", "muzik", { outlier: 2, clickbait: 1 }),
      item("c", "tr", "muzik", {}),
    ];
    const s = computeScores(items, cfg);
    // b: outlier pct 1 (w .3), clickbait 1-1=0 (w .2) → 0.3/0.5 = 0.6
    expect(s.get("b").quality).toBeCloseTo(0.6, 5);
    // a: outlier 0, clickbait 1 → 0.2/0.5 = 0.4
    expect(s.get("a").quality).toBeCloseTo(0.4, 5);
    expect(s.get("c").quality).toBeNull();
  });
});
