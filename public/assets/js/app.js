// YouTubeLove — arayüz.
//
// Bütün öneriler yapay zekâdan gelir (aiClient.js → /api/suggest). Bu dosyada öneri
// içeriği yoktur; yalnızca seçenekler, akış ve kartların çizimi vardır.

import { CATEGORIES, MOODS, GOALS, DURATIONS, ENERGY_LEVELS } from "./data.js";
import {
  SHOW_ERAS, SHOW_GENRES, SHOW_MOODS, SHOW_ORIGINS, SHOW_TYPES, SHOW_INTENSITIES,
} from "./shows.js";
import { SORT_ORDERS, buildSearchUrl } from "./youtube.js";
import { QUIZ_QUESTIONS, summarizeProfile } from "./quiz.js";
import { fetchSuggestions, debounce } from "./ytSuggest.js";
import { createThumb } from "./thumb.js";
import { recordEvent, clearMemory, getEvents } from "./memory.js";
import { memorySummary, profileContext } from "./personalize.js";
import { getSuggestions, checkServer } from "./aiClient.js";
import {
  PROVIDERS, getProvider, getLlmConfig, saveLlmConfig, clearApiKey, maskKey,
} from "./llmSettings.js";
import { testConnection } from "./llm.js";
import { recordRecommendations, groupedHistory, clearHistory, recentTitles, SOURCE_LABELS } from "./recHistory.js";
import {
  isWatched, isSaved, toggleWatched, toggleSaved, addSaved, removeSaved,
  getWatchedItems, getSavedItems,
} from "./library.js";
import {
  getQuizProfile, saveQuizProfile, getSortOrder, setSortOrder, getTheme, setTheme,
  getLuckyStart, setLuckyStart, getSuggestionCount, setSuggestionCount,
} from "./storage.js";

const TIMER_MINUTES = { kisa: 8, orta: 20, uzun: 45 };

const state = {
  intentDuration: null,
  quick: { mood: null, goal: null },
  quiz: { index: 0, answers: {} },
  timer: { intervalId: null, remainingSeconds: 0 },
  category: null,
  showFilters: { era: null, genre: null, mood: null, origin: null, type: null, intensity: null },
};

const TAB_IDS = ["foryou", "quick", "quiz", "categories", "shows", "library", "tips", "settings"];
const MOBILE_QUERY = "(max-width: 899px)";

const labelOf = (list, id) => list.find((x) => x.id === id)?.label ?? id;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function isMobileLayout() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function setSidebarOpen(open) {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const toggle = document.getElementById("menuToggle");

  sidebar.classList.toggle("is-open", open);
  backdrop.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  document.body.classList.toggle("no-scroll", open);
}

function initTabs() {
  const menu = document.querySelector('[role="tablist"]');

  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).addEventListener("click", () => switchTab(id));
  });

  menu.addEventListener("keydown", (event) => {
    // Menü dikey olduğu için yukarı/aşağı; alışkanlık olsun diye sağ/sol da çalışır.
    const back = ["ArrowUp", "ArrowLeft"].includes(event.key);
    const forward = ["ArrowDown", "ArrowRight"].includes(event.key);
    if (!back && !forward) return;

    event.preventDefault();
    const currentIndex = TAB_IDS.findIndex(
      (id) => document.getElementById(`tab-${id}`).getAttribute("aria-selected") === "true"
    );
    const nextIndex = (currentIndex + (forward ? 1 : -1) + TAB_IDS.length) % TAB_IDS.length;
    const nextId = TAB_IDS[nextIndex];
    switchTab(nextId, { scrollTop: false });
    document.getElementById(`tab-${nextId}`).focus();
  });

  // Mobil çekmece
  document.getElementById("menuToggle").addEventListener("click", () => {
    const open = document.getElementById("menuToggle").getAttribute("aria-expanded") === "true";
    setSidebarOpen(!open);
  });
  document.getElementById("sidebarBackdrop").addEventListener("click", () => setSidebarOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSidebarOpen(false);
  });

  // Geri/ileri tuşları ve doğrudan yapıştırılan bağlantılar için
  window.addEventListener("hashchange", () => {
    const id = window.location.hash.replace("#", "");
    if (TAB_IDS.includes(id)) switchTab(id, { updateHash: false, scrollTop: false });
  });

  // Masaüstüne genişletilince açık kalmış çekmeceyi kapat
  window.matchMedia(MOBILE_QUERY).addEventListener("change", (event) => {
    if (!event.matches) setSidebarOpen(false);
  });

  // Adresteki bölüme (varsa) aç
  const fromHash = window.location.hash.replace("#", "");
  switchTab(TAB_IDS.includes(fromHash) ? fromHash : "foryou", {
    updateHash: false,
    scrollTop: false,
  });
}

const THEMES = [
  { id: "system", label: "Sistem", emoji: "🖥️" },
  { id: "light", label: "Açık", emoji: "☀️" },
  { id: "dark", label: "Koyu", emoji: "🌙" },
];

/** Seçili temayı belgeye uygular; "system" işaretlemeyi kaldırıp sisteme bırakır. */
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function renderThemeSwitch() {
  const container = document.getElementById("themeSwitch");
  container.innerHTML = "";
  const current = getTheme();
  THEMES.forEach((theme) => {
    container.appendChild(
      el("button", {
        class: "theme-option",
        type: "button",
        "aria-pressed": String(current === theme.id),
        title: `${theme.label} tema`,
        text: `${theme.emoji} ${theme.label}`,
        onclick: () => {
          setTheme(theme.id);
          applyTheme(theme.id);
          renderThemeSwitch();
        },
      })
    );
  });
}

function formatSeconds(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function initTimer() {
  const startBtn = document.getElementById("timerStart");
  const stopBtn = document.getElementById("timerStop");
  const display = document.getElementById("timerDisplay");
  const alertBox = document.getElementById("timerAlert");
  const originalTitle = document.title;

  function stopTimer(reset = true) {
    if (state.timer.intervalId) clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    display.hidden = true;
    document.title = originalTitle;
    if (reset) alertBox.hidden = true;
  }

  function tick() {
    state.timer.remainingSeconds -= 1;
    if (state.timer.remainingSeconds <= 0) {
      stopTimer(false);
      alertBox.hidden = false;
      return;
    }
    const text = formatSeconds(state.timer.remainingSeconds);
    display.textContent = text;
    document.title = `${text} · ${originalTitle}`;
  }

  startBtn.addEventListener("click", () => {
    const minutes = TIMER_MINUTES[state.intentDuration] ?? TIMER_MINUTES.orta;
    state.timer.remainingSeconds = minutes * 60;
    alertBox.hidden = true;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    display.hidden = false;
    display.textContent = formatSeconds(state.timer.remainingSeconds);
    state.timer.intervalId = setInterval(tick, 1000);
  });

  stopBtn.addEventListener("click", () => stopTimer(true));
}

/**
 * Bir bölüme "LLM ile öner" davranışı bağlar.
 * Her bölüm kendi bağlamını (seçili ruh hali, kategori, filtreler…) modele verir.
 *
 * @param {{buttonId:string, resultsId:string, focus:"video"|"show"|"any",
 *          buildContext:()=>string, avoid?:()=>string[]}} options
 */
const TAB_META = {
  foryou: { icon: "✨", label: "Sana Özel" },
  quick: { icon: "⚡", label: "Hızlı Seçim" },
  quiz: { icon: "📝", label: "Kısa Test" },
  categories: { icon: "🗂️", label: "Kategoriler" },
  shows: { icon: "🎬", label: "Dizi & Film" },
  library: { icon: "📚", label: "Kütüphanem" },
  tips: { icon: "💡", label: "İpuçları" },
  settings: { icon: "⚙️", label: "Ayarlar" },
};

/** data-goto taşıyan her düğme, adı geçen bölüme götürür. */
function initGotoLinks() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-goto]");
    if (!trigger) return;
    const target = trigger.dataset.goto;
    if (TAB_IDS.includes(target)) switchTab(target);
  });
}

/** Bölüm sonuna "şuraya da bakabilirsin" bağlantıları koyar. */
function renderNextStep(containerId, intro, targets) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  container.appendChild(el("span", { class: "muted next-step-intro", text: intro }));
  targets.forEach((target) => {
    const meta = TAB_META[target.id];
    container.appendChild(
      el("button", {
        class: "btn btn-secondary btn-small",
        type: "button",
        "data-goto": target.id,
        text: `${meta.icon} ${target.text ?? meta.label} →`,
      })
    );
  });
}

/** Hafıza boşken Sana Özel'de nereden başlanacağını gösteren kartlar. */
const START_CARDS = [
  { goto: "quick", icon: "⚡", title: "Nasıl hissediyorsun?", text: "Ruh halini ve hedefini seç, iki tıkla öneri al." },
  { goto: "quiz", icon: "📝", title: "Beni tanı", text: "Beş soruluk test, önerileri sana göre ayarlasın." },
  { goto: "shows", icon: "🎬", title: "Eski bir dizi bul", text: "Yapay zekâ izlemeye değer dizi ve filmleri hatırlatsın." },
];

function renderStartCards(show) {
  const container = document.getElementById("foryouStart");
  container.hidden = !show;
  if (!show) return;

  container.innerHTML = "";
  START_CARDS.forEach((card) => {
    container.appendChild(
      el("button", { class: "start-card", type: "button", "data-goto": card.goto }, [
        el("span", { class: "start-icon", "aria-hidden": "true", text: card.icon }),
        el("span", { class: "start-title", text: card.title }),
        el("span", { class: "start-text", text: card.text }),
      ])
    );
  });
}

function renderSingleChoiceGroup(containerId, options, getLabel, selectedGetter, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  options.forEach((opt) => {
    const selected = selectedGetter() === opt.id;
    const btn = el("button", {
      class: "chip",
      type: "button",
      "aria-pressed": String(selected),
      text: getLabel(opt),
      onclick: () => {
        onSelect(selected ? null : opt.id);
        renderSingleChoiceGroup(containerId, options, getLabel, selectedGetter, onSelect);
      },
    });
    container.appendChild(btn);
  });
}

function currentQuizQuestion() {
  return QUIZ_QUESTIONS[state.quiz.index];
}

function isQuizAnswered() {
  const q = currentQuizQuestion();
  const answer = state.quiz.answers[q.id];
  if (q.multi) return Array.isArray(answer) && answer.length > 0;
  return Boolean(answer);
}

function renderQuizQuestion() {
  const q = currentQuizQuestion();
  const container = document.getElementById("quizQuestion");
  container.innerHTML = "";

  const heading = el("h3", { text: q.question });
  const chipGroup = el("div", { class: "chip-group", role: "group", "aria-label": q.question });

  q.options.forEach((opt) => {
    const label = opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label;
    const isSelected = q.multi
      ? (state.quiz.answers[q.id] ?? []).includes(opt.id)
      : state.quiz.answers[q.id] === opt.id;

    const btn = el("button", {
      class: "chip",
      type: "button",
      "aria-pressed": String(isSelected),
      text: label,
      onclick: () => {
        if (q.multi) {
          const current = state.quiz.answers[q.id] ?? [];
          state.quiz.answers[q.id] = current.includes(opt.id)
            ? current.filter((id) => id !== opt.id)
            : [...current, opt.id];
        } else {
          state.quiz.answers[q.id] = opt.id;
        }
        renderQuizQuestion();
        updateQuizNav();
      },
    });
    chipGroup.appendChild(btn);
  });

  container.appendChild(heading);
  container.appendChild(chipGroup);

  document.getElementById("quizProgressBar").style.width = `${
    ((state.quiz.index + 1) / QUIZ_QUESTIONS.length) * 100
  }%`;
}

function updateQuizNav() {
  document.getElementById("quizBack").disabled = state.quiz.index === 0;
  const nextBtn = document.getElementById("quizNext");
  nextBtn.disabled = !isQuizAnswered();
  nextBtn.textContent = state.quiz.index === QUIZ_QUESTIONS.length - 1 ? "Sonuçları Gör" : "İleri";
}

function resetQuiz() {
  state.quiz = { index: 0, answers: {} };
  document.getElementById("quizContainer").hidden = false;
  document.getElementById("quizResultWrap").hidden = true;
  renderQuizQuestion();
  updateQuizNav();
}

const formSelection = { genres: [], moods: [] };

function renderFormChips(containerId, options, key) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  options.forEach((opt) => {
    const selected = formSelection[key].includes(opt.id);
    container.appendChild(
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(selected),
        text: opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label,
        onclick: () => {
          const list = formSelection[key];
          const idx = list.indexOf(opt.id);
          if (idx === -1) list.push(opt.id);
          else list.splice(idx, 1);
          renderFormChips(containerId, options, key);
        },
      })
    );
  });
}

function setFormStatus(message, kind = "info") {
  const status = document.getElementById("formStatus");
  status.textContent = message;
  status.className = `form-status form-status-${kind}`;
}

/** Başlık alanı için YouTube arama önerisi açılır listesi. */
function initTitleSuggestions() {
  const input = document.getElementById("fTitle");
  const list = document.getElementById("titleSuggestions");
  let activeIndex = -1;

  function closeList() {
    list.hidden = true;
    list.innerHTML = "";
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
  }

  function choose(text) {
    input.value = text;
    closeList();
    input.focus();
  }

  function renderList(suggestions) {
    if (suggestions.length === 0) {
      closeList();
      return;
    }
    list.innerHTML = "";
    suggestions.forEach((text, index) => {
      list.appendChild(
        el("li", {
          class: "suggest-item",
          role: "option",
          id: `suggest-${index}`,
          "aria-selected": "false",
          text,
          onmousedown: (event) => {
            // mousedown: blur'dan önce çalışsın ki liste kapanmadan seçim yapılsın
            event.preventDefault();
            choose(text);
          },
        })
      );
    });
    activeIndex = -1;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function highlight(nextIndex) {
    const items = [...list.querySelectorAll(".suggest-item")];
    if (items.length === 0) return;
    activeIndex = (nextIndex + items.length) % items.length;
    items.forEach((item, i) => {
      const on = i === activeIndex;
      item.classList.toggle("is-active", on);
      item.setAttribute("aria-selected", String(on));
    });
  }

  const runSearch = debounce(async (value) => {
    const suggestions = await fetchSuggestions(value);
    // Kullanıcı arada yazmayı sürdürdüyse eski sonucu gösterme.
    if (input.value.trim() !== value) return;
    renderList(suggestions);
  }, 250);

  input.addEventListener("input", () => {
    const value = input.value.trim();
    if (value.length < 2) {
      closeList();
      return;
    }
    runSearch(value);
  });

  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(activeIndex - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose([...list.querySelectorAll(".suggest-item")][activeIndex].textContent);
    } else if (event.key === "Escape") {
      closeList();
    }
  });

  input.addEventListener("blur", () => setTimeout(closeList, 120));
}

function formatHistoryDate(iso) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) {
    return `bugün ${date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

function setLlmStatus(message, kind = "info") {
  const status = document.getElementById("llmStatus");
  status.textContent = message;
  status.className = `form-status form-status-${kind}`;
}

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

function switchTab(tabId, options = {}) {
  TAB_IDS.forEach((id) => {
    const active = id === tabId;
    const tabBtn = document.getElementById(`tab-${id}`);
    tabBtn.setAttribute("aria-selected", String(active));
    tabBtn.tabIndex = active ? 0 : -1;
    document.getElementById(`panel-${id}`).hidden = !active;
  });

  if (tabId === "library") renderLibraryTab();
  if (tabId === "foryou") renderMemoryStatus();

  if (options.updateHash !== false && window.location.hash !== `#${tabId}`) {
    history.replaceState(null, "", `#${tabId}`);
  }
  if (isMobileLayout()) setSidebarOpen(false);
  if (options.scrollTop !== false) window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Menüdeki ayarlar: süre ve sıralama
// ---------------------------------------------------------------------------

function renderIntentDuration() {
  const container = document.getElementById("intentDuration");
  container.innerHTML = "";
  DURATIONS.forEach((d) => {
    container.appendChild(
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(state.intentDuration === d.id),
        text: `${d.emoji} ${d.label}`,
        onclick: () => {
          state.intentDuration = state.intentDuration === d.id ? null : d.id;
          renderIntentDuration();
          refreshVisibleLinks();
        },
      })
    );
  });
}

function renderSortChips() {
  const container = document.getElementById("sortOrder");
  container.innerHTML = "";
  const current = getSortOrder();
  SORT_ORDERS.forEach((option) => {
    container.appendChild(
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(current === option.id),
        text: `${option.emoji} ${option.label}`,
        onclick: () => {
          setSortOrder(option.id);
          renderSortChips();
          refreshVisibleLinks();
        },
      })
    );
  });
}

// ---------------------------------------------------------------------------
// Öneri kartı
// ---------------------------------------------------------------------------

const KIND_LABEL = { video: "Video", dizi: "Dizi", film: "Film" };
const viewsFormat = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

/** YouTube videosu bulunduysa doğrudan ona, bulunmadıysa izlenmeye göre sıralı aramaya gider. */
function linkFor(item) {
  if (item.video?.id) return `https://www.youtube.com/watch?v=${item.video.id}`;
  return buildSearchUrl(item.query, { sort: getSortOrder(), duration: state.intentDuration });
}

/** Sıralama/süre değişince ekrandaki arama bağlantılarını yeniden kurar (yeni istek atmadan). */
function refreshVisibleLinks() {
  document.querySelectorAll("a.watch-link[data-query]").forEach((link) => {
    link.href = buildSearchUrl(link.dataset.query, {
      sort: getSortOrder(),
      duration: state.intentDuration,
    });
  });
}

function renderAiCard(item, { note = null, onRemove = null } = {}) {
  const hasVideo = Boolean(item.video?.id);

  const watchedBtn = el("button", {
    class: "btn btn-secondary btn-small watched-toggle",
    type: "button",
    "aria-pressed": String(isWatched(item.id)),
    text: isWatched(item.id) ? "✅ İzledim" : "＋ İzledim",
    onclick: () => {
      const now = toggleWatched(item);
      if (now) recordEvent("item_watched", { id: item.id, title: item.title, category: item.category });
      watchedBtn.setAttribute("aria-pressed", String(now));
      watchedBtn.textContent = now ? "✅ İzledim" : "＋ İzledim";
      card.classList.toggle("is-watched", now);
      updateLibraryCount();
    },
  });

  const saveBtn = el("button", {
    class: "save-btn",
    type: "button",
    "aria-pressed": String(isSaved(item.id)),
    "aria-label": isSaved(item.id) ? "Kaydedilenlerden çıkar" : "Sonra izlemek için kaydet",
    text: isSaved(item.id) ? "💚" : "🤍",
    onclick: () => {
      const now = toggleSaved(item);
      if (now) recordEvent("item_saved", { id: item.id, title: item.title, category: item.category });
      saveBtn.setAttribute("aria-pressed", String(now));
      saveBtn.textContent = now ? "💚" : "🤍";
      saveBtn.setAttribute("aria-label", now ? "Kaydedilenlerden çıkar" : "Sonra izlemek için kaydet");
      updateLibraryCount();
    },
  });

  const link = el("a", {
    class: "watch-link",
    href: linkFor(item),
    target: "_blank",
    rel: "noopener noreferrer",
    text: hasVideo ? "▶ YouTube'da izle" : "YouTube'da ara ↗",
    onclick: () => recordEvent("item_opened", { id: item.id, title: item.title, category: item.category }),
  });
  if (!hasVideo) link.dataset.query = item.query;

  const tags = [
    el("span", { class: "tag", text: KIND_LABEL[item.kind] ?? "Video" }),
    item.year ? el("span", { class: "tag", text: item.year }) : null,
    el("span", { class: "tag", text: item.category }),
    ...(item.tags ?? []).map((t) => el("span", { class: "tag", text: t })),
    item.custom ? el("span", { class: "tag tag-custom", text: "senin eklediğin" }) : null,
  ];

  const videoLine = hasVideo
    ? el("p", { class: "video-line" }, [
        el("span", { class: "video-title", text: item.video.title }),
        el("span", {
          class: "muted",
          text: [
            item.video.channel,
            item.video.views != null ? `${viewsFormat.format(item.video.views)} izlenme` : null,
          ].filter(Boolean).join(" · "),
        }),
      ])
    : null;

  const actions = [link, watchedBtn];
  if (onRemove) {
    actions.push(
      el("button", {
        class: "btn btn-ghost btn-small delete-btn",
        type: "button",
        "aria-label": `${item.title} kaydını sil`,
        text: "🗑️",
        onclick: onRemove,
      })
    );
  }

  const card = el("article", { class: `card ai-card${isWatched(item.id) ? " is-watched" : ""}` }, [
    note ? el("p", { class: "reason-note", text: note }) : null,
    createThumb({ id: item.id, title: item.title, type: item.kind, videoId: item.video?.id }),
    el("div", { class: "card-top" }, [el("h4", { text: item.title }), saveBtn]),
    item.why ? el("p", { class: "why", text: item.why }) : null,
    videoLine,
    el("div", { class: "card-tags" }, tags),
    el("div", { class: "card-actions" }, actions),
  ]);
  return card;
}

// ---------------------------------------------------------------------------
// Yapay zekâdan öneri isteme (bütün bölümler bunu kullanır)
// ---------------------------------------------------------------------------

/** Aynı alana arka arkaya istek atılırsa yalnızca sonuncunun sonucu çizilsin. */
const latestRequest = new Map();

function durationContext() {
  const d = DURATIONS.find((x) => x.id === state.intentDuration);
  return d ? `Ayırabileceği süre: ${d.label}.` : "";
}

function renderLoading(container, count) {
  container.innerHTML = "";
  container.appendChild(el("p", { class: "ai-status", text: "✨ Yapay zekâ senin için arıyor…" }));
  for (let i = 0; i < Math.min(count, 6); i++) {
    container.appendChild(el("div", { class: "card skeleton", "aria-hidden": "true" }));
  }
}

/**
 * @param {{resultsId:string, source:string, context?:string, focus?:string,
 *          count?:number, lucky?:boolean, button?:HTMLElement}} options
 */
async function runAi(options) {
  const { resultsId, source, focus = "any", lucky = false, button } = options;
  const count = options.count ?? getSuggestionCount();
  const container = document.getElementById(resultsId);
  const requestId = Symbol(resultsId);
  latestRequest.set(resultsId, requestId);

  renderLoading(container, count);
  if (button) button.disabled = true;

  const context = [options.context, durationContext(), profileContext()]
    .filter(Boolean)
    .join("\n\n");
  const avoid = [...new Set([...getWatchedItems().map((i) => i.title), ...recentTitles(25)])];

  try {
    const result = await getSuggestions({ context, focus, count, avoid, lucky });
    if (latestRequest.get(resultsId) !== requestId) return [];

    container.innerHTML = "";
    result.suggestions.forEach((item) => container.appendChild(renderAiCard(item)));
    recordRecommendations(result.suggestions, source);
    return result.suggestions;
  } catch (error) {
    if (latestRequest.get(resultsId) !== requestId) return [];
    container.innerHTML = "";
    container.appendChild(
      el("div", { class: "ai-error" }, [
        el("p", { text: `⚠️ ${error.message}` }),
        el("button", {
          class: "btn btn-secondary btn-small",
          type: "button",
          text: "Tekrar dene",
          onclick: () => runAi(options),
        }),
      ])
    );
    return [];
  } finally {
    if (button && latestRequest.get(resultsId) === requestId) button.disabled = false;
  }
}

function placeholder(resultsId, text) {
  const container = document.getElementById(resultsId);
  container.innerHTML = "";
  container.appendChild(el("p", { class: "muted placeholder-text", text }));
}

// ---------------------------------------------------------------------------
// Sana Özel + Şansımı dene
// ---------------------------------------------------------------------------

function renderMemoryStatus() {
  const summary = memorySummary();
  const eventCount = getEvents().length;
  const libraryCount = getWatchedItems().length + getSavedItems().length;

  document.getElementById("memorySummary").textContent =
    summary ??
    "Hafızam henüz boş. Seçim yaptıkça, kaydettikçe ve “izledim” dedikçe yapay zekâ önerileri sana göre şekillendirir.";

  renderStartCards(
    !summary &&
      document.getElementById("foryouResults").childElementCount === 0 &&
      document.getElementById("luckyBox").hidden
  );

  const bits = [];
  if (eventCount > 0) bits.push(`${eventCount} hareket`);
  if (libraryCount > 0) bits.push(`kütüphanede ${libraryCount} öge`);
  document.getElementById("memoryMeta").textContent = bits.join(" · ");
  document.getElementById("memoryReset").hidden = eventCount === 0;
}

function showLuckyPick(focus = "any") {
  const box = document.getElementById("luckyBox");
  box.innerHTML = "";
  box.appendChild(
    el("div", { class: "lucky-head" }, [
      el("h3", { text: "🎲 Şansına bu çıktı" }),
      el("div", { class: "lucky-actions" }, [
        el("button", {
          class: "btn btn-primary btn-small",
          type: "button",
          text: "🎲 Bir daha",
          onclick: () => showLuckyPick(focus),
        }),
        el("button", {
          class: "btn btn-ghost btn-small",
          type: "button",
          text: "Kapat",
          onclick: () => {
            box.hidden = true;
            renderMemoryStatus();
          },
        }),
      ]),
    ])
  );
  box.appendChild(el("div", { id: "luckyResults", class: "lucky-results" }));
  box.hidden = false;
  renderStartCards(false);

  return runAi({ resultsId: "luckyResults", source: "lucky", focus, count: 1, lucky: true });
}

function initForYouTab() {
  const luckyToggle = document.getElementById("luckyStart");
  luckyToggle.checked = getLuckyStart();
  luckyToggle.addEventListener("change", () => setLuckyStart(luckyToggle.checked));

  document.getElementById("luckyBtn").addEventListener("click", () => showLuckyPick());

  const generate = document.getElementById("foryouGenerate");
  generate.addEventListener("click", async () => {
    renderStartCards(false);
    await runAi({
      resultsId: "foryouResults",
      source: "foryou",
      button: generate,
      context: "Bu kişiye özel, zevkine uygun ama onu şaşırtacak kadar da çeşitli öneriler ver.",
    });
    renderNextStep("foryouNext", "Önerileri daha da isabetli yapmak için:", [
      { id: "quiz", text: "Kısa Test'i doldur" },
      { id: "shows", text: "Dizi/film filtrele" },
    ]);
    document.getElementById("foryouNext").hidden = false;
    renderMemoryStatus();
  });

  document.getElementById("memoryReset").addEventListener("click", () => {
    if (!window.confirm("Hafıza sıfırlansın mı? Seçim geçmişin silinir; kütüphanen kalır.")) return;
    clearMemory();
    renderMemoryStatus();
  });

  renderMemoryStatus();
}

// ---------------------------------------------------------------------------
// Hızlı Seçim
// ---------------------------------------------------------------------------

function initQuickTab() {
  const submitBtn = document.getElementById("quickSubmit");
  const refreshSubmitState = () => {
    submitBtn.disabled = !state.quick.mood && !state.quick.goal;
  };

  renderSingleChoiceGroup("quickMoods", MOODS, (m) => `${m.emoji} ${m.label}`,
    () => state.quick.mood, (val) => { state.quick.mood = val; refreshSubmitState(); });
  renderSingleChoiceGroup("quickGoals", GOALS, (g) => `${g.emoji} ${g.label}`,
    () => state.quick.goal, (val) => { state.quick.goal = val; refreshSubmitState(); });
  refreshSubmitState();

  placeholder("quickResults", "Ruh halini ya da hedefini seç, sonra “Önerileri getir”e bas.");

  submitBtn.addEventListener("click", () => {
    if (state.quick.mood) recordEvent("mood_selected", { value: state.quick.mood });
    if (state.quick.goal) recordEvent("goal_selected", { value: state.quick.goal });
    const parts = [];
    if (state.quick.mood) parts.push(`Şu an "${labelOf(MOODS, state.quick.mood)}" hissediyor.`);
    if (state.quick.goal) parts.push(`Bu izlemeden beklentisi: "${labelOf(GOALS, state.quick.goal)}".`);
    runAi({ resultsId: "quickResults", source: "quick", context: parts.join(" "), button: submitBtn });
  });
}

// ---------------------------------------------------------------------------
// Kısa Test
// ---------------------------------------------------------------------------

function quizContext(answers) {
  const parts = [];
  if (answers.mood) parts.push(`Ruh hali: ${labelOf(MOODS, answers.mood)}.`);
  if (answers.goal) parts.push(`Hedefi: ${labelOf(GOALS, answers.goal)}.`);
  if (answers.duration) parts.push(`Süresi: ${labelOf(DURATIONS, answers.duration)}.`);
  if (answers.energy) parts.push(`Enerjisi: ${labelOf(ENERGY_LEVELS, answers.energy)}.`);
  const cats = (answers.categories ?? []).map((id) => labelOf(CATEGORIES, id));
  if (cats.length) parts.push(`İlgi alanları: ${cats.join(", ")}.`);
  return parts.join(" ");
}

function finishQuiz() {
  document.getElementById("quizContainer").hidden = true;
  document.getElementById("quizResultWrap").hidden = false;

  saveQuizProfile(state.quiz.answers);
  Object.entries(state.quiz.answers).forEach(([key, value]) => {
    [].concat(value).forEach((v) => recordEvent("quiz_answer", { key, value: v }));
  });
  document.getElementById("quizSummary").textContent = summarizeProfile(state.quiz.answers);
  runQuizSuggestions();
}

function runQuizSuggestions() {
  runAi({
    resultsId: "quizResults",
    source: "quiz",
    context: quizContext(state.quiz.answers),
    button: document.getElementById("quizMore"),
  });
}

function initQuizTab() {
  renderQuizQuestion();
  updateQuizNav();

  document.getElementById("quizBack").addEventListener("click", () => {
    if (state.quiz.index === 0) return;
    state.quiz.index -= 1;
    renderQuizQuestion();
    updateQuizNav();
  });
  document.getElementById("quizNext").addEventListener("click", () => {
    if (!isQuizAnswered()) return;
    if (state.quiz.index === QUIZ_QUESTIONS.length - 1) {
      finishQuiz();
      return;
    }
    state.quiz.index += 1;
    renderQuizQuestion();
    updateQuizNav();
  });
  document.getElementById("quizRestart").addEventListener("click", resetQuiz);
  document.getElementById("quizMore").addEventListener("click", runQuizSuggestions);
}

// ---------------------------------------------------------------------------
// Kategoriler
// ---------------------------------------------------------------------------

function initCategoriesTab() {
  const chips = document.getElementById("categoryChips");

  function render() {
    chips.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      chips.appendChild(
        el("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(state.category === cat.id),
          text: `${cat.emoji} ${cat.label}`,
          onclick: () => {
            state.category = cat.id;
            recordEvent("category_browsed", { value: cat.id });
            render();
            runAi({
              resultsId: "categoryResults",
              source: "category",
              context: `"${cat.label}" alanında öneri istiyor (${cat.description}). ` +
                "Bu alanda YouTube'da çok izlenen, ilginç videolar; uygunsa dizi, film ve belgeseller.",
            });
          },
        })
      );
    });
  }

  render();
  placeholder("categoryResults", "Bir kategori seç; yapay zekâ o alanda izlemeye değer içerikleri getirsin.");
}

// ---------------------------------------------------------------------------
// Dizi & Film
// ---------------------------------------------------------------------------

const SHOW_FILTER_GROUPS = [
  ["showEraChips", SHOW_ERAS, "era", "Dönem"],
  ["showGenreChips", SHOW_GENRES, "genre", "Tür"],
  ["showMoodChips", SHOW_MOODS, "mood", "Hissettirmesi gereken"],
  ["showOriginChips", SHOW_ORIGINS, "origin", "Yapım"],
  ["showTypeChips", SHOW_TYPES, "type", "Biçim"],
  ["showIntensityChips", SHOW_INTENSITIES, "intensity", "Yoğunluk"],
];

function renderShowChips() {
  SHOW_FILTER_GROUPS.forEach(([containerId, options, key]) => {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    options.forEach((opt) => {
      const selected = state.showFilters[key] === opt.id;
      container.appendChild(
        el("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(selected),
          text: opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label,
          onclick: () => {
            state.showFilters[key] = selected ? null : opt.id;
            if (!selected) recordEvent("show_filter", { value: opt.label });
            renderShowChips();
          },
        })
      );
    });
  });
}

function showContext() {
  const parts = SHOW_FILTER_GROUPS
    .map(([, options, key, title]) => (state.showFilters[key] ? `${title}: ${labelOf(options, state.showFilters[key])}` : null))
    .filter(Boolean);
  return parts.length
    ? `Dizi/film arıyor. ${parts.join(". ")}.`
    : "Dizi/film arıyor; özellikle aklına gelmeyecek eski ya da kült yapımlar, ilginç diziler.";
}

function initAddShowForm() {
  renderFormChips("fGenreChips", SHOW_GENRES, "genres");
  renderFormChips("fMoodChips", SHOW_MOODS, "moods");
  initTitleSuggestions();

  const form = document.getElementById("addShowForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (!title) {
      setFormStatus("Başlık gerekli.", "error");
      document.getElementById("fTitle").focus();
      return;
    }
    const kind = data.get("type") === "film" ? "film" : "dizi";
    const videoMatch = String(data.get("videoId") ?? "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/|^)([A-Za-z0-9_-]{11})(?:$|[?&#])/);
    const item = {
      id: `${kind}-kendi-${title.toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]+/g, "-")}`,
      title,
      query: `${title} ${kind === "film" ? "filmi" : "dizisi"}`,
      why: String(data.get("description") ?? "").trim() || "Senin eklediğin.",
      kind,
      category: kind === "film" ? "Film" : "Dizi",
      year: String(data.get("year") ?? "").trim(),
      tags: [
        ...formSelection.genres.map((id) => labelOf(SHOW_GENRES, id)),
        ...formSelection.moods.map((id) => labelOf(SHOW_MOODS, id)),
      ],
      custom: true,
      ...(videoMatch ? { video: { id: videoMatch[1], title: "", channel: "", views: null } } : {}),
    };
    if (isSaved(item.id)) {
      setFormStatus("Bu başlık zaten kaydettiklerinde var.", "error");
      return;
    }
    addSaved(item);
    recordEvent("item_saved", { id: item.id, title: item.title, category: item.category });
    form.reset();
    setFormStatus(`"${title}" Kaydettiklerim'e eklendi ✅`, "success");
    updateLibraryCount();
  });

  form.addEventListener("reset", () => {
    formSelection.genres = [];
    formSelection.moods = [];
    renderFormChips("fGenreChips", SHOW_GENRES, "genres");
    renderFormChips("fMoodChips", SHOW_MOODS, "moods");
    setFormStatus("");
  });
}

function initShowsTab() {
  renderShowChips();
  initAddShowForm();
  placeholder("showResults", "İstediğin filtreleri seç (ya da hiç seçme), sonra “Dizi/film öner”e bas.");

  const submit = document.getElementById("showSubmit");
  submit.addEventListener("click", () =>
    runAi({ resultsId: "showResults", source: "shows", focus: "show", context: showContext(), button: submit })
  );
  const random = document.getElementById("showRandom");
  random.addEventListener("click", () =>
    runAi({
      resultsId: "showResults", source: "lucky", focus: "show", count: 1, lucky: true,
      context: showContext(), button: random,
    })
  );
  document.getElementById("showClearFilters").addEventListener("click", () => {
    Object.keys(state.showFilters).forEach((k) => { state.showFilters[k] = null; });
    renderShowChips();
  });
}

// ---------------------------------------------------------------------------
// Kütüphanem
// ---------------------------------------------------------------------------

function updateLibraryCount() {
  const count = getWatchedItems().length + getSavedItems().length;
  const badge = document.getElementById("libraryCount");
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function renderList(containerId, emptyId, itemsList, options = {}) {
  const container = document.getElementById(containerId);
  document.getElementById(emptyId).hidden = itemsList.length > 0;
  container.innerHTML = "";
  itemsList.forEach((item) => container.appendChild(renderAiCard(item, options(item))));
}

function renderHistorySection() {
  const groups = groupedHistory();
  const container = document.getElementById("historyGroups");
  const total = groups.reduce((sum, g) => sum + g.entries.length, 0);

  container.innerHTML = "";
  document.getElementById("historyEmpty").hidden = total > 0;
  document.getElementById("historyClear").hidden = total === 0;
  document.getElementById("historySummary").textContent =
    total > 0 ? `${total} öneri, ${groups.length} kategoride toplandı.` : "";

  groups.forEach((group, index) => {
    const details = el("details", { class: "history-group" });
    if (index === 0) details.open = true;
    details.appendChild(
      el("summary", {}, [
        el("span", { class: "history-group-title", text: `${group.emoji} ${group.label}` }),
        el("span", { class: "badge badge-soft", text: String(group.entries.length) }),
      ])
    );
    const grid = el("div", { class: "results-grid" });
    group.entries.forEach((entry) => {
      const card = renderAiCard(entry.item);
      const bits = [SOURCE_LABELS[entry.source] ?? entry.source, formatHistoryDate(entry.at)];
      if ((entry.count ?? 1) > 1) bits.push(`${entry.count} kez önerildi`);
      card.appendChild(el("p", { class: "history-meta muted", text: bits.join(" · ") }));
      grid.appendChild(card);
    });
    details.appendChild(grid);
    container.appendChild(details);
  });
}

function renderLibraryTab() {
  const watched = getWatchedItems();
  const saved = getSavedItems();

  renderList("watchedResults", "watchedEmpty", watched, () => ({}));
  document.getElementById("watchedSummary").textContent =
    watched.length > 0 ? `${watched.length} şey izledin.` : "";

  renderList("savedResults", "savedEmpty", saved, (item) => ({
    onRemove: item.custom
      ? () => {
          if (!window.confirm(`"${item.title}" silinsin mi?`)) return;
          removeSaved(item.id);
          renderLibraryTab();
          updateLibraryCount();
        }
      : null,
  }));

  document.getElementById("similarIntro").textContent =
    watched.length + saved.length > 0
      ? "İzlediklerini ve kaydettiklerini yapay zekâya verip benzerlerini buldururum."
      : "Önce birkaç şeye “İzledim” de ya da 💚 ile kaydet; sonra benzerlerini buldururum.";
  document.getElementById("similarBtn").disabled = watched.length + saved.length === 0;

  renderHistorySection();
}

function initLibraryTab() {
  const similarBtn = document.getElementById("similarBtn");
  similarBtn.addEventListener("click", () => {
    const watched = getWatchedItems().map((i) => i.title);
    const saved = getSavedItems().map((i) => i.title);
    runAi({
      resultsId: "similarResults",
      source: "similar",
      button: similarBtn,
      context:
        [
          watched.length ? `Beğenip izledikleri: ${watched.slice(0, 20).join(", ")}.` : "",
          saved.length ? `İzlemek için kaydettikleri: ${saved.slice(0, 15).join(", ")}.` : "",
          "Bunlara benzeyen ama aynısı olmayan yapımlar ve içerikler öner.",
        ].filter(Boolean).join(" "),
    });
  });

  document.getElementById("historyClear").addEventListener("click", () => {
    if (!window.confirm("Geçmiş öneriler silinsin mi? Kütüphanen kalır.")) return;
    clearHistory();
    renderHistorySection();
  });
}

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------

async function renderServerStatus() {
  const status = await checkServer();
  const set = (id, icon, text) => {
    document.getElementById(`${id}Icon`).textContent = icon;
    document.getElementById(`${id}Text`).textContent = text;
  };

  if (status.available) {
    const name = status.provider === "anthropic" ? "Claude" : "Cloudflare Workers AI";
    set("aiStatus", "✅", `Yapay zekâ açık (${name}). Senden anahtar istenmez.`);
  } else if (getLlmConfig().enabled && getLlmConfig().apiKey) {
    set("aiStatus", "🔑", "Sitenin servisine ulaşılamadı; öneriler gelişmiş ayardaki kendi anahtarınla üretilecek.");
  } else {
    set("aiStatus", "⚠️", "Sitenin yapay zekâ servisine ulaşılamadı. Site Cloudflare Pages üzerinde çalışmıyor olabilir.");
  }

  if (status.youtube) {
    set("ytStatus", "✅", "YouTube bağlı: her öneriye YouTube'da en çok izlenen gerçek video eklenir.");
  } else {
    set("ytStatus", "ℹ️", "YouTube anahtarı tanımlı değil: öneriler, izlenmeye göre sıralı YouTube aramasına götürür.");
  }
}

function syncLlmFormFromConfig() {
  const config = getLlmConfig();
  const provider = getProvider(config.provider);
  document.getElementById("llmEnabled").checked = config.enabled;
  document.getElementById("llmProvider").value = config.provider;
  document.getElementById("llmModel").value = config.model;
  document.getElementById("llmModel").placeholder = provider.defaultModel;
  const keyInput = document.getElementById("llmKey");
  keyInput.value = "";
  keyInput.placeholder = config.apiKey ? maskKey(config.apiKey) : provider.keyPlaceholder;
  document.getElementById("llmKeyState").textContent = config.apiKey
    ? `Kayıtlı anahtar: ${maskKey(config.apiKey)} — değiştirmek için yenisini yaz. `
    : "Anahtar kaydedilmedi. ";
  document.getElementById("llmKeysLink").href = provider.keysUrl;
}

function initSettingsTab() {
  const countInput = document.getElementById("aiCount");
  countInput.value = getSuggestionCount();
  countInput.addEventListener("change", () => {
    setSuggestionCount(Math.min(12, Math.max(3, Number(countInput.value) || 6)));
    countInput.value = getSuggestionCount();
  });

  const providerSelect = document.getElementById("llmProvider");
  PROVIDERS.forEach((p) => providerSelect.appendChild(el("option", { value: p.id, text: p.label })));
  syncLlmFormFromConfig();

  providerSelect.addEventListener("change", () => {
    const provider = getProvider(providerSelect.value);
    document.getElementById("llmModel").value = provider.defaultModel;
    document.getElementById("llmKey").placeholder = provider.keyPlaceholder;
    document.getElementById("llmKeysLink").href = provider.keysUrl;
  });

  document.getElementById("llmForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const typedKey = document.getElementById("llmKey").value.trim();
    const enabled = document.getElementById("llmEnabled").checked;
    if (enabled && !typedKey && !getLlmConfig().apiKey) {
      setLlmStatus("Önce bir API anahtarı gir.", "error");
      return;
    }
    const patch = {
      enabled,
      provider: providerSelect.value,
      model: document.getElementById("llmModel").value.trim(),
    };
    if (typedKey) patch.apiKey = typedKey;
    saveLlmConfig(patch);
    syncLlmFormFromConfig();
    renderServerStatus();
    setLlmStatus("Kaydedildi ✅", "success");
  });

  document.getElementById("llmTest").addEventListener("click", async () => {
    const button = document.getElementById("llmTest");
    const typedKey = document.getElementById("llmKey").value.trim();
    const config = {
      ...getLlmConfig(),
      provider: providerSelect.value,
      model: document.getElementById("llmModel").value.trim() || getProvider(providerSelect.value).defaultModel,
    };
    if (typedKey) config.apiKey = typedKey;
    if (!config.apiKey) {
      setLlmStatus("Önce bir API anahtarı gir.", "error");
      return;
    }
    button.disabled = true;
    setLlmStatus("Bağlantı test ediliyor…", "info");
    try {
      const reply = await testConnection(config);
      setLlmStatus(`Bağlantı başarılı ✅ (model yanıtı: “${reply}”)`, "success");
    } catch (error) {
      setLlmStatus(`Bağlantı başarısız: ${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("llmClear").addEventListener("click", () => {
    if (!window.confirm("Kayıtlı API anahtarı silinsin mi?")) return;
    clearApiKey();
    syncLlmFormFromConfig();
    renderServerStatus();
    setLlmStatus("Anahtar silindi.", "info");
  });

  renderServerStatus();
}

// ---------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------

function initNextSteps() {
  renderNextStep("quickNext", "Daha isabetli olsun mu?", [
    { id: "quiz", text: "Kısa Test'le daha iyi tanıyayım" },
    { id: "shows", text: "Dizi/film arıyorum" },
  ]);
  renderNextStep("quizNextStep", "Başka nereye bakabilirsin:", [{ id: "categories" }, { id: "shows" }]);
  renderNextStep("categoryNext", "Başka nereye bakabilirsin:", [{ id: "quick" }, { id: "shows" }]);
  renderNextStep("showNext", "İzlediklerini işaretledikçe öneriler kişiselleşir:", [
    { id: "library", text: "Kütüphaneme bak" },
  ]);
}

function init() {
  applyTheme(getTheme());
  renderThemeSwitch();
  renderIntentDuration();
  renderSortChips();
  initTimer();
  initTabs();
  initGotoLinks();
  initNextSteps();
  initQuickTab();
  initQuizTab();
  initCategoriesTab();
  initShowsTab();
  initForYouTab();
  initLibraryTab();
  initSettingsTab();
  updateLibraryCount();

  const previousProfile = getQuizProfile();
  if (previousProfile) state.quiz.answers = { ...previousProfile };

  // "Şansımı dene" modu: ayar açıksa ya da #lucky adresiyle gelindiyse rastgele öneriyle aç.
  // Belirli bir bölümün adresiyle gelindiyse o bölüme saygı gösterilir.
  const hash = window.location.hash.replace("#", "");
  const opensOnForYou = hash === "" || hash === "foryou" || !TAB_IDS.includes(hash);
  if (hash === "lucky" || (getLuckyStart() && opensOnForYou)) {
    switchTab("foryou", { scrollTop: false });
    showLuckyPick();
  }
}

document.addEventListener("DOMContentLoaded", init);
