// YouTube arama URL'i üretimi. API kullanılmaz; kullanıcı doğrudan YouTube arama
// sonuçlarına yönlendirilir.

// YouTube'un "sp" arama parametresi ile süre filtresi. Bu değerler YouTube tarafında
// değişirse USE_DURATION_FILTER=false yapılarak tek yerden kapatılabilir.
const USE_DURATION_FILTER = true;

const DURATION_FILTER_TOKENS = {
  kisa: "EgIYAQ%3D%3D", // Kısa (< 4 dk)
  orta: "EgIYAw%3D%3D", // Orta (4-20 dk)
  uzun: "EgIYAg%3D%3D", // Uzun (> 20 dk)
};

/**
 * @param {string} query - Arama metni (Türkçe veya İngilizce)
 * @param {{ duration?: string }} [options]
 * @returns {string} tam YouTube arama URL'i
 */
export function buildSearchUrl(query, options = {}) {
  const params = new URLSearchParams({ search_query: query });
  let url = `https://www.youtube.com/results?${params.toString()}`;

  if (USE_DURATION_FILTER && options.duration && DURATION_FILTER_TOKENS[options.duration]) {
    url += `&sp=${DURATION_FILTER_TOKENS[options.duration]}`;
  }

  return url;
}

/**
 * Bir öneri kaydı için, kullanıcının dil tercihine göre arama URL'i üretir.
 * @param {object} item - data.js içindeki öneri kaydı
 * @param {{ duration?: string, useEnglish?: boolean }} [options]
 */
export function buildSearchUrlForItem(item, options = {}) {
  const query = options.useEnglish && item.queryEn ? item.queryEn : item.queryTr;
  return buildSearchUrl(query, { duration: options.duration });
}
