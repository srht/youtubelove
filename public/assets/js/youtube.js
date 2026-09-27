// YouTube arama URL'i üretimi. API kullanılmaz; kullanıcı doğrudan YouTube arama
// sonuçlarına yönlendirilir.
//
// YouTube'un "sp" arama parametresi, base64'lenmiş küçük bir protobuf'tur:
//   alan 1 (varint)          = sıralama  (0 ilgili, 1 puan, 2 tarih, 3 izlenme)
//   alan 2 { alan 3 varint } = süre filtresi (1 kısa, 2 uzun, 3 orta)
// Aşağıdaki kodlayıcı bu yapıyı üretir; böylece sıralama ve süre birlikte
// kullanılabilir (elle hazırlanmış token tablosu tutmaya gerek kalmaz).
//
// Bu parametre YouTube tarafından resmî olarak belgelenmemiştir. Değişirse
// USE_SEARCH_FILTERS=false yapılarak tek yerden kapatılabilir; arama yine çalışır,
// yalnızca sıralama/süre tercihi uygulanmaz.
const USE_SEARCH_FILTERS = true;

/** Sıralama seçenekleri — arayüzde de bu liste kullanılır. */
export const SORT_ORDERS = [
  { id: "views", label: "En çok izlenen", emoji: "🔥", value: 3 },
  { id: "relevance", label: "İlgili", emoji: "🎯", value: 0 },
  { id: "date", label: "En yeni", emoji: "🆕", value: 2 },
];

export const DEFAULT_SORT = "views";

const DURATION_VALUES = { kisa: 1, uzun: 2, orta: 3 };

function base64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Sıralama ve süreyi tek bir "sp" değerine kodlar.
 * @returns {string|null} URL'e eklenmeye hazır (kodlanmış) değer, ya da gerek yoksa null
 */
export function buildSearchFilter({ sort, duration } = {}) {
  if (!USE_SEARCH_FILTERS) return null;

  const bytes = [];

  const sortOrder = SORT_ORDERS.find((s) => s.id === sort);
  // "İlgili" zaten YouTube'un varsayılanı; boşuna parametre eklemeyelim.
  if (sortOrder && sortOrder.value !== 0) bytes.push(0x08, sortOrder.value);

  const durationValue = DURATION_VALUES[duration];
  if (durationValue) bytes.push(0x12, 0x02, 0x18, durationValue);

  if (bytes.length === 0) return null;
  return encodeURIComponent(base64(bytes));
}

/**
 * @param {string} query - Arama metni (Türkçe veya İngilizce)
 * @param {{ duration?: string, sort?: string }} [options]
 * @returns {string} tam YouTube arama URL'i
 */
export function buildSearchUrl(query, options = {}) {
  const params = new URLSearchParams({ search_query: query });
  let url = `https://www.youtube.com/results?${params.toString()}`;

  const filter = buildSearchFilter({
    sort: options.sort ?? DEFAULT_SORT,
    duration: options.duration,
  });
  if (filter) url += `&sp=${filter}`;

  return url;
}

/**
 * Bir öneri kaydı için, kullanıcının dil tercihine göre arama URL'i üretir.
 * @param {object} item - data.js içindeki öneri kaydı
 * @param {{ duration?: string, sort?: string, useEnglish?: boolean }} [options]
 */
export function buildSearchUrlForItem(item, options = {}) {
  const query = options.useEnglish && item.queryEn ? item.queryEn : item.queryTr;
  return buildSearchUrl(query, { duration: options.duration, sort: options.sort });
}
