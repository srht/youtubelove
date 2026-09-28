// YouTube Data API v3 istemcisi. Worker ve scripts/probe aynı modülü kullanır.
//
// Kota maliyetleri (günlük 10.000 birim): search.list = 100, videos.list = 1 (50 id'ye kadar),
// channels.list = 1 (50 id'ye kadar). Bu yüzden arama sonuçları toplu olarak detaylandırılır.

const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(status, message) {
    super(`YouTube ${status}: ${message}`);
    this.status = status;
    this.quotaExceeded = status === 403 && /quota/i.test(message);
  }
}

async function ytGet(path, params, apiKey, fetchImpl = fetch) {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  url.searchParams.set("key", apiKey);
  const response = await fetchImpl(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new YouTubeError(response.status, data?.error?.message ?? "bilinmeyen hata");
  return data;
}

/** "PT1H2M3S" → 3723 saniye. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/** Süre kovası: probe havuzu ve öneri filtreleri bu adları kullanır. */
export function durationBucket(seconds) {
  if (seconds == null) return null;
  if (seconds < 240) return "kisa";      // < 4 dk
  if (seconds < 1200) return "orta";     // 4–20 dk
  if (seconds < 3600) return "uzun";     // 20–60 dk
  return "cok_uzun";
}

/**
 * Shorts tespiti. API'de doğrudan bir alan yok; YouTube Shorts 3 dakikaya kadar olabildiği için
 * süre ≤ 180 sn VE (#shorts etiketi ya da dikey küçük resim) birlikte aranır. Süre ≤ 60 sn ise
 * her durumda Shorts sayılır.
 */
export function isLikelyShort(video) {
  const seconds = video.durationSeconds;
  if (seconds == null) return false;
  if (seconds <= 60) return true;
  if (seconds > 180) return false;
  const text = `${video.title ?? ""} ${video.description ?? ""} ${(video.tags ?? []).join(" ")}`;
  if (/#shorts?\b/i.test(text)) return true;
  const thumb = video.thumbnails?.maxres ?? video.thumbnails?.high;
  return Boolean(thumb && thumb.height > thumb.width);
}

/**
 * search.list — dil ve bölgeye göre arama.
 * @returns {Promise<string[]>} video id'leri
 */
export async function searchVideoIds(
  { q, relevanceLanguage, regionCode, maxResults = 25, order = "relevance", videoDuration = "any", pageToken },
  apiKey,
  fetchImpl
) {
  const data = await ytGet(
    "search",
    {
      part: "id",
      type: "video",
      q,
      relevanceLanguage,
      regionCode,
      maxResults: Math.min(50, maxResults),
      order,
      videoDuration,
      safeSearch: "moderate",
      pageToken,
    },
    apiKey,
    fetchImpl
  );
  return {
    ids: (data.items ?? []).map((item) => item.id?.videoId).filter(Boolean),
    nextPageToken: data.nextPageToken ?? null,
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** videos.list — snippet + contentDetails + statistics, 50'lik gruplar hâlinde. */
export async function getVideos(ids, apiKey, fetchImpl) {
  const videos = [];
  for (const group of chunk([...new Set(ids)], 50)) {
    const data = await ytGet(
      "videos",
      { part: "snippet,contentDetails,statistics", id: group.join(","), maxResults: 50 },
      apiKey,
      fetchImpl
    );
    for (const item of data.items ?? []) videos.push(normalizeVideo(item));
  }
  return videos;
}

export function normalizeVideo(item) {
  const s = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const num = (v) => (v === undefined || v === null ? null : Number(v));
  const durationSeconds = parseIsoDuration(item.contentDetails?.duration);
  return {
    id: item.id,
    title: s.title ?? "",
    description: s.description ?? "",
    tags: s.tags ?? [],
    channelId: s.channelId ?? "",
    channelTitle: s.channelTitle ?? "",
    publishedAt: s.publishedAt ?? null,
    categoryId: s.categoryId ?? null,
    defaultAudioLanguage: s.defaultAudioLanguage ?? null, // güvenilmez; yalnızca ipucu
    thumbnails: s.thumbnails ?? {},
    durationSeconds,
    durationBucket: durationBucket(durationSeconds),
    hasCaptions: item.contentDetails?.caption === "true",
    views: num(stats.viewCount),
    likes: num(stats.likeCount),       // sahibi gizlediyse null
    comments: num(stats.commentCount), // yorumlar kapalıysa null
  };
}

/** channels.list — abone ve video sayısı. @returns {Promise<Map<string, object>>} */
export async function getChannels(ids, apiKey, fetchImpl) {
  const channels = new Map();
  for (const group of chunk([...new Set(ids)], 50)) {
    const data = await ytGet("channels", { part: "statistics", id: group.join(","), maxResults: 50 }, apiKey, fetchImpl);
    for (const item of data.items ?? []) {
      const st = item.statistics ?? {};
      channels.set(item.id, {
        id: item.id,
        subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? NaN) || null,
        videoCount: Number(st.videoCount ?? 0),
      });
    }
  }
  return channels;
}
