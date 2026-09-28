import { describe, it, expect } from "vitest";
import config from "../config/quality.json";
import { languageText, prefilter, finalizeCandidates, estimateQuota } from "../scripts/probe/lib/pipeline.js";
import { toCsv, parseCsv, applyCsvEdits } from "../scripts/probe/lib/csv.js";
import { validateProbeRow } from "../worker/lib/probeStore.js";

const video = (id, extra = {}) => ({
  id, title: `Video ${id}`, description: "", tags: [], channelId: "C1", channelTitle: "Kanal",
  publishedAt: "2020-01-01T00:00:00Z", durationSeconds: 900, hasCaptions: true, views: 50000, likes: 900, comments: 40,
  thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg`, width: 480, height: 360 } }, ...extra,
});

describe("toplama hattı", () => {
  it("dil metnini temizler", () => {
    expect(languageText({ title: "Merhaba #shorts", description: "bak https://x.y/z @kanal\nyaz a@b.co" })).toBe("Merhaba bak yaz");
  });

  it("tekrar, Shorts ve az izlenmeyi eler", () => {
    const { kept, dropped } = prefilter(
      [video("aaaaaaaaaaa"), video("aaaaaaaaaaa"), video("bbbbbbbbbbb", { durationSeconds: 40 }), video("ccccccccccc", { views: 10 }), video("ddddddddddd")],
      { existingIds: new Set(["ddddddddddd"]), config }
    );
    expect(kept.map((v) => v.id)).toEqual(["aaaaaaaaaaa"]);
    expect(dropped.map((d) => d.reason)).toEqual(["zaten var", "shorts", "az izlenme", "zaten var"]);
  });

  it("dil kararından sonra kanal boyutunu uygular ve geçerli satır üretir", () => {
    const videos = [video("aaaaaaaaaaa"), video("bbbbbbbbbbb", { channelId: "C2" }), video("ccccccccccc")];
    const label = { category: "bilim_doga", tone: "dusundurucu", depth: "derin", format: "belgesel", spokenLang: "en", langDependency: 0.7, clickbait: 0.1, note: "n" };
    const { rows, dropped } = finalizeCandidates(videos, {
      channels: new Map([["C1", { subscribers: 2000 }], ["C2", { subscribers: 800 }]]),
      fasttext: new Map([["aaaaaaaaaaa", { lang: "tr", confidence: 0.9 }], ["bbbbbbbbbbb", { lang: "en", confidence: 0.5 }]]),
      labels: new Map([["aaaaaaaaaaa", label], ["bbbbbbbbbbb", label]]),
      config, query: "q", capturedAt: 1,
    });
    expect(rows.map((r) => [r.video_id, r.lang, r.lang_source])).toEqual([["aaaaaaaaaaa", "tr", "fasttext"]]);
    expect(dropped.map((d) => d.reason)).toEqual(["kanal boyutu (800)", "etiketlenemedi"]); // en için 800 abone az
    expect(rows[0]).toMatchObject({ status: "pending", preview_start: 135, has_captions: true, subscribers: 2000 });
    expect(validateProbeRow({ ...rows[0], status: "approved" }).error).toBeUndefined();
  });

  it("kota tahmini", () => {
    expect(estimateQuota({ searches: 30, videos: 450 })).toBe(3000 + 18);
  });
});

describe("CSV inceleme", () => {
  const rows = [
    { status: "pending", video_id: "aaaaaaaaaaa", title: 'Virgül, "tırnak"\nsatır', category: "muzik", tone: "sakin", lang: "tr", lang_source: "fasttext", clickbait: 0.2, label_source: "claude" },
    { status: "pending", video_id: "bbbbbbbbbbb", title: "İkinci", category: "gezi", tone: "sakin", lang: "en", lang_source: "claude", clickbait: 0.5, label_source: "claude" },
  ];

  it("gidiş-dönüş bozulmaz", () => {
    const parsed = parseCsv("﻿" + toCsv(rows));
    expect(parsed[0].title).toBe('Virgül, "tırnak"\nsatır');
    expect(parsed[1].lang).toBe("en");
  });

  it("düzenlemeleri uygular; elle değişen etiketin kaynağı manual olur", () => {
    const csv = parseCsv(toCsv(rows).replace("pending,aaaaaaaaaaa", "approved,aaaaaaaaaaa").replace("pending,bbbbbbbbbbb,İkinci,,en,claude,,gezi", "rejected,bbbbbbbbbbb,İkinci,,tr,claude,,mizah"));
    const { rows: out, changed } = applyCsvEdits(rows, csv);
    expect(changed).toBe(2);
    expect(out[0]).toMatchObject({ status: "approved", label_source: "claude" });
    expect(out[1]).toMatchObject({ status: "rejected", category: "mizah", lang: "tr", label_source: "manual", lang_source: "manual" });
  });

  it("Excel'in ondalık virgülünü kabul eder", () => {
    const { rows: out } = applyCsvEdits(rows, [{ video_id: "aaaaaaaaaaa", clickbait: "0,7" }]);
    expect(out[0].clickbait).toBe(0.7);
  });
});
