import { describe, it, expect } from "vitest";
import { normalizeLabels, chooseLanguage, previewStart, buildLabelPrompt, LABEL_SCHEMA } from "../worker/lib/probeLabel.js";
import { AXIS_IDS } from "../worker/lib/axes.js";

const good = { video_id: "a", spoken_lang: "TR", category: "muzik", tone: "sakin", depth: "hafif", format: "performans", lang_dependency: 0.1, clickbait: 0.2, note: "Enstrümantal." };

describe("etiket doğrulama", () => {
  it("geçerli etiketi alır, geçersiz eksen/sayı/dil ve bilinmeyen id elenir", () => {
    const { labels, failed } = normalizeLabels({
      videos: [
        good,
        { ...good, video_id: "b", tone: "kizgin" },
        { ...good, video_id: "c", lang_dependency: "çok" },
        { ...good, video_id: "d", spoken_lang: "turkish" },
        { ...good, video_id: "zzz" },
        { ...good, video_id: "e", clickbait: 3 },
      ],
    }, ["a", "b", "c", "d", "e", "f"]);
    expect([...labels.keys()]).toEqual(["a", "e"]);
    expect(labels.get("a")).toMatchObject({ spokenLang: "tr", langDependency: 0.1, category: "muzik" });
    expect(labels.get("e").clickbait).toBe(1);
    expect(failed).toEqual(["b", "c", "d", "f"]);
  });

  it("şema enumları eksen listeleriyle aynı", () => {
    const item = LABEL_SCHEMA.properties.videos.items.properties;
    for (const axis of ["category", "tone", "depth", "format"]) expect(item[axis].enum).toEqual(AXIS_IDS[axis]);
  });

  it("istem her videoyu kısa JSON'la verir", () => {
    const p = buildLabelPrompt([{ id: "x1", title: "T", description: "d".repeat(2000), channelTitle: "K", durationSeconds: 610, tags: [] }]);
    expect(p).toContain('"video_id": "x1"');
    expect(p).toContain('"duration_minutes": 10');
    expect(p.length).toBeLessThan(1000);
  });
});

describe("dil kararı", () => {
  it("fastText eminse fastText, değilse Claude; konuşma yoksa zxx", () => {
    expect(chooseLanguage({ lang: "tr", confidence: 0.95 }, "en", 0.7)).toEqual({ lang: "tr", confidence: 0.95, source: "fasttext" });
    expect(chooseLanguage({ lang: "en", confidence: 0.6 }, "tr", 0.7)).toEqual({ lang: "tr", confidence: 0.6, source: "claude" });
    expect(chooseLanguage({ lang: "en", confidence: 0.99 }, "zxx", 0.7).lang).toBe("zxx");
    expect(chooseLanguage(null, null, 0.7).lang).toBe("und");
  });

  it("önizleme başlangıcı girişi atlar ve sona taşmaz", () => {
    expect(previewStart(60)).toBe(0);
    expect(previewStart(120)).toBe(30);
    expect(previewStart(1000)).toBe(150);
    expect(previewStart(100)).toBe(30);
  });
});
