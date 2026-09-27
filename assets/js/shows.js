// Dizi & Film bölümündeki filtre seçenekleri (dönem, tür, ruh hali, yapım, biçim, yoğunluk).
// Burada dizi/film İÇERİĞİ yoktur; öneriler yapay zekâdan gelir.

export const SHOW_TYPES = [
  { id: "dizi", label: "Dizi", emoji: "📺" },
  { id: "film", label: "Film", emoji: "🎬" },
];

export const SHOW_ORIGINS = [
  { id: "turk", label: "Türk yapımı", emoji: "🇹🇷" },
  { id: "yabanci", label: "Yabancı yapım", emoji: "🌍" },
];

export const SHOW_ERAS = [
  { id: "60-70", label: "60'lar – 70'ler", emoji: "📻" },
  { id: "80", label: "80'ler", emoji: "📼" },
  { id: "90", label: "90'lar", emoji: "💿" },
  { id: "2000", label: "2000'ler", emoji: "💾" },
];

export const SHOW_GENRES = [
  { id: "komedi", label: "Komedi", emoji: "😄" },
  { id: "dram", label: "Dram", emoji: "🎭" },
  { id: "aile", label: "Aile", emoji: "🏠" },
  { id: "polisiye", label: "Polisiye", emoji: "🚔" },
  { id: "gizem", label: "Gizem", emoji: "🔍" },
  { id: "bilimkurgu", label: "Bilimkurgu", emoji: "🚀" },
  { id: "macera", label: "Macera", emoji: "🗺️" },
  { id: "romantik", label: "Romantik", emoji: "💞" },
  { id: "tarih", label: "Tarih / Dönem", emoji: "🏛️" },
  { id: "politik", label: "Politik / Hiciv", emoji: "🗳️" },
];

export const SHOW_MOODS = [
  { id: "nostaljik", label: "Nostaljik", emoji: "📼" },
  { id: "huzurlu", label: "Huzur veren", emoji: "🍵" },
  { id: "guldurur", label: "Güldüren", emoji: "😂" },
  { id: "dusundurur", label: "Düşündüren", emoji: "🧠" },
  { id: "heyecanli", label: "Heyecanlı", emoji: "⚡" },
  { id: "ilham", label: "İlham veren", emoji: "✨" },
  { id: "melankolik", label: "Melankolik", emoji: "🌧️" },
];

export const SHOW_INTENSITIES = [
  { id: "hafif", label: "Hafif — rahatlatır", emoji: "🌤️" },
  { id: "orta", label: "Orta — dengeli", emoji: "⛅" },
  { id: "agir", label: "Ağır — yorabilir", emoji: "🌑" },
];

/** Başlangıç yılından dönem kimliği türetir. */
export function eraOf(startYear) {
  if (startYear < 1980) return "60-70";
  if (startYear < 1990) return "80";
  if (startYear < 2000) return "90";
  return "2000";
}
