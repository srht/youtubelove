// Mood katmanı: sitenin mevcut ruh hali / hedef / süre seçimleri (public/assets/js/data.js)
// öneride OTURUM BAZLI filtre olarak kullanılır — profili değiştirmez.

/** Ruh hali → tercih edilen / kaçınılan tonlar ve derinlikler. */
export const MOOD_RULES = {
  kaygili: { prefer: { tone: ["sakin"], depth: ["hafif", "orta"] }, avoid: { tone: ["heyecanli"] } },
  yorgun: { prefer: { tone: ["sakin", "eglenceli"], depth: ["hafif"] }, avoid: { depth: ["derin"] } },
  uykusuz: { prefer: { tone: ["sakin"], format: ["ortam", "belgesel"] }, avoid: { tone: ["heyecanli"] } },
  motivasyonsuz: { prefer: { tone: ["ilham_verici", "eglenceli"] }, avoid: {} },
  dagilmis: { prefer: { tone: ["sakin"], depth: ["hafif", "orta"] }, avoid: { tone: ["heyecanli"] } },
  huzursuz: { prefer: { tone: ["sakin"] }, avoid: { tone: ["heyecanli"] } },
  sikilmis: { prefer: { tone: ["eglenceli", "heyecanli", "dusundurucu"] }, avoid: {} },
  "meraklı": { prefer: { tone: ["dusundurucu"], depth: ["orta", "derin"] }, avoid: {} },
  mutsuz: { prefer: { tone: ["eglenceli", "duygusal", "ilham_verici"] }, avoid: {} },
  yalniz: { prefer: { tone: ["duygusal", "eglenceli"], format: ["sohbet", "vlog"] }, avoid: {} },
  enerjik: { prefer: { tone: ["heyecanli", "eglenceli"] }, avoid: {} },
};

/** Hedef → tercih edilen eksen değerleri. */
export const GOAL_RULES = {
  sakinlesmek: { tone: ["sakin"] },
  odaklanmak: { depth: ["orta", "derin"], format: ["anlatim", "rehber"] },
  ogrenmek: { format: ["anlatim", "belgesel"], depth: ["orta", "derin"] },
  motive_olmak: { tone: ["ilham_verici"] },
  ilham: { tone: ["ilham_verici"] },
  hareket: { category: ["beden"], format: ["rehber"] },
  baglanti: { format: ["sohbet"] },
  yaratmak: { category: ["yaraticilik"] },
  dinlenmek: { tone: ["sakin"], format: ["ortam"] },
};

/** Menüdeki "Bu sefer kaç dakika?" → izin verilen süre kovaları. */
export const DURATION_INTENT = {
  kisa: ["kisa", "orta"],
  orta: ["orta", "uzun"],
  uzun: ["uzun", "cok_uzun"],
};

const matchesAny = (video, rule) =>
  Object.entries(rule ?? {}).some(([axis, values]) => values.includes(axis === "duration" ? video.duration_bucket : video[axis]));

/**
 * Oturum bağlamını uygular.
 *  - Süre niyeti: sert filtre (yeterli aday kalıyorsa).
 *  - Ruh hali / hedef: tercih edilenleri 1.3×, kaçınılanları 0.5× — tercih edilenler yeterliyse
 *    yalnızca onlar tutulur (filtre), değilse yalnızca çarpan uygulanır.
 * @returns {Array<{video, factor}>}
 */
export function applySessionContext(videos, { mood, goal, duration } = {}, minCount = 6) {
  let pool = videos;
  const allowed = DURATION_INTENT[duration];
  if (allowed) {
    const filtered = pool.filter((v) => allowed.includes(v.duration_bucket));
    if (filtered.length >= minCount) pool = filtered;
  }

  const moodRule = MOOD_RULES[mood];
  const goalRule = GOAL_RULES[goal];
  const prefer = (v) => (moodRule && matchesAny(v, moodRule.prefer)) || (goalRule && matchesAny(v, goalRule));
  const avoid = (v) => moodRule && matchesAny(v, moodRule.avoid);

  let scored = pool.map((video) => ({ video, factor: avoid(video) ? 0.5 : prefer(video) ? 1.3 : 1 }));
  if (moodRule || goalRule) {
    const preferred = scored.filter((s) => s.factor > 1);
    if (preferred.length >= minCount) scored = preferred;
  }
  return scored;
}
