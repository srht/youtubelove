import { describe, it, expect } from "vitest";
import {
  parseIsoDuration, durationBucket, isLikelyShort, normalizeVideo, getVideos, searchVideoIds, YouTubeError,
} from "../worker/lib/youtube.js";

describe("YouTube yardımcıları", () => {
  it("ISO süreyi saniyeye çevirir", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    expect(parseIsoDuration("bozuk")).toBeNull();
  });

  it("süre kovaları", () => {
    expect(durationBucket(100)).toBe("kisa");
    expect(durationBucket(600)).toBe("orta");
    expect(durationBucket(1800)).toBe("uzun");
    expect(durationBucket(4000)).toBe("cok_uzun");
  });

  it("Shorts'u tanır", () => {
    expect(isLikelyShort({ durationSeconds: 45 })).toBe(true);
    expect(isLikelyShort({ durationSeconds: 150, title: "Kedi #shorts" })).toBe(true);
    expect(isLikelyShort({ durationSeconds: 150, thumbnails: { high: { width: 360, height: 640 } } })).toBe(true);
    expect(isLikelyShort({ durationSeconds: 150, title: "Belgesel fragmanı" })).toBe(false);
    expect(isLikelyShort({ durationSeconds: 900, title: "#shorts derlemesi" })).toBe(false);
  });

  it("videoyu normalize eder; gizli beğeni null kalır", () => {
    const v = normalizeVideo({
      id: "abc",
      snippet: { title: "T", channelId: "C", defaultAudioLanguage: "tr" },
      contentDetails: { duration: "PT10M", caption: "true" },
      statistics: { viewCount: "1000", commentCount: "5" },
    });
    expect(v).toMatchObject({ id: "abc", durationSeconds: 600, durationBucket: "orta", hasCaptions: true, views: 1000, likes: null, comments: 5 });
  });

  it("arama parametrelerini ve toplu videos.list çağrısını kurar", async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url.pathname.endsWith("/search")) return Response.json({ items: [{ id: { videoId: "a" } }, { id: { videoId: "b" } }] });
      return Response.json({ items: url.searchParams.get("id").split(",").map((id) => ({ id, snippet: {}, contentDetails: {}, statistics: {} })) });
    };
    const { ids } = await searchVideoIds({ q: "doğa belgeseli", relevanceLanguage: "tr", regionCode: "TR" }, "K", fake);
    expect(ids).toEqual(["a", "b"]);
    expect(calls[0].searchParams.get("relevanceLanguage")).toBe("tr");
    expect(calls[0].searchParams.get("regionCode")).toBe("TR");
    const many = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const videos = await getVideos(many, "K", fake);
    expect(videos).toHaveLength(120);
    expect(calls.length).toBe(1 + 3); // 120 id → 3 videos.list çağrısı
  });

  it("kota hatasını ayırt eder", async () => {
    const fake = async () => Response.json({ error: { message: "The request cannot be completed because you have exceeded your quota." } }, { status: 403 });
    const err = await searchVideoIds({ q: "x" }, "K", fake).catch((e) => e);
    expect(err).toBeInstanceOf(YouTubeError);
    expect(err.quotaExceeded).toBe(true);
  });
});
