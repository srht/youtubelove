// localStorage sarmalayıcı: kaydedilenler, tercihler ve son gösterilenler geçmişi.
// Depolama kullanılamıyorsa (gizli sekme, devre dışı vb.) sessizce bellek içi düşer.

const KEYS = {
  SAVED: "yl_saved_v1",
  RECENT: "yl_recent_v1",
  QUIZ_PROFILE: "yl_quiz_profile_v1",
  PREFS: "yl_prefs_v1",
  WATCHED: "yl_watched_v1",
  SAVED_SHOWS: "yl_saved_shows_v1",
};

const memoryFallback = new Map();

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.has(key) ? memoryFallback.get(key) : null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

function readJson(key, fallback) {
  const raw = safeGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  safeSet(key, JSON.stringify(value));
}

// ---- Kaydedilenler ----
export function getSavedIds() {
  return readJson(KEYS.SAVED, []);
}

export function isSaved(itemId) {
  return getSavedIds().includes(itemId);
}

export function toggleSaved(itemId) {
  const ids = getSavedIds();
  const idx = ids.indexOf(itemId);
  if (idx === -1) {
    ids.push(itemId);
  } else {
    ids.splice(idx, 1);
  }
  writeJson(KEYS.SAVED, ids);
  return ids.includes(itemId);
}

// ---- Son gösterilenler (aynı önerilerin tekrarını azaltmak için) ----
const RECENT_LIMIT = 20;

export function getRecentIds() {
  return readJson(KEYS.RECENT, []);
}

export function pushRecentIds(itemIds) {
  const current = getRecentIds();
  const merged = [...itemIds, ...current].slice(0, RECENT_LIMIT);
  writeJson(KEYS.RECENT, merged);
}

// ---- Kısa test profili ----
export function getQuizProfile() {
  return readJson(KEYS.QUIZ_PROFILE, null);
}

export function saveQuizProfile(profile) {
  writeJson(KEYS.QUIZ_PROFILE, profile);
}

// ---- İzlenenler kütüphanesi (dizi/film) ----
// [{ id, watchedAt }] biçiminde, en son izlenen başta.

export function getWatched() {
  const raw = readJson(KEYS.WATCHED, []);
  return Array.isArray(raw) ? raw.filter((e) => e && e.id) : [];
}

export function getWatchedIds() {
  return getWatched().map((e) => e.id);
}

export function isWatched(showId) {
  return getWatchedIds().includes(showId);
}

/** İzlendi işaretini açar/kapatır; yeni durumu (true = izlendi) döndürür. */
export function toggleWatched(showId) {
  const entries = getWatched();
  const idx = entries.findIndex((e) => e.id === showId);
  if (idx === -1) {
    entries.unshift({ id: showId, watchedAt: new Date().toISOString() });
    writeJson(KEYS.WATCHED, entries);
    return true;
  }
  entries.splice(idx, 1);
  writeJson(KEYS.WATCHED, entries);
  return false;
}

// ---- Kaydedilen dizi/filmler (izleme listesi) ----
export function getSavedShowIds() {
  return readJson(KEYS.SAVED_SHOWS, []);
}

export function isShowSaved(showId) {
  return getSavedShowIds().includes(showId);
}

export function toggleSavedShow(showId) {
  const ids = getSavedShowIds();
  const idx = ids.indexOf(showId);
  if (idx === -1) ids.push(showId);
  else ids.splice(idx, 1);
  writeJson(KEYS.SAVED_SHOWS, ids);
  return ids.includes(showId);
}

// ---- Genel tercihler (dil vb.) ----
export function getPrefs() {
  return { useEnglish: false, sort: "views", theme: "system", ...readJson(KEYS.PREFS, {}) };
}

/** Görünüm teması: "system" | "light" | "dark". */
export function getTheme() {
  return getPrefs().theme;
}

export function setTheme(theme) {
  savePrefs({ ...getPrefs(), theme });
}

/** Arama sonuçlarının sıralaması (varsayılan: en çok izlenen). */
export function getSortOrder() {
  return getPrefs().sort;
}

export function setSortOrder(sort) {
  savePrefs({ ...getPrefs(), sort });
}

export function savePrefs(prefs) {
  writeJson(KEYS.PREFS, prefs);
}
