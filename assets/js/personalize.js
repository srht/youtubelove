// Hafızadan zevk profili çıkarır ve buna göre dinamik öneri üretir.
//
// Akış:  memory.js (ham hareketler)  →  buildTasteProfile()  →  personalizedPicks()
// Öneriler hem video önerilerini (data.js) hem dizi/filmleri (shows.js) kapsar.

import { ITEMS, CATEGORIES, MOODS, GOALS } from "./data.js";
import { SHOW_GENRES, SHOW_MOODS, SHOW_ERAS, SHOW_ORIGINS, eraOf } from "./shows.js";
import { getItemById } from "./recommend.js";
import { allShows, getShowById } from "./showRecommend.js";
import { getEvents, eventWeight } from "./memory.js";
import { getWatchedIds, getSavedIds, getSavedShowIds } from "./storage.js";

function addWeight(map, key, amount) {
  if (!key || !Number.isFinite(amount)) return;
  map[key] = (map[key] ?? 0) + amount;
}

/** Haritayı 0–1 aralığına indirger ki farklı boyutlar karşılaştırılabilsin. */
function normalize(map) {
  const max = Math.max(0, ...Object.values(map));
  if (max <= 0) return {};
  const out = {};
  for (const [key, value] of Object.entries(map)) out[key] = value / max;
  return out;
}

function topKey(map) {
  let best = null;
  let bestValue = 0;
  for (const [key, value] of Object.entries(map)) {
    if (value > bestValue) {
      bestValue = value;
      best = key;
    }
  }
  return best;
}

function labelOf(list, id) {
  return list.find((x) => x.id === id)?.label ?? id;
}

/**
 * Hafızadaki hareketlerden ağırlıklı bir zevk profili çıkarır.
 * @returns {object} normalize edilmiş boyut haritaları
 */
export function buildTasteProfile() {
  const events = getEvents();

  const raw = {
    moods: {}, goals: {}, categories: {}, durations: {}, energies: {},
    showGenres: {}, showMoods: {}, eras: {}, origins: {}, types: {}, intensities: {},
  };

  const seenItemIds = new Set();
  const seenShowIds = new Set();
  // Aşağıdaki yedek tarama, olaylardan zaten sayılanları tekrar saymasın diye.
  const watchedFromEvents = new Set();
  const savedItemsFromEvents = new Set();
  const savedShowsFromEvents = new Set();

  const absorbItem = (item, weight) => {
    item.moods.forEach((m) => addWeight(raw.moods, m, weight));
    item.goals.forEach((g) => addWeight(raw.goals, g, weight));
    addWeight(raw.categories, item.category, weight);
    addWeight(raw.durations, item.duration, weight * 0.5);
    addWeight(raw.energies, item.energy, weight * 0.5);
  };

  const absorbShow = (show, weight) => {
    show.genres.forEach((g) => addWeight(raw.showGenres, g, weight));
    show.moods.forEach((m) => addWeight(raw.showMoods, m, weight));
    if (show.startYear != null) addWeight(raw.eras, eraOf(show.startYear), weight);
    addWeight(raw.origins, show.origin, weight);
    addWeight(raw.types, show.type, weight * 0.5);
    addWeight(raw.intensities, show.intensity, weight * 0.5);
  };

  for (const event of events) {
    const weight = eventWeight(event);

    switch (event.t) {
      case "mood_selected":
        addWeight(raw.moods, event.v, weight);
        break;
      case "goal_selected":
        addWeight(raw.goals, event.v, weight);
        break;
      case "category_browsed":
        addWeight(raw.categories, event.v, weight);
        break;
      case "quiz_answer": {
        const target = {
          mood: raw.moods, goal: raw.goals, duration: raw.durations,
          energy: raw.energies, categories: raw.categories,
        }[event.k];
        if (target) addWeight(target, event.v, weight);
        break;
      }
      case "suggestion_opened":
      case "suggestion_saved": {
        const item = getItemById(event.id);
        if (item) {
          absorbItem(item, weight);
          seenItemIds.add(item.id);
          if (event.t === "suggestion_saved") savedItemsFromEvents.add(item.id);
        }
        break;
      }
      case "show_watched":
      case "show_saved":
      case "show_opened": {
        const show = getShowById(event.id);
        if (show) {
          absorbShow(show, weight);
          seenShowIds.add(show.id);
          if (event.t === "show_watched") watchedFromEvents.add(show.id);
          if (event.t === "show_saved") savedShowsFromEvents.add(show.id);
        }
        break;
      }
    }
  }

  // Hafıza kırpılmış olabilir; kalıcı listeler her hâlükârda sayılsın.
  getWatchedIds().forEach((id) => {
    seenShowIds.add(id);
    if (watchedFromEvents.has(id)) return;
    const show = getShowById(id);
    if (show) absorbShow(show, 4);
  });
  getSavedShowIds().forEach((id) => {
    seenShowIds.add(id);
    if (savedShowsFromEvents.has(id)) return;
    const show = getShowById(id);
    if (show) absorbShow(show, 2.5);
  });
  getSavedIds().forEach((id) => {
    seenItemIds.add(id);
    if (savedItemsFromEvents.has(id)) return;
    const item = getItemById(id);
    if (item) absorbItem(item, 3);
  });

  const signalStrength =
    Object.values(raw.moods).reduce((a, b) => a + b, 0) +
    Object.values(raw.goals).reduce((a, b) => a + b, 0) +
    Object.values(raw.showGenres).reduce((a, b) => a + b, 0);

  return {
    eventCount: events.length,
    signalStrength,
    hasSignal: signalStrength > 0,
    moods: normalize(raw.moods),
    goals: normalize(raw.goals),
    categories: normalize(raw.categories),
    durations: normalize(raw.durations),
    energies: normalize(raw.energies),
    showGenres: normalize(raw.showGenres),
    showMoods: normalize(raw.showMoods),
    eras: normalize(raw.eras),
    origins: normalize(raw.origins),
    types: normalize(raw.types),
    intensities: normalize(raw.intensities),
    seenItemIds,
    seenShowIds,
  };
}

/** Hafızanın ne öğrendiğini tek cümlede özetler. */
export function memorySummary(profile = buildTasteProfile()) {
  if (!profile.hasSignal) return null;

  const parts = [];
  const goal = topKey(profile.goals);
  const mood = topKey(profile.moods);
  const category = topKey(profile.categories);
  const genre = topKey(profile.showGenres);
  const era = topKey(profile.eras);

  if (goal) parts.push(`hedefin genelde “${labelOf(GOALS, goal).toLocaleLowerCase("tr")}”`);
  else if (mood) parts.push(`sık sık “${labelOf(MOODS, mood).toLocaleLowerCase("tr")}” hissediyorsun`);
  if (category) parts.push(`${labelOf(CATEGORIES, category).toLocaleLowerCase("tr")} ilgini çekiyor`);
  if (genre) parts.push(`izlediklerinde ${labelOf(SHOW_GENRES, genre).toLocaleLowerCase("tr")} öne çıkıyor`);
  else if (era) parts.push(`${labelOf(SHOW_ERAS, era)} yapımlarına yöneliyorsun`);

  if (parts.length === 0) return null;
  return `Hafızam şunu görüyor: ${parts.join(", ")}.`;
}

// --- Puanlama ------------------------------------------------------------

function scoreItem(item, profile) {
  let score = 0;
  item.goals.forEach((g) => { score += (profile.goals[g] ?? 0) * 3; });
  item.moods.forEach((m) => { score += (profile.moods[m] ?? 0) * 2; });
  score += (profile.categories[item.category] ?? 0) * 2;
  score += (profile.durations[item.duration] ?? 0);
  score += (profile.energies[item.energy] ?? 0);
  if (profile.seenItemIds.has(item.id)) score -= 2.5; // görülmüşü tekrar öne çıkarma
  return score;
}

function scoreShow(show, profile) {
  let score = 0;
  show.genres.forEach((g) => { score += (profile.showGenres[g] ?? 0) * 2; });
  show.moods.forEach((m) => { score += (profile.showMoods[m] ?? 0) * 1.5; });
  if (show.startYear != null) score += (profile.eras[eraOf(show.startYear)] ?? 0) * 1.5;
  score += (profile.origins[show.origin] ?? 0);
  score += (profile.types[show.type] ?? 0) * 0.5;
  score += (profile.intensities[show.intensity] ?? 0) * 0.5;
  return score;
}

function reasonForItem(item, profile) {
  const goal = item.goals.find((g) => (profile.goals[g] ?? 0) > 0.4);
  if (goal) return `“${labelOf(GOALS, goal)}” hedefini sık seçiyorsun`;

  const mood = item.moods.find((m) => (profile.moods[m] ?? 0) > 0.4);
  if (mood) return `“${labelOf(MOODS, mood)}” hâlini sık işaretliyorsun`;

  if ((profile.categories[item.category] ?? 0) > 0.3) {
    return `${labelOf(CATEGORIES, item.category)} alanına ilgin var`;
  }
  return "Geçmiş seçimlerine yakın";
}

function reasonForShow(show, profile) {
  const genre = show.genres.find((g) => (profile.showGenres[g] ?? 0) > 0.4);
  if (genre) return `İzlediklerinde ${labelOf(SHOW_GENRES, genre).toLocaleLowerCase("tr")} öne çıkıyor`;

  if (show.startYear != null && (profile.eras[eraOf(show.startYear)] ?? 0) > 0.5) {
    return `${labelOf(SHOW_ERAS, eraOf(show.startYear))} yapımlarını seviyorsun`;
  }

  const mood = show.moods.find((m) => (profile.showMoods[m] ?? 0) > 0.4);
  if (mood) return `“${labelOf(SHOW_MOODS, mood)}” yapımlara yöneliyorsun`;

  if ((profile.origins[show.origin] ?? 0) > 0.6) {
    return `${labelOf(SHOW_ORIGINS, show.origin)} tercih ediyorsun`;
  }
  return "İzleme geçmişine yakın";
}

/** Hafıza boşken gösterilecek yumuşak başlangıç seti. */
function starterPicks(limit, exclude) {
  const items = ITEMS
    .filter((i) => i.duration === "kisa" && !exclude.has(i.id))
    .slice(0, Math.ceil(limit / 2))
    .map((item) => ({ kind: "item", data: item, reason: "Başlamak için hafif bir seçim" }));

  const shows = allShows()
    .filter((s) => s.intensity === "hafif" && !exclude.has(s.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(limit / 2))
    .map((show) => ({ kind: "show", data: show, reason: "Rahat başlangıç için" }));

  return [...items, ...shows];
}

/**
 * Hafızaya göre karma öneri listesi üretir (video önerileri + dizi/film).
 * @param {{ limit?: number, exclude?: Set<string> }} [options]
 * @returns {{ picks: Array<{kind: "item"|"show", data: object, reason: string}>,
 *             profile: object, isStarter: boolean }}
 */
export function personalizedPicks(options = {}) {
  const limit = options.limit ?? 6;
  const exclude = options.exclude ?? new Set();
  const profile = buildTasteProfile();

  if (!profile.hasSignal) {
    return { picks: starterPicks(limit, exclude), profile, isStarter: true };
  }

  const watched = new Set(getWatchedIds());

  const scoredItems = ITEMS
    .filter((item) => !exclude.has(item.id))
    .map((item) => ({
      kind: "item",
      data: item,
      value: scoreItem(item, profile) + Math.random() * 0.35,
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const scoredShows = allShows()
    .filter((show) => !exclude.has(show.id) && !watched.has(show.id))
    .map((show) => ({
      kind: "show",
      data: show,
      value: scoreShow(show, profile) + Math.random() * 0.35,
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // Yarı yarıya karıştır; bir taraf zayıfsa diğeri boşluğu doldurur.
  const half = Math.ceil(limit / 2);
  const chosen = [
    ...scoredItems.slice(0, half),
    ...scoredShows.slice(0, limit - Math.min(half, scoredItems.length)),
  ].slice(0, limit);

  const picks = chosen.map((entry) =>
    entry.kind === "item"
      ? { kind: "item", data: entry.data, reason: reasonForItem(entry.data, profile) }
      : { kind: "show", data: entry.data, reason: reasonForShow(entry.data, profile) }
  );

  return {
    picks: picks.length > 0 ? picks : starterPicks(limit, exclude),
    profile,
    isStarter: picks.length === 0,
  };
}
