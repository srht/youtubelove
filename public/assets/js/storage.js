// localStorage yardımcıları ve genel tercihler.
// Depolama kullanılamıyorsa (gizli sekme, devre dışı vb.) sessizce bellek içine düşer.

const KEYS = {
  QUIZ_PROFILE: "yl_quiz_profile_v1",
  PREFS: "yl_prefs_v1",
};

const memoryFallback = new Map();

export function readJson(key, fallback) {
  let raw;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = memoryFallback.has(key) ? memoryFallback.get(key) : null;
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  const payload = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, payload);
  } catch {
    memoryFallback.set(key, payload);
  }
}

// ---- Kısa test profili ----
export function getQuizProfile() {
  return readJson(KEYS.QUIZ_PROFILE, null);
}

export function saveQuizProfile(profile) {
  writeJson(KEYS.QUIZ_PROFILE, profile);
}

// ---- Genel tercihler ----
export function getPrefs() {
  return { sort: "views", theme: "system", luckyStart: false, ...readJson(KEYS.PREFS, {}) };
}

export function savePrefs(prefs) {
  writeJson(KEYS.PREFS, prefs);
}

/** Görünüm teması: "system" | "light" | "dark". */
export function getTheme() {
  return getPrefs().theme;
}

export function setTheme(theme) {
  savePrefs({ ...getPrefs(), theme });
}

/** Açılışta rastgele öneriyle başlansın mı ("şansımı dene" modu). */
export function getLuckyStart() {
  return Boolean(getPrefs().luckyStart);
}

export function setLuckyStart(on) {
  savePrefs({ ...getPrefs(), luckyStart: Boolean(on) });
}

/** Arama sonuçlarının sıralaması (varsayılan: en çok izlenen). */
export function getSortOrder() {
  return getPrefs().sort;
}

export function setSortOrder(sort) {
  savePrefs({ ...getPrefs(), sort });
}

/** Her istekte kaç öneri gelsin. */
export function getSuggestionCount() {
  const n = Number(getPrefs().count);
  return Number.isFinite(n) ? Math.min(12, Math.max(3, n)) : 6;
}

export function setSuggestionCount(count) {
  savePrefs({ ...getPrefs(), count });
}
