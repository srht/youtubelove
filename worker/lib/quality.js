// Kalite / "gizli cevher" skoru.
//
// Ham ölçüler (video başına):
//   outlier     izlenme / abone — kanalına göre sıradışı ilgi gören video
//   likeRate    beğeni / izlenme
//   commentRate yorum / izlenme
//   evergreen   son dönemdeki günlük izlenme hızı / ömür boyu günlük ortalama
//               (yaşlı bir video hâlâ izleniyorsa ~1 ve üstü). En az iki anlık görüntü gerekir.
//   clickbait   Claude'un 0-1 puanı (düşük iyi)
//
// Oranlar DİL + KATEGORİ kovası içinde percentile'a çevrilir; kova çok küçükse önce yalnız
// dil kovasına, sonra bütün havuza düşülür. Kalite = mevcut bileşenlerin ağırlıklı ortalaması.
// Veri eksik olan bileşen (ör. beğeni gizli) ağırlığıyla birlikte hesaptan çıkar.

const DAY = 24 * 60 * 60 * 1000;
export const RATIO_COMPONENTS = ["outlier", "likeRate", "commentRate", "evergreen"];

function ratio(a, b) {
  if (a == null || b == null || !(b > 0)) return null;
  return a / b;
}

/**
 * @param {object} video {views, likes, comments, subscribers, publishedAt, clickbait}
 * @param {Array<{capturedAt:number, views:number}>} snapshots eski → yeni
 */
export function rawMetrics(video, snapshots = [], now = Date.now(), config) {
  const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
  const ageDays = Number.isFinite(published) ? (now - published) / DAY : null;

  let evergreen = null;
  const { minAgeDays, minSnapshotGapDays } = config.evergreen;
  if (ageDays != null && ageDays >= minAgeDays && snapshots.length >= 2) {
    const latest = snapshots[snapshots.length - 1];
    const earlier = [...snapshots]
      .reverse()
      .find((s) => (latest.capturedAt - s.capturedAt) / DAY >= minSnapshotGapDays);
    if (earlier && latest.views != null && earlier.views != null) {
      const gapDays = (latest.capturedAt - earlier.capturedAt) / DAY;
      const recentPerDay = Math.max(0, latest.views - earlier.views) / gapDays;
      const lifetimePerDay = latest.views / ageDays;
      evergreen = ratio(recentPerDay, lifetimePerDay);
    }
  }

  return {
    outlier: ratio(video.views, video.subscribers),
    likeRate: ratio(video.likes, video.views),
    commentRate: ratio(video.comments, video.views),
    evergreen,
    clickbait: video.clickbait == null ? null : Math.min(1, Math.max(0, video.clickbait)),
  };
}

/** Değerleri 0-1 percentile'a çevirir (eşitlerde orta sıra). null'lar null kalır. */
export function percentileRanks(values) {
  const present = values.filter((v) => v != null).sort((a, b) => a - b);
  const n = present.length;
  return values.map((v) => {
    if (v == null || n === 0) return null;
    if (n === 1) return 0.5;
    let less = 0;
    let equal = 0;
    for (const x of present) {
      if (x < v) less++;
      else if (x === v) equal++;
    }
    return (less + (equal - 1) / 2) / (n - 1);
  });
}

/** Kanal boyutu filtresi — dile göre config'ten. Abone sayısı gizliyse geçer. */
export function passesChannelSize(lang, subscribers, config) {
  const rule = config.channelSize[lang] ?? config.channelSize.default;
  if (subscribers == null) return true;
  return subscribers >= rule.minSubscribers && subscribers <= rule.maxSubscribers;
}

/**
 * Havuzun tamamı için skorları hesaplar.
 * @param {Array<{id, lang, category, metrics}>} items metrics = rawMetrics(...)
 * @returns {Map<string, {bucket, components, quality}>}
 */
export function computeScores(items, config) {
  const groups = { full: new Map(), lang: new Map() };
  for (const item of items) {
    const full = `${item.lang}:${item.category}`;
    if (!groups.full.has(full)) groups.full.set(full, []);
    groups.full.get(full).push(item);
    if (!groups.lang.has(item.lang)) groups.lang.set(item.lang, []);
    groups.lang.get(item.lang).push(item);
  }

  const bucketOf = (item) => {
    const full = groups.full.get(`${item.lang}:${item.category}`);
    if (full.length >= config.minBucketSize) return { key: `${item.lang}:${item.category}`, members: full };
    const lang = groups.lang.get(item.lang);
    if (lang.length >= config.minBucketSize) return { key: `${item.lang}:*`, members: lang };
    return { key: "*", members: items };
  };

  // Her kova için bileşen percentile'larını bir kez hesapla
  const cache = new Map();
  const percentilesFor = (bucket) => {
    if (!cache.has(bucket.key)) {
      const byComponent = {};
      for (const c of RATIO_COMPONENTS) {
        const ranks = percentileRanks(bucket.members.map((m) => m.metrics[c]));
        byComponent[c] = new Map(bucket.members.map((m, i) => [m.id, ranks[i]]));
      }
      cache.set(bucket.key, byComponent);
    }
    return cache.get(bucket.key);
  };

  const out = new Map();
  for (const item of items) {
    const bucket = bucketOf(item);
    const pct = percentilesFor(bucket);
    const components = {};
    for (const c of RATIO_COMPONENTS) components[c] = pct[c].get(item.id);
    components.clickbait = item.metrics.clickbait == null ? null : 1 - item.metrics.clickbait;

    let sum = 0;
    let weight = 0;
    for (const [c, w] of Object.entries(config.weights)) {
      if (components[c] == null) continue;
      sum += w * components[c];
      weight += w;
    }
    out.set(item.id, { bucket: bucket.key, components, quality: weight > 0 ? sum / weight : null });
  }
  return out;
}
