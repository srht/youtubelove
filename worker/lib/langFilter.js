// Dil filtresi — onboarding kartları ve öneriler aynı kuralı kullanır.
//
//  - Rahat anlaşılan dil: geçer, çarpan = dil ağırlığı.
//  - Altyazıyla izlenen dil: altyazı varsa ya da dil bağımlılığı orta/düşükse geçer.
//  - Anlaşılmayan dil (ya da konuşmasız "zxx"): yalnızca dil bağımlılığı düşükse geçer
//    (müzik, ortam sesi, görsel anlatım); çarpan = 1 - dil bağımlılığı.

export const LOW_DEPENDENCY = 0.3;
export const SUBTITLE_MAX_DEPENDENCY_WITHOUT_CAPTIONS = 0.5;

/**
 * @param {{lang:string, lang_dependency:number, has_captions:number|boolean}} video
 * @param {Map<string, {level:string, weight:number}>} userLangs
 * @returns {{ok:boolean, factor:number, reason:string}}
 */
export function languageFit(video, userLangs) {
  const dep = Number(video.lang_dependency ?? 1);
  const captions = video.has_captions === 1 || video.has_captions === true;
  const pref = userLangs.get(video.lang);
  if (pref?.level === "fluent") return { ok: true, factor: pref.weight, reason: "fluent" };
  if (pref?.level === "subtitles") {
    if (captions) return { ok: true, factor: pref.weight, reason: "subtitles" };
    if (dep <= SUBTITLE_MAX_DEPENDENCY_WITHOUT_CAPTIONS) return { ok: true, factor: pref.weight * 0.7, reason: "subtitles-visual" };
    return { ok: false, factor: 0, reason: "altyazı yok" };
  }
  if (dep <= LOW_DEPENDENCY) return { ok: true, factor: 1 - dep, reason: "dil bağımsız" };
  return { ok: false, factor: 0, reason: "dil anlaşılmıyor" };
}

export function userLangMap(languages) {
  return new Map(languages.map((l) => [l.lang, { level: l.level, weight: l.weight ?? 0.5 }]));
}

/** Başlık çevirisinin hedef dili: en yüksek ağırlıklı rahat dil (yoksa Türkçe). */
export function primaryLanguage(languages) {
  const fluent = languages.filter((l) => l.level === "fluent").sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  return fluent[0]?.lang ?? "tr";
}
