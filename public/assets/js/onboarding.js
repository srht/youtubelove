// "Beni tanı" — onboarding.
// Adım 1: dil tercihi. Adım 2: 3-4 tur video ızgarası; seçim istemeden, önizleme ve izleme
// davranışından (örtük sinyaller) öğrenir. Kart seçimi sunucuda Thompson sampling ile yapılır.

import { el } from "./dom.js";
import { getProfile, saveLanguages, setTracking } from "./profileApi.js";
import { track, setTrackingEnabled } from "./events.js";
import { startPreview, openWatchDialog } from "./player.js";

const LEVEL_OPTIONS = [
  { id: "fluent", label: "Rahat anlıyorum" },
  { id: "subtitles", label: "Altyazıyla izleyebilirim" },
  { id: "none", label: "Anlamıyorum" },
];
const DISMISS_KEY = "yl_onboarding_dismissed";
const VISIBLE_BY_DEFAULT = 6; // ilk bakışta gösterilen dil sayısı; gerisi "Diğer diller"de

let switchTabRef = () => {};
const state = { levels: new Map(), profile: null };

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* gizli sekme vb. */
  }
}

function setStatus(text, kind = "") {
  const status = document.getElementById("onbStatus");
  status.textContent = text;
  status.className = kind ? `form-status form-status-${kind}` : "form-status";
}

function languageRow(language) {
  const current = state.levels.get(language.code) ?? "none";
  const name = `lvl-${language.code}`;
  return el("fieldset", { class: "lang-row", "data-lang": language.code }, [
    el("legend", { class: "lang-name" }, [
      el("span", { text: language.name }),
      language.native !== language.name ? el("span", { class: "muted lang-native", text: language.native }) : null,
    ]),
    el(
      "div",
      { class: "segmented", role: "radiogroup", "aria-label": `${language.name} seviyesi` },
      LEVEL_OPTIONS.map((option) => {
        const id = `${name}-${option.id}`;
        const input = el("input", { type: "radio", id, name, value: option.id });
        input.checked = option.id === current;
        input.addEventListener("change", () => {
          if (option.id === "none") state.levels.delete(language.code);
          else state.levels.set(language.code, option.id);
          setStatus("");
        });
        return el("label", { for: id, class: `seg seg-${option.id}` }, [input, el("span", { text: option.label })]);
      })
    ),
  ]);
}

function renderLanguageStep() {
  const profile = state.profile;
  const box = document.getElementById("onbLanguages");
  box.innerHTML = "";

  const chosen = profile.languagesSaved ? profile.languages : profile.suggestedLanguages;
  state.levels = new Map(chosen.map((l) => [l.lang, l.level]));

  // Seçili diller önce, sonra listenin geri kalanı
  const all = profile.supportedLanguages;
  const selected = all.filter((l) => state.levels.has(l.code));
  const rest = all.filter((l) => !state.levels.has(l.code));
  const firstRest = rest.slice(0, Math.max(0, VISIBLE_BY_DEFAULT - selected.length));
  const moreRest = rest.slice(firstRest.length);

  [...selected, ...firstRest].forEach((l) => box.appendChild(languageRow(l)));
  if (moreRest.length) {
    const details = el("details", { class: "lang-more" }, [
      el("summary", { text: `Diğer diller (${moreRest.length})` }),
    ]);
    moreRest.forEach((l) => details.appendChild(languageRow(l)));
    box.appendChild(details);
  }

  document.getElementById("onbLangHint").textContent = profile.languagesSaved
    ? "Kayıtlı tercihlerin. İstediğin zaman değiştirebilirsin."
    : "Tarayıcının dil ayarına göre doldurduk; kontrol edip düzelt.";
  document.getElementById("onbTracking").checked = profile.trackingEnabled;
}

async function submitLanguages(event) {
  event.preventDefault();
  const languages = [...state.levels.entries()].map(([lang, level]) => ({ lang, level }));
  const button = document.getElementById("onbSave");
  button.disabled = true;
  setStatus("Kaydediliyor…");
  try {
    state.profile = await saveLanguages(languages);
    const tracking = document.getElementById("onbTracking").checked;
    if (tracking !== state.profile.trackingEnabled) state.profile = await setTracking(tracking);
    setStatus("Kaydedildi ✅ Öneriler artık bu dillerde, o dilin kendi aramalarıyla gelecek.", "success");
    writeDismissed();
    setTrackingEnabled(state.profile.trackingEnabled);
    document.dispatchEvent(new CustomEvent("yl:onboarding-step", { detail: { step: "languages" } }));
    await nextRound();
  } catch (err) {
    setStatus(`⚠️ ${err.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Adım 2: video turları
// ---------------------------------------------------------------------------

const HOVER_PREVIEW_DELAY_MS = 350;
const IMPRESSION_MIN_MS = 1000;
const round = { number: 0, total: 4, cards: [], preview: null, observer: null };
const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} sa ${m % 60} dk` : `${m} dk`;
}

function showStep(step) {
  document.getElementById("onbLangForm").hidden = step !== "languages";
  document.getElementById("onbRounds").hidden = step !== "rounds";
  document.getElementById("onbDone").hidden = step !== "done";
}

/** Önizlemeyi durdurur. Oynatıcı hazırsa senkron çalışır (sekme kapanırken çıkış anı kaybolmasın). */
function stopPreview(reason) {
  const current = round.preview;
  round.preview = null;
  if (!current) return;
  current.card.classList.remove("is-previewing");
  if (current.resolved) current.resolved.stop(reason);
  else current.handle.then((h) => h?.stop(reason)).catch(() => {});
}

function playPreview(cardEl, card, position) {
  if (round.preview?.card === cardEl) return;
  stopPreview("switch");
  cardEl.classList.add("is-previewing");
  const meta = { surface: "onboarding", round: round.number, position };
  const handle = startPreview(cardEl.querySelector(".onb-thumb"), { videoId: card.videoId, start: card.previewStart, meta });
  const entry = { card: cardEl, handle, resolved: null };
  round.preview = entry;
  handle.then((h) => {
    entry.resolved = h;
  });
  handle.catch(() => {
    cardEl.classList.remove("is-previewing");
    if (round.preview?.card === cardEl) round.preview = null;
  });
}

function renderCard(card, position) {
  const meta = { videoId: card.videoId, surface: "onboarding", round: round.number, position };
  const foreign = Boolean(card.translatedTitle);
  const thumb = el("div", { class: "onb-thumb" }, [
    el("img", { src: card.thumbnail, alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "onb-duration", text: formatDuration(card.durationSeconds) }),
    card.lang !== "tr" ? el("span", { class: "lang-badge onb-lang", title: card.langName, text: `🌐 ${card.lang === "zxx" ? "♪" : card.lang.toUpperCase()}` }) : null,
    card.hasCaptions ? el("span", { class: "onb-cc", title: "Altyazı var", text: "CC" }) : null,
  ]);
  const watchBtn = el("button", {
    class: "btn btn-secondary btn-small onb-watch",
    type: "button",
    text: "▶ İzle",
    onclick: async (event) => {
      event.stopPropagation();
      track("click", { ...meta, target: "watch" });
      await stopPreview("watch");
      openWatchDialog({ videoId: card.videoId, title: card.translatedTitle ?? card.title, meta: { surface: "onboarding", round: round.number, position } })
        .catch((err) => setRoundStatus(`⚠️ ${err.message}`, "error"));
    },
  });
  const article = el("article", { class: "onb-card", tabindex: "0", "data-video-id": card.videoId, "aria-label": card.translatedTitle ?? card.title }, [
    thumb,
    el("div", { class: "onb-body" }, [
      el("h4", { class: "onb-title", text: card.translatedTitle ?? card.title }),
      foreign ? el("p", { class: "onb-original muted", lang: card.lang, text: card.title }) : null,
      el("p", { class: "onb-channel muted", text: card.channel }),
      watchBtn,
    ]),
  ]);

  // Masaüstü: üzerine gelince (kısa gecikmeyle) önizleme; üzerinde kalma süresi ölçülür
  let hoverStart = 0;
  let hoverTimer = null;
  article.addEventListener("mouseenter", () => {
    if (!finePointer()) return;
    hoverStart = performance.now();
    hoverTimer = setTimeout(() => playPreview(article, card, position), HOVER_PREVIEW_DELAY_MS);
  });
  article.addEventListener("mouseleave", () => {
    if (!finePointer()) return;
    clearTimeout(hoverTimer);
    const ms = Math.round(performance.now() - hoverStart);
    if (ms > 150) track("hover", { ...meta, ms });
    if (round.preview?.card === article) stopPreview("leave");
  });
  // Dokunmatik ve klavye: dokun/Enter önizlemeyi açar-kapatır
  const toggle = () => {
    if (round.preview?.card === article) stopPreview("tap");
    else {
      track("click", { ...meta, target: "preview" });
      playPreview(article, card, position);
    }
  };
  thumb.addEventListener("click", () => {
    if (!finePointer()) toggle();
    else track("click", { ...meta, target: "thumb" });
  });
  article.addEventListener("keydown", (event) => {
    if (event.target === article && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggle();
    }
  });
  return article;
}

/** Kart en az yarısı 1 sn görünür kaldıysa "impression". */
function observeImpressions(grid) {
  round.observer?.disconnect();
  const timers = new Map();
  const seen = new Set();
  round.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.videoId;
      if (seen.has(id)) continue;
      if (entry.isIntersecting) {
        timers.set(id, setTimeout(() => {
          seen.add(id);
          track("impression", { videoId: id, surface: "onboarding", round: round.number, position: Number(entry.target.dataset.position) });
        }, IMPRESSION_MIN_MS));
      } else {
        clearTimeout(timers.get(id));
      }
    }
  }, { threshold: 0.5 });
  grid.querySelectorAll(".onb-card").forEach((c) => round.observer.observe(c));
}

function setRoundStatus(text, kind = "") {
  const status = document.getElementById("onbRoundStatus");
  status.textContent = text;
  status.className = kind ? `form-status form-status-${kind}` : "form-status";
}

async function postJson(path) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Sunucu hatası (${response.status})`);
  return data;
}

function renderRound(data) {
  round.number = data.round;
  round.total = data.totalRounds;
  round.cards = data.cards;
  document.getElementById("onbRoundProgress").textContent = `Tur ${data.round}/${data.totalRounds}`;
  const focus = document.getElementById("onbFocus");
  focus.hidden = !data.focusAxes?.length;
  focus.textContent = data.focusAxes?.length
    ? `Bu turda en az emin olduğumuz: ${data.focusAxes.map((a) => a.label).join(", ")}.`
    : "";
  const grid = document.getElementById("onbGrid");
  grid.innerHTML = "";
  data.cards.forEach((card, i) => {
    const node = renderCard(card, i);
    node.dataset.position = String(i);
    grid.appendChild(node);
  });
  document.getElementById("onbNext").textContent = data.round >= (data.minRounds ?? 3) ? "Devam →" : "Sonraki tur →";
  observeImpressions(grid);
}

async function nextRound() {
  await stopPreview("next");
  const button = document.getElementById("onbNext");
  button.disabled = true;
  setRoundStatus("Yeni videolar seçiliyor…");
  try {
    const data = await postJson("/api/onboarding/next");
    document.dispatchEvent(new CustomEvent("yl:onboarding-round", { detail: data }));
    if (data.done) {
      round.observer?.disconnect();
      document.getElementById("onbDoneText").textContent = data.empty
        ? "Video havuzu henüz hazırlanmadı; şimdilik öneriler seçimlerine göre gelecek."
        : "Önerilerin artık izleme davranışına göre şekillenecek. Beğenmediğin bir şey olursa birkaç tur daha yapabilirsin.";
      showStep("done");
      return;
    }
    renderRound(data);
    showStep("rounds");
    setRoundStatus("");
    window.scrollTo({ top: document.getElementById("onbRounds").offsetTop - 16, behavior: "smooth" });
  } catch (err) {
    setRoundStatus(`⚠️ ${err.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function restartRounds() {
  await postJson("/api/onboarding/reset").catch(() => null);
  await nextRound();
}

async function renderPanel() {
  const unavailable = document.getElementById("onbUnavailable");
  const form = document.getElementById("onbLangForm");
  const profile = await getProfile({ refresh: true });
  state.profile = profile;
  unavailable.hidden = Boolean(profile);
  form.hidden = !profile;
  if (!profile) return;
  setTrackingEnabled(profile.trackingEnabled);
  renderLanguageStep();
  showStep("languages");
}

export function initOnboarding({ switchTab }) {
  switchTabRef = switchTab;
  document.getElementById("onbLangForm").addEventListener("submit", submitLanguages);
  document.getElementById("onbSkip").addEventListener("click", () => {
    writeDismissed();
    switchTabRef("foryou");
  });
  document.getElementById("tab-onboarding").addEventListener("click", renderPanel);
  document.getElementById("onbNext").addEventListener("click", nextRound);
  document.getElementById("onbRestart").addEventListener("click", restartRounds);
  document.getElementById("onbAgain").addEventListener("click", restartRounds);
  // Sekme gizlenince önizleme dursun (çıkış anı kaydedilsin), bölümden çıkınca da
  // capture: olay kuyruğunun çıkış gönderiminden (events.js) ÖNCE çalışsın
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && round.preview) stopPreview("hidden");
  }, { capture: true });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".menu-item") && round.preview) stopPreview("navigate");
  });
  if (window.location.hash === "#onboarding") renderPanel();
}

/** İlk ziyarette (dil hiç kaydedilmemiş ve kullanıcı atlamamışsa) onboarding'i açar. */
export async function maybeStartOnboarding() {
  if (readDismissed()) return;
  const profile = await getProfile();
  if (!profile || profile.languagesSaved) return;
  switchTabRef("onboarding", { scrollTop: false });
  renderPanel();
}
