// YouTube arama önerileri (otomatik tamamlama) — API anahtarı gerektirmez.
//
// Google'ın herkese açık "suggest" ucu CORS başlığı göndermediği için fetch ile
// çağrılamaz; bunun yerine JSONP kullanılır: bir <script> etiketi eklenir, uç nokta
// yanıtı bizim tanımladığımız fonksiyonu çağırarak döner.
//
// Bu uç nokta resmî olarak belgelenmiş değildir; erişilemezse (ağ engeli, biçim
// değişikliği, zaman aşımı) boş liste döner ve form önerisiz de sorunsuz çalışır.

const ENDPOINT = "https://suggestqueries.google.com/complete/search";
const MIN_LENGTH = 2;

let counter = 0;
/** JSONP yanıtını bekleyen en son çağrının çözücüsü (google.ac.h şimi için). */
let pendingResolver = null;

/** client=youtube bazen sabit `google.ac.h` fonksiyonunu çağırır; onu da karşılıyoruz. */
function installLegacyShim() {
  if (typeof window === "undefined") return;
  window.google = window.google || {};
  window.google.ac = window.google.ac || {};
  if (!window.google.ac.h) {
    window.google.ac.h = (data) => {
      if (pendingResolver) pendingResolver(data);
    };
  }
}

function parseSuggestions(data) {
  // Beklenen biçim: ["sorgu", [["öneri", 0], ["diğer", 0]], ...]
  const raw = Array.isArray(data) ? data[1] : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .filter((text) => typeof text === "string" && text.trim().length > 0);
}

/**
 * Verilen metin için YouTube arama önerilerini getirir.
 * Hata veya zaman aşımı durumunda boş dizi döner — asla reject etmez.
 *
 * @param {string} query
 * @param {{ lang?: string, limit?: number, timeoutMs?: number }} [options]
 * @returns {Promise<string[]>}
 */
export function fetchSuggestions(query, options = {}) {
  const { lang = "tr", limit = 8, timeoutMs = 3500 } = options;
  const text = (query ?? "").trim();

  if (text.length < MIN_LENGTH) return Promise.resolve([]);
  if (typeof document === "undefined") return Promise.resolve([]);

  installLegacyShim();

  return new Promise((resolve) => {
    const callbackName = `__ylSuggest_${Date.now()}_${++counter}`;
    const script = document.createElement("script");
    let settled = false;

    const finish = (suggestions) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingResolver === handleData) pendingResolver = null;
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
      script.remove();
      resolve(suggestions.slice(0, limit));
    };

    function handleData(data) {
      finish(parseSuggestions(data));
    }

    const timer = setTimeout(() => finish([]), timeoutMs);

    window[callbackName] = handleData;
    pendingResolver = handleData;

    script.onerror = () => finish([]);

    const params = new URLSearchParams({
      client: "youtube",
      ds: "yt",
      hl: lang,
      q: text,
      jsonp: callbackName,
    });
    script.src = `${ENDPOINT}?${params.toString()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

/** Art arda tuş vuruşlarında tek çağrı yapmak için basit debounce. */
export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
