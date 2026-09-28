// Olay takibi — arayüz bileşenleri track() ile olay bırakır; kuyruk /api/events'e toplu gider.
//
//  - 10 sn'de bir ya da kuyruk 20 olaya ulaşınca gönderilir.
//  - Sayfa gizlenince / kapanınca kalanlar navigator.sendBeacon ile gönderilir (çıkış anı kaybolmasın).
//  - Her olay oturum içi sıra no taşır; sunucu tekrar gönderimde çift kaydetmez.
//  - Kullanıcı takibi kapattıysa hiçbir şey kaydedilmez ve gönderilmez.

const ENDPOINT = "/api/events";
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_SIZE = 20;
const MAX_BATCH = 200;
const MAX_QUEUE = 1000;

const queue = [];
let enabled = true;
let seq = 0;
let timer = null;
let inFlight = null;
const sessionId =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function setTrackingEnabled(value) {
  enabled = Boolean(value);
  if (!enabled) queue.length = 0;
}

/**
 * @param {string} type impression | click | hover | preview_start | preview_end | play | pause |
 *                      heartbeat | seek | ended | exit
 * @param {object} data { videoId, surface, round, position, t, duration, watched, mode, ... }
 */
export function track(type, data = {}) {
  if (!enabled) return;
  const event = { type, at: Date.now(), seq: ++seq, ...data };
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  document.dispatchEvent(new CustomEvent("yl:track", { detail: event }));
  if (queue.length >= FLUSH_SIZE) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/** Kuyruğu gönderir. Başarısız olursa olaylar kuyruğun başına geri konur. */
export async function flush() {
  clearTimeout(timer);
  timer = null;
  if (inFlight || !queue.length || !enabled) return inFlight;
  const batch = queue.splice(0, MAX_BATCH);
  inFlight = fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({ sessionId, events: batch }),
  })
    .then((r) => {
      if (!r.ok && r.status >= 500) throw new Error(String(r.status));
    })
    .catch(() => {
      queue.unshift(...batch); // ağ/sunucu hatası: sonra yeniden dene
    })
    .finally(() => {
      inFlight = null;
      if (queue.length && !timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS);
    });
  return inFlight;
}

/** Sayfa kapanırken: fetch iptal olabileceği için sendBeacon. */
function flushOnExit() {
  if (!enabled || !queue.length) return;
  const batch = queue.splice(0, MAX_BATCH);
  const payload = new Blob([JSON.stringify({ sessionId, events: batch })], { type: "application/json" });
  if (!navigator.sendBeacon?.(ENDPOINT, payload)) queue.unshift(...batch);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });
  window.addEventListener("pagehide", flushOnExit);
}

/** Test ve hata ayıklama için. */
export function pendingEvents() {
  return [...queue];
}
export function currentSessionId() {
  return sessionId;
}
