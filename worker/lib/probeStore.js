// Probe havuzunun D1 katmanı: içe aktarma, skor hesaplama, istatistik yenileme.

import { AXIS_IDS, LABELED_AXES } from "./axes.js";
import { rawMetrics, computeScores } from "./quality.js";
import { durationBucket, isLikelyShort, getVideos, getChannels } from "./youtube.js";

export const MAX_IMPORT_ROWS = 200;
const STATUSES = ["pending", "approved", "rejected"];
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * İnceleme dosyasından gelen satırı doğrular ve D1 biçimine çevirir.
 * @returns {{value?: object, error?: string}}
 */
export function validateProbeRow(row) {
  if (!row || typeof row !== "object") return { error: "satır nesne değil" };
  if (!VIDEO_ID.test(row.video_id ?? "")) return { error: "video_id geçersiz" };
  if (!row.title) return { error: "title boş" };
  if (!row.channel_id) return { error: "channel_id boş" };
  if (!STATUSES.includes(row.status)) return { error: `status geçersiz: ${row.status}` };
  for (const axis of LABELED_AXES) {
    if (!AXIS_IDS[axis].includes(row[axis])) return { error: `${axis} geçersiz: ${row[axis]}` };
  }
  const duration = num(row.duration_seconds);
  if (!(duration > 0)) return { error: "duration_seconds geçersiz" };
  if (isLikelyShort({ durationSeconds: duration, title: row.title, description: row.description, tags: row.tags })) {
    return { error: "Shorts havuza alınmaz" };
  }
  if (!/^([a-z]{2}|zxx)$/.test(row.lang ?? "")) return { error: `lang geçersiz: ${row.lang}` };
  if (!["fasttext", "claude", "manual"].includes(row.lang_source)) return { error: "lang_source geçersiz" };
  const langDependency = num(row.lang_dependency);
  if (!(langDependency >= 0 && langDependency <= 1)) return { error: "lang_dependency 0-1 olmalı" };
  const clickbait = num(row.clickbait);
  if (clickbait != null && !(clickbait >= 0 && clickbait <= 1)) return { error: "clickbait 0-1 olmalı" };

  return {
    value: {
      videoId: row.video_id,
      title: String(row.title).slice(0, 300),
      description: String(row.description ?? "").slice(0, 1000),
      channelId: row.channel_id,
      channelTitle: String(row.channel_title ?? ""),
      subscribers: num(row.subscribers),
      publishedAt: row.published_at ?? null,
      thumbnailUrl: row.thumbnail_url ?? `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
      durationSeconds: duration,
      durationBucket: durationBucket(duration),
      previewStart: Math.max(0, Math.min(num(row.preview_start) ?? 0, duration - 5)),
      lang: row.lang,
      langConfidence: num(row.lang_confidence),
      langSource: row.lang_source,
      category: row.category,
      tone: row.tone,
      depth: row.depth,
      format: row.format,
      langDependency,
      hasCaptions: row.has_captions === true || row.has_captions === 1 || row.has_captions === "true" ? 1 : 0,
      clickbait,
      labelSource: row.label_source === "manual" ? "manual" : "claude",
      status: row.status,
      reviewNote: row.review_note ? String(row.review_note).slice(0, 500) : null,
      views: num(row.views),
      likes: num(row.likes),
      comments: num(row.comments),
      capturedAt: num(row.captured_at),
    },
  };
}

/** Doğrulanmış satırları yazar (kanal, video, izlenme anlık görüntüsü). */
export async function importRows(db, rows, now = Date.now()) {
  const accepted = [];
  const rejected = [];
  for (const row of rows) {
    const { value, error } = validateProbeRow(row);
    if (error) rejected.push({ video_id: row?.video_id ?? null, error });
    else accepted.push(value);
  }

  const statements = [];
  for (const v of accepted) {
    statements.push(
      db.prepare(
        `INSERT INTO channels (id, title, subscribers, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title,
           subscribers = COALESCE(excluded.subscribers, channels.subscribers), updated_at = excluded.updated_at`
      ).bind(v.channelId, v.channelTitle, v.subscribers, now),
      db.prepare(
        `INSERT INTO probe_videos (video_id, title, description, channel_id, published_at, thumbnail_url,
           duration_seconds, duration_bucket, preview_start, lang, lang_confidence, lang_source,
           category, tone, depth, format, lang_dependency, has_captions, clickbait, label_source,
           status, review_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id) DO UPDATE SET
           title = excluded.title, description = excluded.description, channel_id = excluded.channel_id,
           published_at = excluded.published_at, thumbnail_url = excluded.thumbnail_url,
           duration_seconds = excluded.duration_seconds, duration_bucket = excluded.duration_bucket,
           preview_start = excluded.preview_start, lang = excluded.lang, lang_confidence = excluded.lang_confidence,
           lang_source = excluded.lang_source, category = excluded.category, tone = excluded.tone,
           depth = excluded.depth, format = excluded.format, lang_dependency = excluded.lang_dependency,
           has_captions = excluded.has_captions, clickbait = excluded.clickbait,
           label_source = excluded.label_source, status = excluded.status,
           review_note = excluded.review_note, updated_at = excluded.updated_at,
           embedding = CASE WHEN probe_videos.title = excluded.title AND probe_videos.description = excluded.description
                            THEN probe_videos.embedding ELSE NULL END`
      ).bind(
        v.videoId, v.title, v.description, v.channelId, v.publishedAt, v.thumbnailUrl,
        v.durationSeconds, v.durationBucket, v.previewStart, v.lang, v.langConfidence, v.langSource,
        v.category, v.tone, v.depth, v.format, v.langDependency, v.hasCaptions, v.clickbait, v.labelSource,
        v.status, v.reviewNote, now, now
      )
    );
    if (v.views != null) {
      statements.push(
        db.prepare(
          `INSERT OR REPLACE INTO video_stats (video_id, captured_at, views, likes, comments) VALUES (?, ?, ?, ?, ?)`
        ).bind(v.videoId, v.capturedAt ?? now, v.views, v.likes, v.comments)
      );
    }
  }
  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90));
  return { imported: accepted.length, rejected };
}

/** Onaylı havuzun bütün kalite skorlarını yeniden hesaplar. */
export async function recomputeScores(db, config, now = Date.now()) {
  const { results: videos } = await db
    .prepare(
      `SELECT v.video_id, v.lang, v.category, v.published_at, v.clickbait, c.subscribers
       FROM probe_videos v JOIN channels c ON c.id = v.channel_id WHERE v.status = 'approved'`
    )
    .all();
  if (videos.length === 0) {
    await db.prepare("DELETE FROM video_scores").run();
    return { scored: 0 };
  }
  const { results: stats } = await db
    .prepare(
      `SELECT s.video_id, s.captured_at, s.views, s.likes, s.comments FROM video_stats s
       JOIN probe_videos v ON v.video_id = s.video_id WHERE v.status = 'approved' ORDER BY s.captured_at`
    )
    .all();
  const snapshots = new Map();
  for (const s of stats) {
    if (!snapshots.has(s.video_id)) snapshots.set(s.video_id, []);
    snapshots.get(s.video_id).push({ capturedAt: s.captured_at, views: s.views, likes: s.likes, comments: s.comments });
  }

  const items = videos.map((v) => {
    const snaps = snapshots.get(v.video_id) ?? [];
    const latest = snaps[snaps.length - 1] ?? {};
    return {
      id: v.video_id,
      lang: v.lang,
      category: v.category,
      metrics: rawMetrics(
        {
          views: latest.views ?? null,
          likes: latest.likes ?? null,
          comments: latest.comments ?? null,
          subscribers: v.subscribers,
          publishedAt: v.published_at,
          clickbait: v.clickbait,
        },
        snaps,
        now,
        config
      ),
    };
  });

  const scores = computeScores(items, config);
  const statements = [db.prepare("DELETE FROM video_scores")];
  for (const [id, s] of scores) {
    const c = s.components;
    statements.push(
      db.prepare(
        `INSERT INTO video_scores (video_id, bucket, outlier, like_rate, comment_rate, evergreen, clickbait, quality, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, s.bucket, c.outlier, c.likeRate, c.commentRate, c.evergreen, c.clickbait, s.quality, now)
    );
  }
  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90));
  return { scored: scores.size };
}

/**
 * Onaylı videoların güncel izlenme/beğeni/abone sayısını YouTube'dan çeker ve anlık görüntü ekler.
 * Maliyet: 50 video başına 1 birim (videos.list) + 50 kanal başına 1 birim (channels.list).
 */
export async function refreshStats(db, apiKey, { now = Date.now(), fetchImpl, limit = 5000 } = {}) {
  const { results } = await db
    .prepare("SELECT video_id FROM probe_videos WHERE status = 'approved' ORDER BY updated_at LIMIT ?")
    .bind(limit)
    .all();
  const ids = results.map((r) => r.video_id);
  if (ids.length === 0) return { refreshed: 0, missing: 0 };

  const videos = await getVideos(ids, apiKey, fetchImpl);
  const channels = await getChannels(videos.map((v) => v.channelId), apiKey, fetchImpl);
  const statements = [];
  for (const v of videos) {
    statements.push(
      db.prepare("INSERT OR REPLACE INTO video_stats (video_id, captured_at, views, likes, comments) VALUES (?, ?, ?, ?, ?)")
        .bind(v.id, now, v.views, v.likes, v.comments),
      db.prepare("UPDATE probe_videos SET has_captions = ?, updated_at = ? WHERE video_id = ?")
        .bind(v.hasCaptions ? 1 : 0, now, v.id)
    );
  }
  for (const c of channels.values()) {
    statements.push(
      db.prepare("UPDATE channels SET subscribers = COALESCE(?, subscribers), video_count = ?, updated_at = ? WHERE id = ?")
        .bind(c.subscribers, c.videoCount, now, c.id)
    );
  }
  // YouTube'dan kaldırılmış videolar havuzdan çıkar
  const found = new Set(videos.map((v) => v.id));
  const missing = ids.filter((id) => !found.has(id));
  for (const id of missing) {
    statements.push(
      db.prepare("UPDATE probe_videos SET status = 'rejected', review_note = 'YouTube''da artık yok', updated_at = ? WHERE video_id = ?")
        .bind(now, id)
    );
  }
  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90));
  return { refreshed: videos.length, missing: missing.length };
}
