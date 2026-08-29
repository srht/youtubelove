// Geçmişte yapılan önerilerin kaydı ve kategorilere ayrılması.
//
// Kullanıcıya gösterilen her öneri buraya düşer; Kütüphanem bölümünde
// kategori başlıkları altında toplanır. Aynı öneri tekrar çıkarsa yeni satır
// açılmaz, sayacı artar ve tarihi tazelenir.

import { CATEGORIES } from "./data.js";
import { SHOW_GENRES } from "./shows.js";
import { getItemById } from "./recommend.js";
import { getShowById } from "./showRecommend.js";

const KEY = "yl_rec_history_v1";
const MAX_ENTRIES = 250;
const memoryFallback = new Map();

/** Önerinin hangi ekrandan çıktığı — kartta rozet olarak gösterilir. */
export const SOURCE_LABELS = {
  foryou: "Sana Özel",
  llm: "LLM",
  quick: "Hızlı Seçim",
  quiz: "Kısa Test",
  category: "Kategoriler",
  similar: "Benzer öneriler",
};

function read() {
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = memoryFallback.get(KEY) ?? null;
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries) {
  const payload = JSON.stringify(entries.slice(-MAX_ENTRIES));
  try {
    window.localStorage.setItem(KEY, payload);
  } catch {
    memoryFallback.set(KEY, payload);
  }
}

function keyOf(entry) {
  return `${entry.kind}:${entry.id}`;
}

/**
 * Gösterilen önerileri geçmişe yazar.
 * @param {Array<{kind:"item"|"show"|"llm", id:string, payload?:object}>} records
 * @param {string} source - SOURCE_LABELS içindeki bir anahtar
 */
export function recordRecommendations(records, source) {
  if (!Array.isArray(records) || records.length === 0) return;

  const entries = read();
  const index = new Map(entries.map((entry, i) => [keyOf(entry), i]));
  const now = new Date().toISOString();

  for (const record of records) {
    if (!record?.id || !record?.kind) continue;
    const key = keyOf(record);
    const existing = index.get(key);

    if (existing !== undefined) {
      entries[existing].count = (entries[existing].count ?? 1) + 1;
      entries[existing].at = now;
      entries[existing].source = source;
    } else {
      const entry = { kind: record.kind, id: record.id, source, at: now, count: 1 };
      if (record.payload) entry.payload = record.payload;
      index.set(key, entries.length);
      entries.push(entry);
    }
  }

  write(entries);
}

export function getHistory() {
  return read();
}

export function clearHistory() {
  write([]);
}

export function historyCount() {
  return read().length;
}

/**
 * Bir kayıt için görüntülenecek bilgileri çözer.
 * Katalogdan silinmiş (ör. kullanıcının kaldırdığı) yapımlar null döner.
 */
function resolve(entry) {
  if (entry.kind === "llm") {
    const payload = entry.payload ?? {};
    if (!payload.title || !payload.query) return null;
    return { title: payload.title, query: payload.query, why: payload.why ?? "", kindLabel: "LLM önerisi" };
  }
  if (entry.kind === "item") {
    const item = getItemById(entry.id);
    return item ? { item } : null;
  }
  const show = getShowById(entry.id);
  return show ? { show } : null;
}

/** Kayıt hangi kategori başlığı altına girecek? */
function groupOf(entry, resolved) {
  if (entry.kind === "llm") {
    return { key: "llm", label: "Yapay zekâ önerileri", emoji: "🤖" };
  }
  if (entry.kind === "item" && resolved.item) {
    const category = CATEGORIES.find((c) => c.id === resolved.item.category);
    return category
      ? { key: `cat:${category.id}`, label: category.label, emoji: category.emoji }
      : { key: "cat:diger", label: "Diğer", emoji: "📌" };
  }
  if (entry.kind === "show" && resolved.show) {
    const genreId = resolved.show.genres?.[0];
    const genre = SHOW_GENRES.find((g) => g.id === genreId);
    return genre
      ? { key: `genre:${genre.id}`, label: `Dizi & Film · ${genre.label}`, emoji: genre.emoji }
      : { key: "genre:diger", label: "Dizi & Film", emoji: "🎬" };
  }
  return { key: "diger", label: "Diğer", emoji: "📌" };
}

/**
 * Geçmişi kategorilere ayırır.
 * @returns {Array<{key:string, label:string, emoji:string, entries:Array}>}
 *   En kalabalık kategori başta; kategori içinde en yeni öneri başta.
 */
export function groupedHistory() {
  const groups = new Map();

  for (const entry of read()) {
    const resolved = resolve(entry);
    if (!resolved) continue; // katalogdan kalkmış kayıt

    const group = groupOf(entry, resolved);
    if (!groups.has(group.key)) {
      groups.set(group.key, { ...group, entries: [] });
    }
    groups.get(group.key).entries.push({ ...entry, resolved });
  }

  const list = [...groups.values()];
  list.forEach((group) => {
    group.entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  });
  list.sort((a, b) => b.entries.length - a.entries.length);
  return list;
}
