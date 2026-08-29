// Öneri eşleştirme/skorlama motoru. Hızlı Seçim, Kısa Test ve Kategoriler modlarının
// hepsi aynı score() fonksiyonunu kullanır.

import { ITEMS } from "./data.js";
import { getRecentIds } from "./storage.js";

const WEIGHTS = {
  goal: 3,
  mood: 2,
  duration: 2,
  category: 2,
  energy: 1,
  recentPenalty: -1.5,
};

/**
 * @param {object} item - data.js kaydı
 * @param {object} profile - { moods?: string[], goals?: string[], energy?: string,
 *   duration?: string, categories?: string[] }
 * @param {string[]} recentIds - son gösterilen id'ler (tekrarı azaltmak için)
 */
export function score(item, profile, recentIds = []) {
  let s = 0;

  if (profile.goals?.length) {
    if (item.goals.some((g) => profile.goals.includes(g))) s += WEIGHTS.goal;
  }
  if (profile.moods?.length) {
    if (item.moods.some((m) => profile.moods.includes(m))) s += WEIGHTS.mood;
  }
  if (profile.duration && item.duration === profile.duration) {
    s += WEIGHTS.duration;
  }
  if (profile.categories?.length) {
    if (profile.categories.includes(item.category)) s += WEIGHTS.category;
  }
  if (profile.energy && item.energy === profile.energy) {
    s += WEIGHTS.energy;
  }
  if (recentIds.includes(item.id)) {
    s += WEIGHTS.recentPenalty;
  }

  return s;
}

/**
 * Profile göre en iyi eşleşen önerileri döndürür.
 * @param {object} profile
 * @param {{ limit?: number }} [options]
 */
export function recommend(profile, options = {}) {
  const limit = options.limit ?? 6;
  const recentIds = getRecentIds();

  const scored = ITEMS.map((item) => ({
    item,
    s: score(item, profile, recentIds) + Math.random() * 0.5,
  }));

  scored.sort((a, b) => b.s - a.s);

  return scored.slice(0, limit).map((x) => x.item);
}

/**
 * Bir kategorideki tüm öğeleri (opsiyonel süre filtresiyle) listeler.
 * @param {string} categoryId
 * @param {{ duration?: string }} [options]
 */
export function listByCategory(categoryId, options = {}) {
  return ITEMS.filter((item) => {
    if (item.category !== categoryId) return false;
    if (options.duration && item.duration !== options.duration) return false;
    return true;
  });
}

/** Tarihe göre deterministik "bugünün önerisi" seçer. */
export function getDailyPick() {
  const today = new Date();
  const seed = Number(
    `${today.getFullYear()}${today.getMonth() + 1}${today.getDate()}`
  );
  const index = seed % ITEMS.length;
  return ITEMS[index];
}

export function getItemById(id) {
  return ITEMS.find((item) => item.id === id) ?? null;
}
