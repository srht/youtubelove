// Olay takibi — arayüz bileşenleri track() ile olay bırakır.
// Aşama 4: olaylar bellekte kuyruğa alınır ve "yl:track" olayıyla yayınlanır.
// Aşama 5: kuyruk /api/events'e toplu gönderilir.

const queue = [];
let enabled = true;
let seq = 0;

export function setTrackingEnabled(value) {
  enabled = Boolean(value);
  if (!enabled) queue.length = 0;
}

/**
 * @param {string} type impression | click | hover | preview_start | preview_end | play | pause |
 *                      heartbeat | seek | ended | exit
 * @param {object} data { videoId, surface, round, position, t, duration, ... }
 */
export function track(type, data = {}) {
  if (!enabled) return;
  const event = { type, at: Date.now(), seq: ++seq, ...data };
  queue.push(event);
  document.dispatchEvent(new CustomEvent("yl:track", { detail: event }));
}

/** Test ve hata ayıklama için kuyruğun kopyası. */
export function pendingEvents() {
  return [...queue];
}

export function drain() {
  return queue.splice(0, queue.length);
}
