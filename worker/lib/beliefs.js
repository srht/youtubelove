// Kullanıcının eksen değerleri üzerindeki Beta inançları.

import { AXIS_IDS } from "./axes.js";
import { betaVariance } from "./bandit.js";

/** Profilde izlenen eksenler (dil ayrı tutulur: user_languages). */
export const PROFILE_AXES = ["category", "tone", "depth", "format", "duration"];
export const PRIOR = { alpha: 1, beta: 1 };
const PRIOR_VARIANCE = betaVariance(PRIOR); // 1/12

/** D1 satırları → { axis: { value: {alpha, beta} } } (eksik değerler önsel). */
export function beliefMap(rows = []) {
  const map = {};
  for (const axis of PROFILE_AXES) {
    map[axis] = {};
    for (const value of AXIS_IDS[axis]) map[axis][value] = { ...PRIOR };
  }
  for (const r of rows) {
    if (map[r.axis]?.[r.value]) map[r.axis][r.value] = { alpha: r.alpha, beta: r.beta };
  }
  return map;
}

export async function loadBeliefs(db, userId) {
  const { results } = await db
    .prepare("SELECT axis, value, alpha, beta FROM user_axis_beliefs WHERE user_id = ?")
    .bind(userId)
    .all();
  return beliefMap(results);
}

/**
 * Eksen belirsizliği: değerlerin Beta varyanslarının ortalaması, önsel varyansa bölünmüş.
 * 1 = hiç veri yok; 0'a yaklaştıkça kullanıcı o eksende netleşmiş demektir.
 */
export function axisUncertainty(beliefs, axis) {
  const values = Object.values(beliefs[axis]);
  return values.reduce((sum, b) => sum + betaVariance(b), 0) / values.length / PRIOR_VARIANCE;
}

/** En belirsiz `n` ekseni döndürür (eşitlikte PROFILE_AXES sırası). */
export function mostUncertainAxes(beliefs, n = 2) {
  return PROFILE_AXES.map((axis) => ({ axis, u: axisUncertainty(beliefs, axis) }))
    .sort((a, b) => b.u - a.u)
    .slice(0, n);
}
