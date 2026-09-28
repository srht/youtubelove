import { describe, it, expect } from "vitest";
import { api, env } from "./helpers.js";
import { runMaintenance } from "../worker/index.js";
import { refreshStats } from "../worker/lib/probeStore.js";

const TOKEN = "test-admin-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const overrides = { ADMIN_TOKEN: TOKEN };

let seq = 0;
export function probeRow(extra = {}) {
  seq++;
  const id = `vid${String(seq).padStart(8, "0")}`;
  return {
    status: "approved", video_id: id, title: `Video ${seq}`, description: "Açıklama", channel_id: `ch${seq % 3}`,
    channel_title: "Kanal", subscribers: 1000 * (seq % 5 + 1), published_at: "2023-01-01T00:00:00Z",
    duration_seconds: 900, preview_start: 135, lang: "tr", lang_source: "fasttext", lang_confidence: 0.95,
    category: "bilim_doga", tone: "dusundurucu", depth: "orta", format: "belgesel", lang_dependency: 0.6,
    has_captions: true, clickbait: 0.1 * (seq % 10), label_source: "claude", views: 10000 * seq, likes: 300 * seq,
    comments: 20 * seq, captured_at: Date.parse("2026-08-01T00:00:00Z"), ...extra,
  };
}

describe("yönetici: probe içe aktarma", () => {
  it("token yoksa ya da yanlışsa reddeder", async () => {
    expect((await api("/api/admin/probe/import", { method: "POST", body: { rows: [] } })).status).toBe(503);
    expect((await api("/api/admin/probe/import", { method: "POST", body: { rows: [] }, overrides })).status).toBe(401);
    expect((await api("/api/admin/probe/import", { method: "POST", body: { rows: [] }, overrides, headers: { authorization: "Bearer yanlis" } })).status).toBe(401);
  });

  it("geçerli satırları yazar, geçersizleri gerekçesiyle döndürür, skorları hesaplar", async () => {
    const rows = [
      ...Array.from({ length: 10 }, () => probeRow()),
      probeRow({ status: "pending" }),
      probeRow({ duration_seconds: 45 }),
      probeRow({ tone: "kizgin" }),
      probeRow({ video_id: "kısa" }),
      probeRow({ lang_dependency: 2 }),
    ];
    const r = await api("/api/admin/probe/import", { method: "POST", body: { rows }, overrides, headers: auth });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.imported).toBe(11);
    expect(body.rejected.map((x) => x.error)).toEqual([
      "Shorts havuza alınmaz", "tone geçersiz: kizgin", "video_id geçersiz", "lang_dependency 0-1 olmalı",
    ]);
    expect(body.scored).toBe(10); // pending skorlanmaz

    const top = await env.DB.prepare("SELECT bucket, quality FROM video_scores ORDER BY quality DESC LIMIT 1").first();
    expect(top.bucket).toBe("tr:bilim_doga");
    expect(top.quality).toBeGreaterThan(0.5);

    const stats = await (await api("/api/admin/probe/stats", { overrides, headers: auth })).json();
    expect(stats.byStatus).toEqual(expect.arrayContaining([{ status: "approved", n: 10 }, { status: "pending", n: 1 }]));
    expect(stats.buckets[0]).toMatchObject({ lang: "tr", category: "bilim_doga", n: 10 });
  });

  it("aynı videoyu yeniden aktarınca günceller, başlık değişmediyse embedding korunur", async () => {
    const row = probeRow();
    await api("/api/admin/probe/import", { method: "POST", body: { rows: [row] }, overrides, headers: auth });
    await env.DB.prepare("UPDATE probe_videos SET embedding = x'00' WHERE video_id = ?").bind(row.video_id).run();
    await api("/api/admin/probe/import", { method: "POST", body: { rows: [{ ...row, tone: "sakin" }] }, overrides, headers: auth });
    let v = await env.DB.prepare("SELECT tone, embedding FROM probe_videos WHERE video_id = ?").bind(row.video_id).first();
    expect(v.tone).toBe("sakin");
    expect(v.embedding).not.toBeNull();
    await api("/api/admin/probe/import", { method: "POST", body: { rows: [{ ...row, title: "Yeni başlık" }] }, overrides, headers: auth });
    v = await env.DB.prepare("SELECT embedding FROM probe_videos WHERE video_id = ?").bind(row.video_id).first();
    expect(v.embedding).toBeNull();
  });

  it("çok büyük gövdeyi reddeder", async () => {
    const r = await api("/api/admin/probe/import", { method: "POST", body: { rows: Array(201).fill({}) }, overrides, headers: auth });
    expect(r.status).toBe(413);
  });
});

describe("haftalık bakım", () => {
  it("YouTube'dan anlık görüntü ekler, kaldırılan videoyu reddeder, skorları yeniler", async () => {
    const rows = Array.from({ length: 3 }, () => probeRow());
    await api("/api/admin/probe/import", { method: "POST", body: { rows }, overrides, headers: auth });
    const gone = rows[2].video_id;
    const fakeYt = async (url) => {
      const ids = url.searchParams.get("id").split(",");
      if (url.pathname.endsWith("/videos")) {
        return Response.json({ items: ids.filter((id) => id !== gone).map((id) => ({
          id, snippet: { channelId: "ch1" }, contentDetails: { duration: "PT15M", caption: "false" },
          statistics: { viewCount: "999999", likeCount: "10", commentCount: "1" },
        })) });
      }
      return Response.json({ items: ids.map((id) => ({ id, statistics: { subscriberCount: "4242", videoCount: "10" } })) });
    };
    const now = Date.parse("2026-09-01T00:00:00Z");
    const r = await refreshStats(env.DB, "K", { now, fetchImpl: fakeYt });
    expect(r.missing).toBeGreaterThanOrEqual(1);
    const snap = await env.DB.prepare("SELECT views FROM video_stats WHERE video_id = ? AND captured_at = ?").bind(rows[0].video_id, now).first();
    expect(snap.views).toBe(999999);
    const removed = await env.DB.prepare("SELECT status FROM probe_videos WHERE video_id = ?").bind(gone).first();
    expect(removed.status).toBe("rejected");
    const ch = await env.DB.prepare("SELECT subscribers FROM channels WHERE id = 'ch1'").first();
    expect(ch.subscribers).toBe(4242);
  });

  it("anahtar yoksa yalnızca yeniden skorlar", async () => {
    const result = await runMaintenance({ ...env, YOUTUBE_API_KEY: undefined });
    expect(result.refresh).toBeNull();
    expect(result.rescore.scored).toBeGreaterThanOrEqual(0);
  });
});
