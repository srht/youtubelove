// Hafızadan zevk profili çıkarır.
//
// Sabit bir katalog olmadığı için profil, seçimlerin (ruh hali, hedef, kategori, test
// cevapları) ve etkileşilen önerilerin başlık/kategorilerinden kurulur. Profil hem
// arayüzde özetlenir hem de yapay zekâya bağlam olarak gönderilir.

import { MOODS, GOALS, CATEGORIES } from "./data.js";
import { SHOW_GENRES, SHOW_ERAS } from "./shows.js";
import { getEvents, eventWeight } from "./memory.js";
import { getWatchedItems, getSavedItems } from "./library.js";

function addWeight(map, key, amount) {
  if (!key || !Number.isFinite(amount)) return;
  map[key] = (map[key] ?? 0) + amount;
}

function top(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key);
}

function labelOf(list, id) {
  return list.find((x) => x.id === id)?.label ?? id;
}

/** Hafızadaki hareketlerden ağırlıklı bir zevk profili çıkarır. */
export function buildTasteProfile() {
  const events = getEvents();
  const moods = {};
  const goals = {};
  const categories = {};
  const filters = {};
  const opened = [];

  for (const event of events) {
    const weight = eventWeight(event);
    switch (event.t) {
      case "mood_selected":
        addWeight(moods, labelOf(MOODS, event.v), weight);
        break;
      case "goal_selected":
        addWeight(goals, labelOf(GOALS, event.v), weight);
        break;
      case "category_browsed":
        addWeight(categories, labelOf(CATEGORIES, event.v), weight);
        break;
      case "show_filter":
        addWeight(filters, event.v, weight);
        break;
      case "quiz_answer":
        if (event.k === "mood") addWeight(moods, labelOf(MOODS, event.v), weight);
        if (event.k === "goal") addWeight(goals, labelOf(GOALS, event.v), weight);
        if (event.k === "categories") addWeight(categories, labelOf(CATEGORIES, event.v), weight);
        break;
      case "item_watched":
      case "item_saved":
      case "item_opened":
        addWeight(categories, event.c, weight);
        if (event.t === "item_opened" && event.title) opened.push(event.title);
        break;
    }
  }

  const watched = getWatchedItems();
  const saved = getSavedItems();
  watched.forEach((item) => addWeight(categories, item.category, 4));
  saved.forEach((item) => addWeight(categories, item.category, 3));

  const hasSignal =
    Object.keys(moods).length + Object.keys(goals).length + Object.keys(categories).length > 0;

  return {
    eventCount: events.length,
    hasSignal,
    topMoods: top(moods, 2),
    topGoals: top(goals, 2),
    topCategories: top(categories, 3),
    topFilters: top(filters, 3),
    watchedTitles: watched.map((i) => i.title).slice(0, 20),
    savedTitles: saved.map((i) => i.title).slice(0, 15),
    openedTitles: [...new Set(opened.reverse())].slice(0, 10),
  };
}

/** Hafızanın ne öğrendiğini tek cümlede özetler (arayüz için). */
export function memorySummary(profile = buildTasteProfile()) {
  if (!profile.hasSignal) return null;
  const parts = [];
  const lower = (text) => text.toLocaleLowerCase("tr");
  if (profile.topGoals[0]) parts.push(`hedefin genelde “${lower(profile.topGoals[0])}”`);
  else if (profile.topMoods[0]) parts.push(`sık sık “${lower(profile.topMoods[0])}”`);
  if (profile.topCategories[0]) parts.push(`${lower(profile.topCategories[0])} ilgini çekiyor`);
  if (profile.watchedTitles.length > 0) parts.push(`${profile.watchedTitles.length} şey izledin`);
  return parts.length > 0 ? `Hafızam şunu görüyor: ${parts.join(", ")}.` : null;
}

/** Yapay zekâya bağlam olarak gidecek çok satırlı profil metni. */
export function profileContext(profile = buildTasteProfile()) {
  const lines = [];
  if (profile.topMoods.length) lines.push(`Sık hissettiği: ${profile.topMoods.join(", ")}`);
  if (profile.topGoals.length) lines.push(`Sık seçtiği hedefler: ${profile.topGoals.join(", ")}`);
  if (profile.topCategories.length) lines.push(`İlgi alanları: ${profile.topCategories.join(", ")}`);
  if (profile.topFilters.length) lines.push(`Dizi/film tercihleri: ${profile.topFilters.join(", ")}`);
  if (profile.watchedTitles.length) lines.push(`İzledikleri: ${profile.watchedTitles.join(", ")}`);
  if (profile.savedTitles.length) lines.push(`Sonra izlemek için kaydettikleri: ${profile.savedTitles.join(", ")}`);
  if (profile.openedTitles.length) lines.push(`Son açtıkları: ${profile.openedTitles.join(", ")}`);
  return lines.join("\n");
}

/** Dizi & Film filtre değerlerini okunur etiketlere çevirir (hafıza kaydı için). */
export function filterLabel(kind, id) {
  if (kind === "era") return labelOf(SHOW_ERAS, id);
  if (kind === "genre") return labelOf(SHOW_GENRES, id);
  return id;
}
