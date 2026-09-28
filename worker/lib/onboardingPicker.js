// Onboarding turlarında gösterilecek kartları seçer.
//
// Tur 1 (geniş): her kategoriden en kaliteli videolar, format/ton çeşitliliği gözetilerek.
// Sonraki turlar (odaklı): Thompson sampling. Her eksen değeri için Beta'dan bir örnek çekilir;
// en belirsiz eksenin FARKLI değerlerinden, örneği en yüksek çıkan adaylar seçilir. Böylece
// belirsiz değerler (geniş dağılım) zaman zaman yüksek örnek verip sınanır, netleşmiş sevilmeyen
// değerler giderek daha az gösterilir.

import { sampleBeta, shuffle } from "./bandit.js";
import { PROFILE_AXES, mostUncertainAxes } from "./beliefs.js";

export const ROUNDS = [
  { cards: 9, mode: "broad" },
  { cards: 8, mode: "focus" },
  { cards: 6, mode: "focus" },
  { cards: 6, mode: "focus" },
];
export const MIN_ROUNDS = 3;
/** Bu turdan sonra en belirsiz eksen bile bu eşiğin altındaysa 4. tura gerek yok. */
export const STOP_UNCERTAINTY = 0.35;

const axisValue = (c, axis) => (axis === "duration" ? c.duration : c[axis]);
const baseScore = (c) => (0.5 + 0.5 * (c.quality ?? 0.5)) * (c.langFactor ?? 1);

function pickBroad(candidates, n, rng) {
  const byCategory = new Map();
  for (const c of shuffle(candidates, rng)) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  for (const list of byCategory.values()) list.sort((a, b) => baseScore(b) - baseScore(a));

  const picked = [];
  const seenFormat = new Set();
  const seenTone = new Set();
  const categories = shuffle([...byCategory.keys()], rng);
  while (picked.length < n && categories.some((k) => byCategory.get(k).length)) {
    for (const k of categories) {
      if (picked.length >= n) break;
      const list = byCategory.get(k);
      if (!list.length) continue;
      // Aynı kategoride, henüz görülmemiş format/tonu olan adayı öne al
      const idx = list.findIndex((c) => !seenFormat.has(c.format) || !seenTone.has(c.tone));
      const [choice] = list.splice(idx === -1 ? 0 : idx, 1);
      seenFormat.add(choice.format);
      seenTone.add(choice.tone);
      picked.push(choice);
    }
  }
  return picked;
}

function pickFocused(candidates, beliefs, n, rng, focusAxes) {
  // Her (eksen, değer) için tek Thompson örneği
  const theta = {};
  for (const axis of PROFILE_AXES) {
    theta[axis] = {};
    for (const [value, b] of Object.entries(beliefs[axis])) theta[axis][value] = sampleBeta(b.alpha, b.beta, rng);
  }
  const score = (c) =>
    PROFILE_AXES.reduce((p, axis) => p * (theta[axis][axisValue(c, axis)] ?? 0.5), 1) ** (1 / PROFILE_AXES.length) *
    baseScore(c);

  const remaining = new Map(candidates.map((c) => [c.videoId, c]));
  const picked = [];
  for (const axis of focusAxes) {
    // Odak eksenin değerlerini örneklenmiş θ'ya göre sırala, her değerden en iyi adayı al
    const values = Object.entries(theta[axis]).sort((a, b) => b[1] - a[1]).map(([v]) => v);
    for (const value of values) {
      if (picked.length >= n) break;
      const best = [...remaining.values()]
        .filter((c) => axisValue(c, axis) === value)
        .sort((a, b) => score(b) - score(a))[0];
      if (best) {
        picked.push(best);
        remaining.delete(best.videoId);
      }
    }
    if (picked.length >= Math.ceil(n * 0.75)) break;
  }
  // Kalan yerleri genel Thompson skoruyla doldur
  const rest = [...remaining.values()].sort((a, b) => score(b) - score(a));
  while (picked.length < n && rest.length) picked.push(rest.shift());
  return picked;
}

/**
 * @param {{candidates:Array, beliefs:object, round:number, rng:Function}} args round 1'den başlar
 * @returns {{cards:Array, focusAxes:string[], done:boolean}}
 */
export function pickRound({ candidates, beliefs, round, rng }) {
  const plan = ROUNDS[round - 1];
  if (!plan) return { cards: [], focusAxes: [], done: true };
  if (round > MIN_ROUNDS) {
    const [top] = mostUncertainAxes(beliefs, 1);
    if (top.u < STOP_UNCERTAINTY) return { cards: [], focusAxes: [], done: true };
  }
  if (plan.mode === "broad") {
    return { cards: shuffle(pickBroad(candidates, plan.cards, rng), rng), focusAxes: [], done: false };
  }
  const focusAxes = mostUncertainAxes(beliefs, 2).map((x) => x.axis);
  return { cards: shuffle(pickFocused(candidates, beliefs, plan.cards, rng, focusAxes), rng), focusAxes, done: false };
}
