// Video kartı: küçük resim, süre, dil rozeti (+ çevrilmiş başlık), altyazı işareti, "▶ İzle".
// Onboarding turları ve "Sana Özel" önerileri aynı kartı kullanır; olaylar `surface` ile ayrılır.
//
//  - Masaüstü: üzerine gelince kısa gecikmeyle sessiz önizleme; üzerinde kalma süresi "hover" olayı.
//  - Dokunmatik / klavye: dokun ya da Enter önizlemeyi açar-kapatır.
//  - Aynı anda tek önizleme oynar (bütün yüzeylerde).

import { el } from "./dom.js";
import { track } from "./events.js";
import { startPreview, openWatchDialog } from "./player.js";

const HOVER_PREVIEW_DELAY_MS = 350;
const IMPRESSION_MIN_MS = 1000;
const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

let active = null; // { card, handle, resolved }

export function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} sa ${m % 60} dk` : `${m} dk`;
}

export function hasActivePreview() {
  return Boolean(active);
}

/** Önizlemeyi durdurur. Oynatıcı hazırsa senkron çalışır (sekme kapanırken çıkış anı kaybolmasın). */
export function stopPreview(reason) {
  const current = active;
  active = null;
  if (!current) return;
  current.card.classList.remove("is-previewing");
  if (current.resolved) current.resolved.stop(reason);
  else current.handle.then((h) => h?.stop(reason)).catch(() => {});
}

function playPreview(cardEl, card, meta) {
  if (active?.card === cardEl) return;
  stopPreview("switch");
  cardEl.classList.add("is-previewing");
  const handle = startPreview(cardEl.querySelector(".onb-thumb"), { videoId: card.videoId, start: card.previewStart, meta });
  const entry = { card: cardEl, handle, resolved: null };
  active = entry;
  handle.then((h) => {
    entry.resolved = h;
  });
  handle.catch(() => {
    cardEl.classList.remove("is-previewing");
    if (active?.card === cardEl) active = null;
  });
}

/**
 * @param {object} card sunucudan gelen kart (videoId, title, translatedTitle, lang, …)
 * @param {{surface:string, round?:number, position:number, extra?:Node[], onError?:Function}} options
 */
export function renderVideoCard(card, { surface, round = null, position, extra = [], onError }) {
  const meta = { surface, round, position };
  const tracked = { videoId: card.videoId, ...meta };
  const title = card.translatedTitle ?? card.title;
  const thumb = el("div", { class: "onb-thumb" }, [
    el("img", { src: card.thumbnail, alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "onb-duration", text: formatDuration(card.durationSeconds) }),
    card.lang !== "tr"
      ? el("span", { class: "lang-badge onb-lang", title: card.langName, text: `🌐 ${card.lang === "zxx" ? "♪" : card.lang.toUpperCase()}` })
      : null,
    card.hasCaptions ? el("span", { class: "onb-cc", title: "Altyazı var", text: "CC" }) : null,
  ]);
  const watchBtn = el("button", {
    class: "btn btn-secondary btn-small onb-watch",
    type: "button",
    text: "▶ İzle",
    onclick: (event) => {
      event.stopPropagation();
      track("click", { ...tracked, target: "watch" });
      stopPreview("watch");
      openWatchDialog({ videoId: card.videoId, title, meta }).catch((err) => onError?.(err.message));
    },
  });
  const article = el("article", {
    class: "onb-card",
    tabindex: "0",
    "data-video-id": card.videoId,
    "data-position": String(position),
    "aria-label": title,
  }, [
    thumb,
    el("div", { class: "onb-body" }, [
      ...extra,
      el("h4", { class: "onb-title", text: title }),
      card.translatedTitle ? el("p", { class: "onb-original muted", lang: card.lang, text: card.title }) : null,
      el("p", { class: "onb-channel muted", text: card.channel }),
      watchBtn,
    ]),
  ]);

  let hoverStart = 0;
  let hoverTimer = null;
  article.addEventListener("mouseenter", () => {
    if (!finePointer()) return;
    hoverStart = performance.now();
    hoverTimer = setTimeout(() => playPreview(article, card, meta), HOVER_PREVIEW_DELAY_MS);
  });
  article.addEventListener("mouseleave", () => {
    if (!finePointer()) return;
    clearTimeout(hoverTimer);
    const ms = Math.round(performance.now() - hoverStart);
    if (ms > 150) track("hover", { ...tracked, ms });
    if (active?.card === article) stopPreview("leave");
  });
  const toggle = () => {
    if (active?.card === article) stopPreview("tap");
    else {
      track("click", { ...tracked, target: "preview" });
      playPreview(article, card, meta);
    }
  };
  thumb.addEventListener("click", () => {
    if (!finePointer()) toggle();
    else track("click", { ...tracked, target: "thumb" });
  });
  article.addEventListener("keydown", (event) => {
    if (event.target === article && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggle();
    }
  });
  return article;
}

/** Kart en az yarısı 1 sn görünür kaldıysa "impression". @returns {IntersectionObserver} */
export function observeImpressions(grid, { surface, round = null }) {
  const timers = new Map();
  const seen = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.videoId;
      if (seen.has(id)) continue;
      if (entry.isIntersecting) {
        timers.set(id, setTimeout(() => {
          seen.add(id);
          track("impression", { videoId: id, surface, round, position: Number(entry.target.dataset.position) });
        }, IMPRESSION_MIN_MS));
      } else {
        clearTimeout(timers.get(id));
      }
    }
  }, { threshold: 0.5 });
  grid.querySelectorAll(".onb-card").forEach((c) => observer.observe(c));
  return observer;
}

if (typeof document !== "undefined") {
  // capture: olay kuyruğunun çıkış gönderiminden (events.js) ÖNCE çalışsın
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && active) stopPreview("hidden");
  }, { capture: true });
  // Menüden başka bölüme geçince önizleme dursun
  document.addEventListener("click", (event) => {
    if (active && event.target.closest?.(".menu-item")) stopPreview("navigate");
  });
}
