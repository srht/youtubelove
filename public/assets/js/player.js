// YouTube IFrame Player API sarmalayıcısı: sessiz önizleme ve izleme penceresi.
// Oynatma olayları (onStateChange), 5 sn heartbeat, ileri/geri sarma ve çıkış anı track()'e gider.

import { el } from "./dom.js";
import { track } from "./events.js";

export const PREVIEW_SECONDS = 25;
const HEARTBEAT_MS = 5000;
const SEEK_TOLERANCE = 3; // sn — heartbeat arası beklenenden fazla sıçrama = seek

let apiPromise = null;

/** IFrame API'yi bir kez yükler. */
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error("YouTube oynatıcısı yüklenemedi."));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

const STATE_NAMES = { 0: "ended", 1: "play", 2: "pause", 3: "buffering", 5: "cued", "-1": "unstarted" };

/**
 * Oynatıcıyı olay takibine bağlar. Döndürdüğü `stop(reason)` çıkışı kaydeder ve zamanlayıcıları temizler.
 * @param {object} player YT.Player
 * @param {object} meta { videoId, surface, round, position, mode: "preview"|"watch" }
 */
function attachTracking(player, meta) {
  let heartbeat = null;
  let lastTime = null;
  let lastTick = null;
  let watched = 0; // gerçekten oynatılan saniye
  let stopped = false;

  const now = () => (typeof player.getCurrentTime === "function" ? player.getCurrentTime() : 0);
  const duration = () => (typeof player.getDuration === "function" ? player.getDuration() : 0);
  const base = () => ({ ...meta, t: Math.round(now() * 10) / 10, duration: Math.round(duration()) });

  const tick = () => {
    const t = now();
    const wall = Date.now();
    if (lastTime != null) {
      const expected = lastTime + (wall - lastTick) / 1000;
      if (Math.abs(t - expected) > SEEK_TOLERANCE) {
        track("seek", { ...base(), from: Math.round(lastTime), to: Math.round(t) });
      } else {
        watched += Math.max(0, t - lastTime);
      }
    }
    lastTime = t;
    lastTick = wall;
  };

  const startHeartbeat = () => {
    if (heartbeat) return;
    lastTime = now();
    lastTick = Date.now();
    heartbeat = setInterval(() => {
      tick();
      track("heartbeat", { ...base(), watched: Math.round(watched) });
    }, HEARTBEAT_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeat) tick();
    clearInterval(heartbeat);
    heartbeat = null;
  };

  const onStateChange = (event) => {
    const name = STATE_NAMES[event.data];
    if (name === "play") {
      track("play", base());
      startHeartbeat();
    } else if (name === "pause") {
      stopHeartbeat();
      track("pause", { ...base(), watched: Math.round(watched) });
    } else if (name === "ended") {
      stopHeartbeat();
      track("ended", { ...base(), watched: Math.round(watched) });
    }
  };

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    stopHeartbeat();
    track(meta.mode === "preview" ? "preview_end" : "exit", { ...base(), watched: Math.round(watched), reason });
  };

  return { onStateChange, stop };
}

/**
 * Kartın içinde sessiz önizleme başlatır. `start` saniyesinden, PREVIEW_SECONDS boyunca.
 * @returns {Promise<{stop: Function}>}
 */
export async function startPreview(container, { videoId, start = 0, meta }) {
  const YT = await loadYouTubeApi();
  const host = el("div", { class: "preview-host" });
  container.appendChild(host);
  let tracking = null;
  let timer = null;
  let player = null;

  const stop = (reason = "leave") => {
    clearTimeout(timer);
    tracking?.stop(reason);
    try {
      player?.destroy();
    } catch {
      /* zaten kaldırılmış */
    }
    container.querySelector(".preview-host, iframe")?.remove();
  };

  player = new YT.Player(host, {
    videoId,
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1, mute: 1, start, end: start + PREVIEW_SECONDS, controls: 0, disablekb: 1,
      playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3,
    },
    events: {
      onReady: (e) => {
        e.target.mute();
        e.target.playVideo();
      },
      onStateChange: (e) => tracking?.onStateChange(e),
    },
  });
  tracking = attachTracking(player, { ...meta, videoId, mode: "preview" });
  track("preview_start", { ...meta, videoId, t: start });
  timer = setTimeout(() => stop("timeout"), (PREVIEW_SECONDS + 2) * 1000);
  return { stop };
}

/**
 * İzleme penceresi: sesli, kontrollü tam oynatıcı. Kapatınca "exit" olayı gider.
 */
export async function openWatchDialog({ videoId, title, meta, onClose }) {
  const YT = await loadYouTubeApi();
  const host = el("div", { class: "watch-host" });
  const closeBtn = el("button", { class: "btn btn-secondary btn-small watch-close", type: "button", text: "✕ Kapat" });
  const dialog = el("dialog", { class: "watch-dialog", "aria-label": title }, [
    el("div", { class: "watch-head" }, [el("p", { class: "watch-title", text: title }), closeBtn]),
    el("div", { class: "watch-frame" }, [host]),
  ]);
  document.body.appendChild(dialog);

  let tracking = null;
  const player = new YT.Player(host, {
    videoId,
    width: "100%",
    height: "100%",
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
    events: { onStateChange: (e) => tracking?.onStateChange(e) },
  });
  tracking = attachTracking(player, { ...meta, videoId, mode: "watch" });

  const close = (reason) => {
    tracking.stop(reason);
    try {
      player.destroy();
    } catch {
      /* yok say */
    }
    if (dialog.open) dialog.close();
    dialog.remove();
    document.removeEventListener("visibilitychange", onHidden);
    onClose?.();
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") close("hidden");
  };
  closeBtn.addEventListener("click", () => close("close"));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close("escape");
  });
  document.addEventListener("visibilitychange", onHidden);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  closeBtn.focus();
  return { close };
}
