// Kısa test akışı: 5 soru, tek tek gösterilir, cevaplar tek bir profile dönüştürülür.

import { MOODS, GOALS, DURATIONS, ENERGY_LEVELS, CATEGORIES } from "./data.js";

export const QUIZ_QUESTIONS = [
  {
    id: "mood",
    question: "Şu an nasıl hissediyorsun?",
    field: "moods",
    multi: false,
    options: MOODS,
  },
  {
    id: "goal",
    question: "Bu izlemeden ne umuyorsun?",
    field: "goals",
    multi: false,
    options: GOALS,
  },
  {
    id: "duration",
    question: "Ne kadar vaktin var?",
    field: "duration",
    multi: false,
    single: true,
    options: DURATIONS,
  },
  {
    id: "energy",
    question: "Enerji seviyen nasıl?",
    field: "energy",
    multi: false,
    single: true,
    options: ENERGY_LEVELS,
  },
  {
    id: "categories",
    question: "Hangi alan seni şu sıralar çekiyor? (birden fazla seçebilirsin)",
    field: "categories",
    multi: true,
    options: CATEGORIES,
  },
];

/**
 * Quiz cevaplarını recommend.js'in beklediği profile nesnesine çevirir.
 * @param {Record<string, string|string[]>} answers - { mood: "kaygili", goal: "sakinlesmek",
 *   duration: "kisa", energy: "orta", categories: ["sakinlesme", "ogrenme"] }
 */
export function answersToProfile(answers) {
  return {
    moods: answers.mood ? [answers.mood] : [],
    goals: answers.goal ? [answers.goal] : [],
    duration: answers.duration ?? null,
    energy: answers.energy ?? null,
    categories: answers.categories ?? [],
  };
}

/** Profilden okunabilir bir özet cümlesi üretir. */
export function summarizeProfile(answers) {
  const mood = MOODS.find((m) => m.id === answers.mood);
  const goal = GOALS.find((g) => g.id === answers.goal);
  const duration = DURATIONS.find((d) => d.id === answers.duration);

  const parts = [];
  if (mood) parts.push(mood.label.toLowerCase());
  if (goal) parts.push(`${goal.label.toLowerCase()} istiyorsun`);
  if (duration) parts.push(duration.label.toLowerCase());

  if (parts.length === 0) return "Profilin hazır.";
  return `Şu an ${parts.join(", ")}. Sana göre seçtiklerimiz:`;
}
