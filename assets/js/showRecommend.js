// Dizi/film filtreleme ve "izlediklerine benzer" öneri motoru.

import { SHOWS, eraOf } from "./shows.js";

export function getShowById(id) {
  return SHOWS.find((s) => s.id === id) ?? null;
}

/**
 * Seçili filtrelere göre dizi/film listeler. Boş bırakılan filtre uygulanmaz.
 * @param {{type?: string, origin?: string, era?: string, genre?: string,
 *   mood?: string, intensity?: string}} filters
 */
export function filterShows(filters = {}) {
  return SHOWS.filter((show) => {
    if (filters.type && show.type !== filters.type) return false;
    if (filters.origin && show.origin !== filters.origin) return false;
    if (filters.era && eraOf(show.startYear) !== filters.era) return false;
    if (filters.genre && !show.genres.includes(filters.genre)) return false;
    if (filters.mood && !show.moods.includes(filters.mood)) return false;
    if (filters.intensity && show.intensity !== filters.intensity) return false;
    return true;
  }).sort((a, b) => a.startYear - b.startYear);
}

const SIMILARITY_WEIGHTS = {
  explicit: 5, // izlenen bir yapımın "similar" listesinde geçiyorsa
  genre: 2,
  mood: 1.5,
  era: 1.5,
  origin: 1,
  type: 0.5,
};

/**
 * İzlenenlere göre, henüz izlenmemiş yapımları puanlayıp önerir.
 * Her öneri, hangi izlenen yapım yüzünden önerildiğini de taşır.
 *
 * @param {string[]} watchedIds
 * @param {{limit?: number}} [options]
 * @returns {{show: object, reason: string, points: number}[]}
 */
export function similarToWatched(watchedIds, options = {}) {
  const limit = options.limit ?? 6;
  if (watchedIds.length === 0) return [];

  const watchedShows = watchedIds.map(getShowById).filter(Boolean);
  if (watchedShows.length === 0) return [];

  const scored = [];

  for (const candidate of SHOWS) {
    if (watchedIds.includes(candidate.id)) continue;

    let total = 0;
    let bestSource = null;
    let bestSourceScore = 0;

    for (const seen of watchedShows) {
      let pair = 0;

      if (seen.similar?.includes(candidate.id)) pair += SIMILARITY_WEIGHTS.explicit;
      if (candidate.similar?.includes(seen.id)) pair += SIMILARITY_WEIGHTS.explicit;

      const sharedGenres = candidate.genres.filter((g) => seen.genres.includes(g)).length;
      pair += sharedGenres * SIMILARITY_WEIGHTS.genre;

      const sharedMoods = candidate.moods.filter((m) => seen.moods.includes(m)).length;
      pair += sharedMoods * SIMILARITY_WEIGHTS.mood;

      if (eraOf(candidate.startYear) === eraOf(seen.startYear)) pair += SIMILARITY_WEIGHTS.era;
      if (candidate.origin === seen.origin) pair += SIMILARITY_WEIGHTS.origin;
      if (candidate.type === seen.type) pair += SIMILARITY_WEIGHTS.type;

      total += pair;
      if (pair > bestSourceScore) {
        bestSourceScore = pair;
        bestSource = seen;
      }
    }

    if (total > 0) {
      scored.push({
        show: candidate,
        points: total,
        reason: bestSource ? `${bestSource.title} izlediğin için` : "İzleme geçmişine göre",
      });
    }
  }

  scored.sort((a, b) => b.points - a.points);
  return scored.slice(0, limit);
}

/**
 * İzlenenlerin dağılımına dair kısa bir özet üretir (kütüphane sekmesi için).
 * @param {string[]} watchedIds
 */
export function watchedStats(watchedIds) {
  const shows = watchedIds.map(getShowById).filter(Boolean);
  if (shows.length === 0) return null;

  const genreCount = {};
  shows.forEach((s) => s.genres.forEach((g) => {
    genreCount[g] = (genreCount[g] ?? 0) + 1;
  }));

  const topGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const diziCount = shows.filter((s) => s.type === "dizi").length;
  const filmCount = shows.filter((s) => s.type === "film").length;

  return { total: shows.length, topGenre, diziCount, filmCount };
}
