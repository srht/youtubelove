// localStorage sarmalayıcı: kaydedilenler, tercihler ve son gösterilenler geçmişi.
// Depolama kullanılamıyorsa (gizli sekme, devre dışı vb.) sessizce bellek içi düşer.

const KEYS = {
  SAVED: "yl_saved_v1",
  RECENT: "yl_recent_v1",
  QUIZ_PROFILE: "yl_quiz_profile_v1",
  PREFS: "yl_prefs_v1",
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

// ---- Genel tercihler (dil vb.) ----
export function getPrefs() {
  return readJson(KEYS.PREFS, { useEnglish: false });
}

export function savePrefs(prefs) {
  writeJson(KEYS.PREFS, prefs);
}
