// Geçmişte yapılan önerilerin kaydı ve kategorilere ayrılması.
//
// Öneriler yapay zekâdan geldiği için her kayıt önerinin tamamını taşır.
// Aynı öneri tekrar çıkarsa yeni satır açılmaz; sayacı artar, tarihi tazelenir.

import { readJson, writeJson } from "./storage.js";

const KEY = "yl_rec_history_v2";
const MAX_ENTRIES = 250;

/** Önerinin hangi ekrandan çıktığı — kartta gösterilir. */
export const SOURCE_LABELS = {
  foryou: "Sana Özel",
  quick: "Hızlı Seçim",
  quiz: "Kısa Test",
  category: "Kategoriler",
  shows: "Dizi & Film",
  similar: "Benzer öneriler",
  lucky: "Şansımı dene",
};

const CATEGORY_EMOJI = {
  Dizi: "📺",
  Film: "🎬",
  Belgesel: "🎞️",
  Müzik: "🎵",
};

function read() {
  const list = readJson(KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Gösterilen önerileri geçmişe yazar. */
export function recordRecommendations(suggestions, source) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;
  const entries = read();
  const now = new Date().toISOString();
  for (const item of suggestions) {
    if (!item?.id) continue;
    const existing = entries.find((entry) => entry.item.id === item.id);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      existing.at = now;
      existing.source = source;
      existing.item = { ...existing.item, ...item };
    } else {
      entries.push({ item, source, at: now, count: 1 });
    }
  }
  writeJson(KEY, entries.slice(-MAX_ENTRIES));
}

export function clearHistory() {
  writeJson(KEY, []);
}

/**
 * Geçmişi kategorilere ayırır: en kalabalık kategori başta, içinde en yeni öneri başta.
 * @returns {Array<{key:string, label:string, emoji:string, entries:Array}>}
 */
export function groupedHistory() {
  const groups = new Map();
  for (const entry of read()) {
    const label = entry.item.category || "Diğer";
    if (!groups.has(label)) {
      groups.set(label, { key: label, label, emoji: CATEGORY_EMOJI[label] ?? "📌", entries: [] });
    }
    groups.get(label).entries.push(entry);
  }
  const list = [...groups.values()];
  list.forEach((group) => group.entries.sort((a, b) => new Date(b.at) - new Date(a.at)));
  list.sort((a, b) => b.entries.length - a.entries.length);
  return list;
}

/** Yapay zekâya "bunları önerme" diye gönderilecek son başlıklar. */
export function recentTitles(limit = 30) {
  return read()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit)
    .map((entry) => entry.item.title);
}
