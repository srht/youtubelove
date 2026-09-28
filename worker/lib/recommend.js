// Kişisel video önerisi.
//
//   1. Dil filtresi (langFilter.js): anlaşılmayan dildeki içerik yalnızca dil bağımlılığı düşükse kalır.
//   2. Oturum bağlamı (mood.js): süre niyeti, ruh hali, hedef — profili değiştirmeyen filtre/çarpan.
//   3. Alaka: profil vektörüne kosinüs benzerliği (bge-m3, dilden bağımsız) + eksen Beta ortalamaları.
//      Profil vektörü henüz yoksa yalnızca eksen inançları.
//   4. Skor = alaka × kalite skoru × dil çarpanı × oturum çarpanı.
//   5. Önerilerin ~%15'i keşif: belirsiz eksen değerlerinden Thompson sampling ile seçilir.

import { AXES } from "./axes.js";
import { PROFILE_AXES } from "./beliefs.js";
import { betaMean, betaVariance, sampleBeta } from "./bandit.js";
import { languageFit, userLangMap } from "./langFilter.js";
import { applySessionContext } from "./mood.js";
import { dot } from "./embeddings.js";

export const EXPLORATION_SHARE = 0.15;
export const PROFILE_WEIGHT = 0.7; // alaka içinde vektör benzerliğinin payı (vektör varsa)
const MAX_PER_CHANNEL = 2;

const valueOf = (v, axis) => (axis === "duration" ? v.duration_bucket : v[axis]);
const labelOf = (axis, value) => AXES[axis]?.find((x) => x.id === value)?.label ?? value;

/** Videonun eksen değerlerinin Beta ortalamalarının geometrik ortalaması (0-1). */
export function axisAffinity(video, beliefs) {
  let logSum = 0;
  for (const axis of PROFILE_AXES) {
    const b = beliefs[axis]?.[valueOf(video, axis)];
    logSum += Math.log(b ? betaMean(b) : 0.5);
  }
  return Math.exp(logSum / PROFILE_AXES.length);
}

/** "Neden bu video?" — kullanıcının en çok sevdiği iki eşleşen eksen değeri. */
function exploitReason(video, beliefs) {
  const liked = PROFILE_AXES.map((axis) => {
    const value = valueOf(video, axis);
    const b = beliefs[axis]?.[value];
    return { axis, value, mean: b ? betaMean(b) : 0.5, n: b ? b.alpha + b.beta : 2 };
  })
    .filter((x) => x.mean >= 0.6 && x.n > 3)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 2);
  return liked.length ? `Sevdiklerine yakın: ${liked.map((x) => labelOf(x.axis, x.value)).join(", ")}` : "Profiline benzer";
}

function mostUncertainValue(video, beliefs) {
  return PROFILE_AXES.map((axis) => {
    const value = valueOf(video, axis);
    return { axis, value, variance: beliefs[axis]?.[value] ? betaVariance(beliefs[axis][value]) : 1 / 12 };
  }).sort((a, b) => b.variance - a.variance)[0];
}

/**
 * @param {object} args
 * @param {Array} args.candidates probe_videos satırları + quality + vector (Float32Array|null)
 * @param {Float32Array|null} args.profile
 * @param {object} args.beliefs beliefMap(...)
 * @param {Array} args.languages [{lang, level, weight}]
 * @param {object} args.session {mood, goal, duration}
 * @returns {Array<{video, score, explore:boolean, reason:string}>}
 */
export function recommend({ candidates, profile, beliefs, languages, session = {}, count = 12, rng }) {
  const langs = userLangMap(languages);
  const fitting = [];
  for (const video of candidates) {
    const fit = languageFit(video, langs);
    if (fit.ok) fitting.push({ ...video, langFactor: fit.factor });
  }
  const contextual = applySessionContext(fitting, session, count);

  const scored = contextual.map(({ video, factor }) => {
    const affinity = axisAffinity(video, beliefs);
    const similarity = profile && video.vector ? (dot(profile, video.vector) + 1) / 2 : null;
    const relevance = similarity == null ? affinity : PROFILE_WEIGHT * similarity + (1 - PROFILE_WEIGHT) * affinity;
    const quality = video.quality ?? 0.5;
    return { video, score: relevance * quality * Math.sqrt(video.langFactor) * factor, similarity, affinity };
  });

  const exploreCount = count >= 5 ? Math.max(1, Math.round(count * EXPLORATION_SHARE)) : 0;
  const exploitCount = count - exploreCount;
  const maxPerCategory = Math.max(2, Math.ceil(count / 3));

  // Sömürü: en yüksek skor, kanal ve kategori çeşitliliğiyle
  const picked = [];
  const perChannel = new Map();
  const perCategory = new Map();
  const taken = new Set();
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= exploitCount) break;
    const ch = s.video.channel_id;
    if ((perChannel.get(ch) ?? 0) >= MAX_PER_CHANNEL) continue;
    if ((perCategory.get(s.video.category) ?? 0) >= maxPerCategory) continue;
    perChannel.set(ch, (perChannel.get(ch) ?? 0) + 1);
    perCategory.set(s.video.category, (perCategory.get(s.video.category) ?? 0) + 1);
    taken.add(s.video.video_id);
    picked.push({ video: s.video, score: s.score, explore: false, reason: exploitReason(s.video, beliefs) });
  }

  // Keşif: kalitesi orta üstü, en belirsiz eksen değerleri Thompson örneğiyle en yüksek çıkanlar
  const rest = scored.filter((s) => !taken.has(s.video.video_id));
  const qualities = rest.map((s) => s.video.quality ?? 0.5).sort((a, b) => a - b);
  const median = qualities[Math.floor(qualities.length / 2)] ?? 0;
  const theta = {};
  const sampleFor = (axis, value) => {
    const key = `${axis}\t${value}`;
    if (!(key in theta)) {
      const b = beliefs[axis]?.[value] ?? { alpha: 1, beta: 1 };
      theta[key] = sampleBeta(b.alpha, b.beta, rng);
    }
    return theta[key];
  };
  const explorePool = rest
    .filter((s) => (s.video.quality ?? 0.5) >= median)
    .map((s) => {
      const uncertain = mostUncertainValue(s.video, beliefs);
      const thompson = PROFILE_AXES.reduce((p, axis) => p * sampleFor(axis, valueOf(s.video, axis)), 1);
      return { ...s, uncertain, exploreScore: thompson * uncertain.variance };
    })
    .sort((a, b) => b.exploreScore - a.exploreScore);
  const explored = [];
  const exploredValues = new Set();
  for (const s of explorePool) {
    if (explored.length >= exploreCount) break;
    const key = `${s.uncertain.axis}\t${s.uncertain.value}`;
    if (exploredValues.has(key)) continue; // her keşif farklı bir şeyi denesin
    exploredValues.add(key);
    explored.push({
      video: s.video,
      score: s.score,
      explore: true,
      reason: `Keşif: ${labelOf(s.uncertain.axis, s.uncertain.value)} — henüz emin değiliz`,
    });
  }
  // Az aday varsa sömürüyü keşif dışı kalanlarla tamamla
  const fill = [...rest]
    .sort((a, b) => b.score - a.score)
    .filter((s) => !explored.some((e) => e.video.video_id === s.video.video_id));
  while (picked.length + explored.length < count && fill.length) {
    const s = fill.shift();
    picked.push({ video: s.video, score: s.score, explore: false, reason: exploitReason(s.video, beliefs) });
  }

  // Keşifleri listeye yay (hep sonda durmasın)
  const out = [...picked];
  explored.forEach((e, i) => {
    const at = Math.min(out.length, Math.round(((i + 1) * (out.length + explored.length)) / (explored.length + 1)));
    out.splice(at, 0, e);
  });
  return out.slice(0, count);
}
