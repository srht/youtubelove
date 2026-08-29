// Kullanıcı hafızası: sitede yapılan seçimlerin ham kaydı.
//
// Burada yalnızca "ne oldu" tutulur; bu kayıtlardan zevk profili çıkarma işi
// personalize.js'e aittir. Böylece hafıza, katalog verisinden bağımsız kalır.
//
// Her şey yalnızca tarayıcıda (localStorage) durur, hiçbir yere gönderilmez.

const KEY = "yl_memory_v1";
const MAX_EVENTS = 300;

/** Yarılanma süresi: 30 gün önceki bir hareket, bugünkünün yarısı kadar sayılır. */
const HALF_LIFE_DAYS = 30;

/** Hareket türlerinin ham ağırlıkları — niyeti ne kadar güçlü gösterdiğine göre. */
export const EVENT_WEIGHTS = {
  show_watched: 4,        // "izledim" demek en güçlü sinyal
  suggestion_saved: 3,
  show_saved: 2.5,
  suggestion_opened: 2,
  show_opened: 2,
  quiz_answer: 1.5,
  mood_selected: 1,
  goal_selected: 1,
  category_browsed: 0.5,
};

const memoryFallback = new Map();

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

function write(events) {
  const payload = JSON.stringify(events);
  try {
    window.localStorage.setItem(KEY, payload);
  } catch {
    memoryFallback.set(KEY, payload);
  }
}

/**
 * Bir hareketi hafızaya yazar.
 * @param {string} type - EVENT_WEIGHTS içindeki bir tür
 * @param {{ id?: string, key?: string, value?: string }} [payload]
 */
export function recordEvent(type, payload = {}) {
  if (!EVENT_WEIGHTS[type]) return;

  const event = { t: type, at: new Date().toISOString() };
  if (payload.id) event.id = payload.id;
  if (payload.key) event.k = payload.key;
  if (payload.value) event.v = payload.value;

  const events = read();
  events.push(event);
  // En eskiler düşer; hafıza sınırsız büyümesin.
  write(events.slice(-MAX_EVENTS));
}

export function getEvents() {
  return read();
}

export function clearMemory() {
  write([]);
}

/** Bir hareketin yaşına göre ağırlık çarpanı (yeni olan daha çok sayar). */
export function recencyFactor(isoDate) {
  const ageMs = Date.now() - new Date(isoDate).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Bir hareketin nihai ağırlığı: tür ağırlığı × tazelik. */
export function eventWeight(event) {
  return (EVENT_WEIGHTS[event.t] ?? 1) * recencyFactor(event.at);
}
