// Kullanıcı dil tercihi mantığı. Dil listesi tarayıcıyla ortak: public/assets/js/languageList.js

import { LANGUAGES } from "../../public/assets/js/languageList.js";

export { LANGUAGES };

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));
export const LEVELS = ["fluent", "subtitles"];

/** Beyan edilen seviyeye göre davranıştan önceki başlangıç inancı. */
export const LEVEL_PRIORS = {
  fluent: { alpha: 8, beta: 2 },    // ağırlık 0.8
  subtitles: { alpha: 4, beta: 4 }, // ağırlık 0.5
};

export function languageWeight({ alpha, beta }) {
  return alpha / (alpha + beta);
}

/**
 * Accept-Language → [{lang, q}] (yalnızca desteklenen diller, q'ya göre azalan, tekrarsız).
 * "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" → [{lang:"tr",q:1},{lang:"en",q:0.8}]
 */
export function parseAcceptLanguage(header) {
  const seen = new Map();
  for (const part of String(header ?? "").split(",")) {
    const [tag, ...params] = part.trim().split(";");
    const lang = tag.trim().toLowerCase().split("-")[0];
    if (!LANGUAGE_CODES.has(lang)) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!seen.has(lang) || seen.get(lang) < q) seen.set(lang, Math.min(1, q));
  }
  return [...seen.entries()].map(([lang, q]) => ({ lang, q })).sort((a, b) => b.q - a.q);
}

/**
 * Tarayıcı dillerinden varsayılan seçim: ilk dil "rahat anlıyorum", diğerleri
 * "altyazıyla izleyebilirim". Hiç desteklenen dil yoksa Türkçe.
 */
export function defaultLanguagesFrom(header) {
  const parsed = parseAcceptLanguage(header);
  if (parsed.length === 0) return [{ lang: "tr", level: "fluent" }];
  return parsed.map((p, i) => ({ lang: p.lang, level: i === 0 ? "fluent" : "subtitles" }));
}

/** İstek gövdesindeki dil listesini doğrular. @returns {{value?: Array, error?: string}} */
export function validateLanguageInput(list) {
  if (!Array.isArray(list)) return { error: "languages bir dizi olmalı." };
  if (list.length === 0) return { error: "En az bir dil seçmelisin." };
  if (list.length > LANGUAGES.length) return { error: "Çok fazla dil." };
  const out = new Map();
  for (const item of list) {
    const lang = String(item?.lang ?? "").toLowerCase();
    if (!LANGUAGE_CODES.has(lang)) return { error: `Desteklenmeyen dil: ${lang || "(boş)"}` };
    if (!LEVELS.includes(item?.level)) return { error: `Geçersiz seviye: ${item?.level}` };
    out.set(lang, { lang, level: item.level });
  }
  if (![...out.values()].some((l) => l.level === "fluent")) {
    return { error: "En az bir dili rahat anladığını işaretlemelisin." };
  }
  return { value: [...out.values()] };
}
