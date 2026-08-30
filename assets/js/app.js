import { CATEGORIES, MOODS, GOALS, DURATIONS } from "./data.js";
import { buildSearchUrlForItem } from "./youtube.js";
import { recommend, listByCategory, getItemById } from "./recommend.js";
import { QUIZ_QUESTIONS, answersToProfile, summarizeProfile } from "./quiz.js";
import {
  SHOW_ERAS,
  SHOW_GENRES,
  SHOW_MOODS,
  SHOW_ORIGINS,
  SHOW_TYPES,
  SHOW_INTENSITIES,
} from "./shows.js";
import {
  filterShows,
  similarToWatched,
  watchedStats,
  getShowById,
} from "./showRecommend.js";
import { addCustomShow, removeCustomShow, isCustomShow } from "./customShows.js";
import { fetchSuggestions, debounce } from "./ytSuggest.js";
import { createThumb } from "./thumb.js";
import { recordEvent, clearMemory, getEvents } from "./memory.js";
import { personalizedPicks, memorySummary } from "./personalize.js";
import {
  PROVIDERS, getProvider, getLlmConfig, saveLlmConfig, clearApiKey, isLlmReady, maskKey,
  isAutoSuggest,
} from "./llmSettings.js";
import { generateLlmSuggestions, testConnection } from "./llm.js";
import {
  recordRecommendations, groupedHistory, clearHistory, SOURCE_LABELS,
} from "./recHistory.js";
import { buildSearchUrl } from "./youtube.js";
import {
  isSaved,
  toggleSaved,
  getSavedIds,
  pushRecentIds,
  getQuizProfile,
  saveQuizProfile,
  isWatched,
  toggleWatched,
  getWatchedIds,
  isShowSaved,
  toggleSavedShow,
  getSavedShowIds,
} from "./storage.js";

const TIMER_MINUTES = { kisa: 8, orta: 20, uzun: 45 };

const state = {
  intentDuration: null,
  quick: { mood: null, goal: null },
  quiz: { index: 0, answers: {} },
  timer: { intervalId: null, remainingSeconds: 0 },
};

// ---------------------------------------------------------------------------
// Genel yardımcılar
// ---------------------------------------------------------------------------

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

const DURATION_LABEL_SHORT = { kisa: "Kısa", orta: "Orta", uzun: "Uzun" };
const ENERGY_LABEL = { dusuk: "Düşük enerji", orta: "Orta enerji", yuksek: "Yüksek enerji" };

function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Kart oluşturma (tüm sekmelerde ortak)
// ---------------------------------------------------------------------------

function renderCard(item) {
  const url = buildSearchUrlForItem(item, { duration: state.intentDuration ?? item.duration });

  const saveBtn = el("button", {
    class: "save-btn",
    type: "button",
    "aria-pressed": String(isSaved(item.id)),
    "aria-label": isSaved(item.id) ? "Kaydedilenlerden çıkar" : "Kaydet",
    text: isSaved(item.id) ? "💚" : "🤍",
    onclick: () => {
      const nowSaved = toggleSaved(item.id);
      if (nowSaved) recordEvent("suggestion_saved", { id: item.id });
      saveBtn.setAttribute("aria-pressed", String(nowSaved));
      saveBtn.textContent = nowSaved ? "💚" : "🤍";
      saveBtn.setAttribute("aria-label", nowSaved ? "Kaydedilenlerden çıkar" : "Kaydet");
      updateSavedCount();
    },
  });

  const watchLink = el("a", {
    class: "watch-link",
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    text: "YouTube'da Ara ↗",
    onclick: () => {
      pushRecentIds([item.id]);
      recordEvent("suggestion_opened", { id: item.id });
    },
  });

  return el("article", { class: "card" }, [
    el("div", { class: "card-top" }, [
      el("h4", { text: item.title }),
      saveBtn,
    ]),
    el("p", { text: item.description }),
    el("p", { class: "why", text: item.why }),
    el("div", { class: "card-tags" }, [
      el("span", { class: "tag", text: categoryLabel(item.category) }),
      el("span", { class: "tag", text: DURATION_LABEL_SHORT[item.duration] }),
      el("span", { class: "tag", text: ENERGY_LABEL[item.energy] }),
    ]),
    el("div", { class: "card-actions" }, [watchLink]),
  ]);
}

function renderResults(container, items, source = null) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.appendChild(el("p", { class: "muted", text: "Bu filtrelerle eşleşen öneri bulunamadı. Farklı bir seçim dene." }));
    return;
  }
  items.forEach((item) => container.appendChild(renderCard(item)));
  pushRecentIds(items.map((i) => i.id));
  if (source) {
    recordRecommendations(items.map((i) => ({ kind: "item", id: i.id })), source);
  }
}

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

const TAB_IDS = ["foryou", "quick", "quiz", "categories", "shows", "library", "tips", "settings"];

const MOBILE_QUERY = "(max-width: 899px)";

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

function switchTab(tabId, options = {}) {
  TAB_IDS.forEach((id) => {
    const tabBtn = document.getElementById(`tab-${id}`);
    const panel = document.getElementById(`panel-${id}`);
    const active = id === tabId;
    tabBtn.setAttribute("aria-selected", String(active));
    tabBtn.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });

  if (tabId === "library") renderLibraryTab();
  if (tabId === "foryou") renderMemoryStatus();

  if (options.updateHash !== false && window.location.hash !== `#${tabId}`) {
    // Bölümler paylaşılabilir/yer imlenebilir olsun diye adres çubuğuna yazılır.
    history.replaceState(null, "", `#${tabId}`);
  }
  if (isMobileLayout()) setSidebarOpen(false);
  if (options.scrollTop !== false) window.scrollTo({ top: 0, behavior: "smooth" });
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

// ---------------------------------------------------------------------------
// Niyet kartı: süre seçimi + zamanlayıcı
// ---------------------------------------------------------------------------

function renderIntentDuration() {
  const container = document.getElementById("intentDuration");
  container.innerHTML = "";
  DURATIONS.forEach((d) => {
    const btn = el("button", {
      class: "chip",
      type: "button",
      "aria-pressed": String(state.intentDuration === d.id),
      text: `${d.emoji} ${d.label}`,
      onclick: () => {
        state.intentDuration = state.intentDuration === d.id ? null : d.id;
        renderIntentDuration();
      },
    });
    container.appendChild(btn);
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

// ---------------------------------------------------------------------------
// Sana Özel: hafızaya dayalı dinamik öneriler
// ---------------------------------------------------------------------------

/** Aynı düğmeye tekrar basınca yeni şeyler gelsin diye bu oturumda gösterilenler. */
const foryouShown = new Set();

function renderMemoryStatus() {
  const summaryEl = document.getElementById("memorySummary");
  const metaEl = document.getElementById("memoryMeta");
  const summary = memorySummary();
  const eventCount = getEvents().length;
  const watchedCount = getWatchedIds().length;

  if (summary) {
    summaryEl.textContent = summary;
    summaryEl.hidden = false;
  } else {
    summaryEl.textContent =
      "Hafızam henüz boş. Seçim yaptıkça, kaydettikçe ve “izledim” dedikçe öneriler sana göre şekillenecek.";
    summaryEl.hidden = false;
  }

  const bits = [];
  if (eventCount > 0) bits.push(`${eventCount} hareket`);
  if (watchedCount > 0) bits.push(`${watchedCount} izlenen yapım`);
  metaEl.textContent = bits.length > 0 ? bits.join(" · ") : "";
  document.getElementById("memoryReset").hidden = eventCount === 0 && watchedCount === 0;
}

function renderForYou() {
  const container = document.getElementById("foryouResults");
  const { picks, isStarter } = personalizedPicks({ limit: 6, exclude: foryouShown });

  container.innerHTML = "";

  if (picks.length === 0) {
    // Her şey gösterildi: listeyi sıfırlayıp baştan başla.
    foryouShown.clear();
    const retry = personalizedPicks({ limit: 6, exclude: foryouShown });
    retry.picks.forEach((pick) => addForYouCard(container, pick));
    retry.picks.forEach((pick) => foryouShown.add(pick.data.id));
    recordRecommendations(
      retry.picks.map((pick) => ({ kind: pick.kind, id: pick.data.id })),
      "foryou"
    );
  } else {
    picks.forEach((pick) => {
      addForYouCard(container, pick);
      foryouShown.add(pick.data.id);
    });
    recordRecommendations(
      picks.map((pick) => ({ kind: pick.kind, id: pick.data.id })),
      "foryou"
    );
  }

  maybeAutoRun("foryou");

  if (isStarter) {
    container.prepend(
      el("p", {
        class: "muted foryou-hint",
        text: "Bunlar başlangıç önerileri. Birkaç seçim yaptıktan sonra liste tamamen sana göre değişecek.",
      })
    );
  }
  renderMemoryStatus();
}

function addForYouCard(container, pick) {
  const card = pick.kind === "item" ? renderCard(pick.data) : renderShowCard(pick.data);
  card.prepend(el("p", { class: "reason-note", text: `✨ ${pick.reason}` }));
  container.appendChild(card);
}

/** LLM kartı: modelin ürettiği başlık/sorgu/gerekçe. */
function renderLlmCard(suggestion) {
  const url = buildSearchUrl(suggestion.query);
  const kindLabel = { video: "Video", dizi: "Dizi", film: "Film" }[suggestion.kind] ?? "Video";

  return el("article", { class: "card llm-card" }, [
    el("p", { class: "reason-note", text: `🤖 ${suggestion.why || "LLM önerisi"}` }),
    el("div", { class: "card-top" }, [el("h4", { text: suggestion.title })]),
    el("p", { class: "muted", text: `Arama: ${suggestion.query}` }),
    el("div", { class: "card-tags" }, [
      el("span", { class: "tag tag-llm", text: "LLM önerisi" }),
      el("span", { class: "tag", text: kindLabel }),
    ]),
    el("div", { class: "card-actions" }, [
      el("a", {
        class: "watch-link",
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "YouTube'da Ara ↗",
      }),
    ]),
  ]);
}

/**
 * Bir bölüme "LLM ile öner" davranışı bağlar.
 * Her bölüm kendi bağlamını (seçili ruh hali, kategori, filtreler…) modele verir.
 *
 * @param {{buttonId:string, resultsId:string, focus:"video"|"show"|"any",
 *          buildContext:()=>string, avoid?:()=>string[]}} options
 */
/** Bölüm anahtarı -> { runNow, autoRun } — otomatik tetikleme için kayıt defteri. */
const llmRunners = new Map();

function setupLlmSection({ key, buttonId, resultsId, focus, buildContext, avoid }) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  // Aynı arama için tekrar tekrar ücretli istek atılmasın.
  let lastContext = null;
  let inFlight = false;

  async function run({ auto = false } = {}) {
    if (!isLlmReady() || inFlight) return;

    // Bölümün kendi bağlamı + genel zevk profili birlikte gönderilir.
    const context = [buildContext(), memorySummary()].filter(Boolean).join("\n");
    if (auto && context === lastContext) return;
    lastContext = context;

    const container = document.getElementById(resultsId);
    const original = button.textContent;
    inFlight = true;
    button.disabled = true;
    button.textContent = "🤖 Düşünüyor…";
    container.innerHTML = "";
    container.appendChild(el("p", { class: "muted", text: "Yapay zekâdan öneriler isteniyor…" }));

    try {
      const suggestions = await generateLlmSuggestions(context, {
        count: getLlmConfig().count,
        avoid: avoid ? avoid() : [],
        focus,
      });

      container.innerHTML = "";
      if (suggestions.length === 0) {
        container.appendChild(
          el("p", { class: "muted", text: "Model bu sefer öneri üretemedi. Tekrar dene." })
        );
        return;
      }
      suggestions.forEach((suggestion) => container.appendChild(renderLlmCard(suggestion)));
      // LLM önerileri katalogda olmadığı için içeriği geçmişe birlikte yazılır.
      recordRecommendations(
        suggestions.map((suggestion) => ({
          kind: "llm",
          id: suggestion.query.toLowerCase().replace(/\s+/g, "-").slice(0, 60),
          payload: suggestion,
        })),
        "llm"
      );
    } catch (error) {
      // Otomatik denemede bağlamı serbest bırak ki kullanıcı elle tekrar deneyebilsin.
      lastContext = null;
      container.innerHTML = "";
      container.appendChild(
        el("p", {
          class: "form-status form-status-error",
          text: `LLM önerisi alınamadı: ${error.message}`,
        })
      );
    } finally {
      inFlight = false;
      button.disabled = false;
      button.textContent = original;
    }
  }

  button.addEventListener("click", () => {
    lastContext = null; // elle basıldıysa aynı bağlam olsa da yeniden üret
    run();
  });

  llmRunners.set(key, {
    runNow: run,
    // Filtre tıklamalarında arka arkaya istek gitmesin diye beklemeli.
    autoRun: debounce(() => run({ auto: true }), 900),
  });
}

/**
 * "Her aramada otomatik" açıksa, o bölümün LLM önerilerini de getirir.
 * Kapalıysa hiçbir şey yapmaz — istekler ücretli olduğu için varsayılan kapalıdır.
 */
function maybeAutoRun(key) {
  if (!isAutoSuggest()) return;
  llmRunners.get(key)?.autoRun();
}

/** Her LLM çubuğuna "her aramada otomatik" anahtarını ekler. */
function attachAutoToggle(bar) {
  const input = el("input", { type: "checkbox", class: "llm-auto-input" });
  input.checked = isAutoSuggest();
  input.addEventListener("change", () => {
    saveLlmConfig({ autoSuggest: input.checked });
    syncAutoToggles();
  });
  bar.appendChild(el("label", { class: "llm-auto" }, [input, el("span", { text: "Her aramada otomatik" })]));
}

/** Anahtarlar birden çok yerde olduğu için hepsini aynı değere çeker. */
function syncAutoToggles() {
  const on = getLlmConfig().autoSuggest;
  document.querySelectorAll(".llm-auto-input").forEach((input) => {
    input.checked = on;
  });
  const settingsToggle = document.getElementById("llmAuto");
  if (settingsToggle) settingsToggle.checked = on;
}

/** Kart başlıklarını "şunları önerme" listesi olarak toplar. */
function titlesIn(containerId) {
  return [...document.querySelectorAll(`#${containerId} h4`)].map((h) => h.textContent.trim());
}

function labelsFor(list, ids) {
  return ids.map((id) => list.find((x) => x.id === id)?.label).filter(Boolean);
}

/** Bütün bölümlerdeki LLM düğmelerini ayarlara göre gösterir/gizler. */
function refreshLlmAvailability() {
  const ready = isLlmReady();
  document.getElementById("foryouLlm").hidden = !ready;
  document.getElementById("llmBadge").hidden = !ready;
  document.querySelectorAll(".llm-bar").forEach((bar) => {
    bar.hidden = !ready;
  });
}

function initLlmSections() {
  // Sana Özel — hafıza profili
  setupLlmSection({
    key: "foryou",
    buttonId: "foryouLlm",
    resultsId: "foryouResults",
    focus: "any",
    buildContext: () => "",
    avoid: () => titlesIn("foryouResults"),
  });

  // Hızlı Seçim — seçili ruh hali + hedef
  setupLlmSection({
    key: "quick",
    buttonId: "quickLlm",
    resultsId: "quickLlmResults",
    focus: "video",
    buildContext: () => {
      const parts = [];
      const mood = MOODS.find((m) => m.id === state.quick.mood);
      const goal = GOALS.find((g) => g.id === state.quick.goal);
      const duration = DURATIONS.find((d) => d.id === state.intentDuration);
      if (mood) parts.push(`Şu an "${mood.label}" hissediyor.`);
      if (goal) parts.push(`Hedefi: "${goal.label}".`);
      if (duration) parts.push(`Ayırdığı süre: ${duration.label}.`);
      return parts.length > 0 ? parts.join(" ") : "Henüz bir seçim yapmadı.";
    },
    avoid: () => titlesIn("quickResults"),
  });

  // Kısa Test — test cevapları
  setupLlmSection({
    key: "quiz",
    buttonId: "quizLlm",
    resultsId: "quizLlmResults",
    focus: "video",
    buildContext: () => {
      const answers = state.quiz.answers;
      const parts = [];
      const mood = MOODS.find((m) => m.id === answers.mood);
      const goal = GOALS.find((g) => g.id === answers.goal);
      const duration = DURATIONS.find((d) => d.id === answers.duration);
      if (mood) parts.push(`Ruh hali: ${mood.label}.`);
      if (goal) parts.push(`Hedefi: ${goal.label}.`);
      if (duration) parts.push(`Süre: ${duration.label}.`);
      if (answers.energy) parts.push(`Enerjisi: ${answers.energy}.`);
      const cats = labelsFor(CATEGORIES, answers.categories ?? []);
      if (cats.length > 0) parts.push(`İlgi alanları: ${cats.join(", ")}.`);
      return parts.join(" ");
    },
    avoid: () => titlesIn("quizResults"),
  });

  // Kategoriler — seçili kategori
  setupLlmSection({
    key: "category",
    buttonId: "categoryLlm",
    resultsId: "categoryLlmResults",
    focus: "video",
    buildContext: () => {
      const category = CATEGORIES.find((c) => c.id === selectedCategory);
      return category
        ? `"${category.label}" kategorisine bakıyor. (${category.description})`
        : "Henüz kategori seçmedi; genel öneriler ver.";
    },
    avoid: () => titlesIn("categoryResults"),
  });

  // Dizi & Film — seçili filtreler
  setupLlmSection({
    key: "show",
    buttonId: "showLlm",
    resultsId: "showLlmResults",
    focus: "show",
    buildContext: () => {
      const parts = [];
      const add = (list, id, prefix) => {
        const found = list.find((x) => x.id === id);
        if (found) parts.push(`${prefix}: ${found.label}`);
      };
      add(SHOW_ERAS, showFilters.era, "Dönem");
      add(SHOW_GENRES, showFilters.genre, "Tür");
      add(SHOW_MOODS, showFilters.mood, "Hissettirmesi gereken");
      add(SHOW_ORIGINS, showFilters.origin, "Yapım");
      add(SHOW_TYPES, showFilters.type, "Biçim");
      add(SHOW_INTENSITIES, showFilters.intensity, "Yoğunluk");

      const watched = getWatchedIds().map((id) => getShowById(id)?.title).filter(Boolean);
      if (watched.length > 0) {
        parts.push(`Daha önce izledikleri: ${watched.slice(0, 15).join(", ")}`);
      }
      return parts.length > 0
        ? `Dizi/film arıyor. ${parts.join(". ")}.`
        : "Eski, klasik dizi ve film arıyor.";
    },
    avoid: () => [...titlesIn("showResults").slice(0, 20), ...titlesIn("showLlmResults")],
  });

  // Kütüphane — izlediklerine benzer
  setupLlmSection({
    key: "similar",
    buttonId: "similarLlm",
    resultsId: "similarLlmResults",
    focus: "show",
    buildContext: () => {
      const watched = getWatchedIds().map((id) => getShowById(id)?.title).filter(Boolean);
      return watched.length > 0
        ? `Şunları izledi ve beğendi: ${watched.slice(0, 20).join(", ")}. Bunlara benzer yapımlar öner.`
        : "Henüz izlediği bir yapım yok; klasik ve sakin yapımlar öner.";
    },
    avoid: () => [
      ...getWatchedIds().map((id) => getShowById(id)?.title).filter(Boolean),
      ...titlesIn("similarResults"),
    ],
  });

  document.querySelectorAll(".llm-bar").forEach(attachAutoToggle);
  syncAutoToggles();
}

function initForYouTab() {
  renderMemoryStatus();
  refreshLlmAvailability();

  document.getElementById("foryouGenerate").addEventListener("click", renderForYou);

  document.getElementById("historyClear").addEventListener("click", () => {
    if (!window.confirm("Geçmiş öneriler silinsin mi? Kaydettiklerin ve izlediklerin kalır.")) return;
    clearHistory();
    renderHistorySection();
    updateLibraryCount();
  });

  document.getElementById("memoryReset").addEventListener("click", () => {
    if (!window.confirm("Hafıza sıfırlansın mı? Seçim geçmişin silinir; kaydettiklerin ve izledikleri listesi kalır.")) return;
    clearMemory();
    foryouShown.clear();
    document.getElementById("foryouResults").innerHTML = "";
    renderMemoryStatus();
  });
}

// ---------------------------------------------------------------------------
// Hızlı Seçim sekmesi
// ---------------------------------------------------------------------------

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

function initQuickTab() {
  const submitBtn = document.getElementById("quickSubmit");

  function refreshSubmitState() {
    submitBtn.disabled = !state.quick.mood && !state.quick.goal;
  }

  renderSingleChoiceGroup(
    "quickMoods",
    MOODS,
    (m) => `${m.emoji} ${m.label}`,
    () => state.quick.mood,
    (val) => {
      state.quick.mood = val;
      refreshSubmitState();
    }
  );
  renderSingleChoiceGroup(
    "quickGoals",
    GOALS,
    (g) => `${g.emoji} ${g.label}`,
    () => state.quick.goal,
    (val) => {
      state.quick.goal = val;
      refreshSubmitState();
    }
  );

  refreshSubmitState();

  submitBtn.addEventListener("click", () => {
    if (state.quick.mood) recordEvent("mood_selected", { value: state.quick.mood });
    if (state.quick.goal) recordEvent("goal_selected", { value: state.quick.goal });

    const profile = {
      moods: state.quick.mood ? [state.quick.mood] : [],
      goals: state.quick.goal ? [state.quick.goal] : [],
      duration: state.intentDuration,
    };
    const results = recommend(profile);
    renderResults(document.getElementById("quickResults"), results, "quick");
    maybeAutoRun("quick");
  });
}

// ---------------------------------------------------------------------------
// Kısa Test sekmesi
// ---------------------------------------------------------------------------

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

function finishQuiz() {
  document.getElementById("quizContainer").hidden = true;
  const resultWrap = document.getElementById("quizResultWrap");
  resultWrap.hidden = false;

  saveQuizProfile(state.quiz.answers);
  Object.entries(state.quiz.answers).forEach(([key, value]) => {
    [].concat(value).forEach((v) => recordEvent("quiz_answer", { key, value: v }));
  });
  document.getElementById("quizSummary").textContent = summarizeProfile(state.quiz.answers);

  const profile = answersToProfile(state.quiz.answers);
  const results = recommend(profile);
  renderResults(document.getElementById("quizResults"), results, "quiz");
  maybeAutoRun("quiz");
}

function resetQuiz() {
  state.quiz = { index: 0, answers: {} };
  document.getElementById("quizContainer").hidden = false;
  document.getElementById("quizResultWrap").hidden = true;
  renderQuizQuestion();
  updateQuizNav();
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
}

// ---------------------------------------------------------------------------
// Kategoriler sekmesi
// ---------------------------------------------------------------------------

let selectedCategory = null;

function initCategoriesTab() {
  const chipsContainer = document.getElementById("categoryChips");

  function render() {
    chipsContainer.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const btn = el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(selectedCategory === cat.id),
        text: `${cat.emoji} ${cat.label}`,
        onclick: () => {
          selectedCategory = selectedCategory === cat.id ? null : cat.id;
          if (selectedCategory) recordEvent("category_browsed", { value: selectedCategory });
          render();
          renderCategoryResults();
        },
      });
      chipsContainer.appendChild(btn);
    });
  }

  function renderCategoryResults() {
    const container = document.getElementById("categoryResults");
    if (!selectedCategory) {
      container.innerHTML = "";
      container.appendChild(el("p", { class: "muted", text: "Bir kategori seç, önerileri burada gör." }));
      return;
    }
    const items = listByCategory(selectedCategory, { duration: state.intentDuration });
    renderResults(container, items, "category");
    maybeAutoRun("category");
  }

  render();
  renderCategoryResults();
}

// ---------------------------------------------------------------------------
// Dizi & Film sekmesi
// ---------------------------------------------------------------------------

const showFilters = { era: null, genre: null, mood: null, origin: null, type: null, intensity: null };

const INTENSITY_LABEL = Object.fromEntries(SHOW_INTENSITIES.map((i) => [i.id, i.label]));

function labelOf(list, id) {
  return list.find((x) => x.id === id)?.label ?? id;
}

/** Dizi/film kartı. `note` verilirse "neden önerildi" satırı gösterilir. */
function renderShowCard(show, note = null) {
  const url = buildSearchUrl(show.queryTr);
  const watched = isWatched(show.id);
  const savedShow = isShowSaved(show.id);

  const watchedBtn = el("button", {
    class: "btn btn-secondary btn-small watched-toggle",
    type: "button",
    "aria-pressed": String(watched),
    text: watched ? "✅ İzledim" : "＋ İzledim",
    onclick: () => {
      const nowWatched = toggleWatched(show.id);
      if (nowWatched) recordEvent("show_watched", { id: show.id });
      updateLibraryCount();
      refreshShowResults();
      if (!document.getElementById("panel-library").hidden) renderLibraryTab();
    },
  });

  const saveShowBtn = el("button", {
    class: "save-btn",
    type: "button",
    "aria-pressed": String(savedShow),
    "aria-label": savedShow ? "İzleme listesinden çıkar" : "İzleme listeme ekle",
    text: savedShow ? "🔖" : "📑",
    onclick: () => {
      const nowSaved = toggleSavedShow(show.id);
      if (nowSaved) recordEvent("show_saved", { id: show.id });
      saveShowBtn.setAttribute("aria-pressed", String(nowSaved));
      saveShowBtn.textContent = nowSaved ? "🔖" : "📑";
      saveShowBtn.setAttribute("aria-label", nowSaved ? "İzleme listesinden çıkar" : "İzleme listeme ekle");
      updateLibraryCount();
      if (!document.getElementById("panel-library").hidden) renderLibraryTab();
    },
  });

  const tags = [
    el("span", { class: "tag", text: show.yearLabel }),
    el("span", { class: "tag", text: labelOf(SHOW_TYPES, show.type) }),
    ...show.genres.slice(0, 2).map((g) => el("span", { class: "tag", text: labelOf(SHOW_GENRES, g) })),
    el("span", { class: `tag intensity-${show.intensity}`, text: INTENSITY_LABEL[show.intensity] }),
  ];

  if (isCustomShow(show.id)) {
    tags.unshift(el("span", { class: "tag tag-custom", text: "senin eklediğin" }));
  }

  const actions = [
    el("a", {
      class: "watch-link",
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      text: "YouTube'da Ara ↗",
      onclick: () => recordEvent("show_opened", { id: show.id }),
    }),
    watchedBtn,
  ];

  if (isCustomShow(show.id)) {
    actions.push(
      el("button", {
        class: "btn btn-ghost btn-small delete-btn",
        type: "button",
        "aria-label": `${show.title} kaydını listemden sil`,
        text: "🗑️",
        onclick: () => {
          if (!window.confirm(`"${show.title}" listenden silinsin mi?`)) return;
          removeCustomShow(show.id);
          updateLibraryCount();
          refreshShowResults();
          if (!document.getElementById("panel-library").hidden) renderLibraryTab();
        },
      })
    );
  }

  return el("article", { class: `card show-card${watched ? " is-watched" : ""}` }, [
    note ? el("p", { class: "reason-note", text: `✨ ${note}` }) : null,
    createThumb(show),
    el("div", { class: "card-top" }, [
      el("h4", { text: show.title }),
      saveShowBtn,
    ]),
    el("p", { text: show.description }),
    el("p", { class: "why", text: show.why }),
    el("div", { class: "card-tags" }, tags),
    el("div", { class: "card-actions" }, actions),
  ]);
}

function renderShowChipGroup(containerId, options, filterKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  options.forEach((opt) => {
    const selected = showFilters[filterKey] === opt.id;
    container.appendChild(
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(selected),
        text: opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label,
        onclick: () => {
          showFilters[filterKey] = selected ? null : opt.id;
          renderAllShowChips();
          refreshShowResults();
        },
      })
    );
  });
}

function renderAllShowChips() {
  renderShowChipGroup("showEraChips", SHOW_ERAS, "era");
  renderShowChipGroup("showGenreChips", SHOW_GENRES, "genre");
  renderShowChipGroup("showMoodChips", SHOW_MOODS, "mood");
  renderShowChipGroup("showOriginChips", SHOW_ORIGINS, "origin");
  renderShowChipGroup("showTypeChips", SHOW_TYPES, "type");
  renderShowChipGroup("showIntensityChips", SHOW_INTENSITIES, "intensity");
}

function refreshShowResults(customList = null) {
  const container = document.getElementById("showResults");
  const results = customList ?? filterShows(showFilters);

  document.getElementById("showResultCount").textContent =
    customList ? "" : `${results.length} yapım`;

  container.innerHTML = "";
  if (results.length === 0) {
    container.appendChild(
      el("p", { class: "muted", text: "Bu filtrelerle eşleşen yapım yok. Bir filtreyi kaldırıp tekrar dene." })
    );
    return;
  }
  results.forEach((show) => container.appendChild(renderShowCard(show)));
  maybeAutoRun("show");
}

// ---------------------------------------------------------------------------
// "Kendi dizini ekle" formu
// ---------------------------------------------------------------------------

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

    const result = addCustomShow({
      title,
      year: data.get("year"),
      videoId: data.get("videoId"),
      type: data.get("type"),
      origin: data.get("origin"),
      intensity: data.get("intensity"),
      description: data.get("description"),
      genres: [...formSelection.genres],
      moods: [...formSelection.moods],
    });

    if (!result.ok) {
      setFormStatus(result.error, "error");
      return;
    }

    form.reset();
    formSelection.genres = [];
    formSelection.moods = [];
    renderFormChips("fGenreChips", SHOW_GENRES, "genres");
    renderFormChips("fMoodChips", SHOW_MOODS, "moods");

    setFormStatus(`"${result.show.title}" listene eklendi ✅`, "success");
    Object.keys(showFilters).forEach((k) => {
      showFilters[k] = null;
    });
    renderAllShowChips();
    refreshShowResults();
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
  renderAllShowChips();
  initAddShowForm();
  refreshShowResults();

  document.getElementById("showClearFilters").addEventListener("click", () => {
    Object.keys(showFilters).forEach((k) => {
      showFilters[k] = null;
    });
    renderAllShowChips();
    refreshShowResults();
  });

  document.getElementById("showRandom").addEventListener("click", () => {
    const pool = filterShows(showFilters).filter((s) => !isWatched(s.id));
    const source = pool.length > 0 ? pool : filterShows(showFilters);
    if (source.length === 0) {
      refreshShowResults();
      return;
    }
    const pick = source[Math.floor(Math.random() * source.length)];
    refreshShowResults([pick]);
    document.getElementById("showResultCount").textContent = "Rastgele seçildi";
  });
}

// ---------------------------------------------------------------------------
// Kütüphanem sekmesi
// ---------------------------------------------------------------------------

function updateLibraryCount() {
  const count = getWatchedIds().length + getSavedShowIds().length + getSavedIds().length;
  const badge = document.getElementById("libraryCount");
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

/** Geriye dönük uyumluluk: öneri kartındaki kaydet düğmesi bunu çağırıyor. */
function updateSavedCount() {
  updateLibraryCount();
}

function renderWatchedSection() {
  const watchedIds = getWatchedIds();
  const shows = watchedIds.map(getShowById).filter(Boolean);
  const container = document.getElementById("watchedResults");
  const emptyMsg = document.getElementById("watchedEmpty");
  const summary = document.getElementById("watchedSummary");

  emptyMsg.hidden = shows.length > 0;
  container.innerHTML = "";
  shows.forEach((show) => container.appendChild(renderShowCard(show)));

  const stats = watchedStats(watchedIds);
  if (!stats) {
    summary.textContent = "";
    return;
  }
  const parts = [`${stats.total} yapım işaretledin`];
  if (stats.diziCount && stats.filmCount) parts.push(`${stats.diziCount} dizi, ${stats.filmCount} film`);
  if (stats.topGenre) parts.push(`en çok ${labelOf(SHOW_GENRES, stats.topGenre).toLowerCase()} izliyorsun`);
  summary.textContent = `${parts.join(" · ")}.`;
}

function renderSimilarSection() {
  const section = document.getElementById("similarSection");
  const container = document.getElementById("similarResults");
  const suggestions = similarToWatched(getWatchedIds(), { limit: 6 });

  // LLM açıksa bölüm, henüz izlenen yapım olmasa da erişilebilir kalsın —
  // düğme oradadır ve model izleme geçmişi olmadan da öneri üretebilir.
  const hasWatched = getWatchedIds().length > 0;
  section.hidden = suggestions.length === 0 && !isLlmReady();

  document.getElementById("similarHeading").textContent = hasWatched
    ? "✨ Bunları izledin — bir de şunlara bak"
    : "✨ Dizi & film önerileri";
  document.getElementById("similarIntro").textContent = hasWatched
    ? "İzleme geçmişine göre seçildi."
    : "Bir yapıma “izledim” dedikçe buradaki öneriler sana göre şekillenir.";

  container.innerHTML = "";
  suggestions.forEach(({ show, reason }) => container.appendChild(renderShowCard(show, reason)));
  maybeAutoRun("similar");
  recordRecommendations(
    suggestions.map(({ show }) => ({ kind: "show", id: show.id })),
    "similar"
  );
}

function renderWatchlistSection() {
  const shows = getSavedShowIds().map(getShowById).filter(Boolean);
  const container = document.getElementById("watchlistResults");
  document.getElementById("watchlistEmpty").hidden = shows.length > 0;
  container.innerHTML = "";
  shows.forEach((show) => container.appendChild(renderShowCard(show)));
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

/** Geçmiş kaydını, türüne uygun kart olarak çizer ve altına kaynak/tarih satırı ekler. */
function renderHistoryCard(entry) {
  const { resolved } = entry;
  let card;

  if (entry.kind === "llm") {
    card = renderLlmCard(resolved);
  } else if (entry.kind === "item") {
    card = renderCard(resolved.item);
  } else {
    card = renderShowCard(resolved.show);
  }

  const bits = [SOURCE_LABELS[entry.source] ?? entry.source, formatHistoryDate(entry.at)];
  if ((entry.count ?? 1) > 1) bits.push(`${entry.count} kez önerildi`);
  card.appendChild(el("p", { class: "history-meta muted", text: bits.join(" · ") }));

  return card;
}

function renderHistorySection() {
  const groups = groupedHistory();
  const container = document.getElementById("historyGroups");
  const emptyMsg = document.getElementById("historyEmpty");
  const summary = document.getElementById("historySummary");
  const clearBtn = document.getElementById("historyClear");

  container.innerHTML = "";
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  emptyMsg.hidden = total > 0;
  clearBtn.hidden = total === 0;
  summary.textContent =
    total > 0 ? `${total} öneri, ${groups.length} kategoride toplandı.` : "";

  groups.forEach((group, index) => {
    const details = el("details", { class: "history-group" });
    // En kalabalık kategori açık gelsin, kalanlar kapalı dursun.
    if (index === 0) details.open = true;

    details.appendChild(
      el("summary", {}, [
        el("span", { class: "history-group-title", text: `${group.emoji} ${group.label}` }),
        el("span", { class: "badge badge-soft", text: String(group.entries.length) }),
      ])
    );

    const grid = el("div", { class: "results-grid" });
    group.entries.forEach((entry) => grid.appendChild(renderHistoryCard(entry)));
    details.appendChild(grid);
    container.appendChild(details);
  });
}

function renderSavedSuggestionsSection() {
  const items = getSavedIds().map((id) => getItemById(id)).filter(Boolean);
  const container = document.getElementById("savedResults");
  document.getElementById("savedEmpty").hidden = items.length > 0;
  container.innerHTML = "";
  items.forEach((item) => container.appendChild(renderCard(item)));
}

function renderLibraryTab() {
  renderWatchedSection();
  renderSimilarSection();
  renderWatchlistSection();
  renderHistorySection();
  renderSavedSuggestionsSection();
}

// ---------------------------------------------------------------------------
// Ayarlar: LLM servisi ve API anahtarı
// ---------------------------------------------------------------------------

function setLlmStatus(message, kind = "info") {
  const status = document.getElementById("llmStatus");
  status.textContent = message;
  status.className = `form-status form-status-${kind}`;
}

function syncLlmFormFromConfig() {
  const config = getLlmConfig();
  const provider = getProvider(config.provider);

  document.getElementById("llmEnabled").checked = config.enabled;
  document.getElementById("llmAuto").checked = config.autoSuggest;
  document.getElementById("llmProvider").value = config.provider;
  document.getElementById("llmModel").value = config.model;
  document.getElementById("llmModel").placeholder = provider.defaultModel;
  document.getElementById("llmCount").value = config.count;

  const keyInput = document.getElementById("llmKey");
  keyInput.value = "";
  keyInput.placeholder = config.apiKey ? maskKey(config.apiKey) : provider.keyPlaceholder;

  document.getElementById("llmKeyState").textContent = config.apiKey
    ? `Kayıtlı anahtar: ${maskKey(config.apiKey)} — değiştirmek için yenisini yaz. `
    : "Henüz anahtar kaydedilmedi. ";

  const link = document.getElementById("llmKeysLink");
  link.href = provider.keysUrl;

  refreshLlmAvailability();
}

function initSettingsTab() {
  const providerSelect = document.getElementById("llmProvider");
  providerSelect.innerHTML = "";
  PROVIDERS.forEach((provider) => {
    providerSelect.appendChild(el("option", { value: provider.id, text: provider.label }));
  });

  syncLlmFormFromConfig();

  providerSelect.addEventListener("change", () => {
    // Servis değişince model alanını yeni servisin varsayılanına çek.
    const provider = getProvider(providerSelect.value);
    document.getElementById("llmModel").value = provider.defaultModel;
    document.getElementById("llmModel").placeholder = provider.defaultModel;
    document.getElementById("llmKey").placeholder = provider.keyPlaceholder;
    document.getElementById("llmKeysLink").href = provider.keysUrl;
  });

  document.getElementById("llmForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const typedKey = document.getElementById("llmKey").value.trim();
    const enabled = document.getElementById("llmEnabled").checked;
    const existingKey = getLlmConfig().apiKey;

    if (enabled && !typedKey && !existingKey) {
      setLlmStatus("Etkinleştirmek için önce bir API anahtarı gir.", "error");
      return;
    }

    const patch = {
      enabled,
      autoSuggest: document.getElementById("llmAuto").checked,
      provider: providerSelect.value,
      model: document.getElementById("llmModel").value.trim(),
      count: Math.min(12, Math.max(3, Number(document.getElementById("llmCount").value) || 6)),
    };
    // Alan boşsa mevcut anahtar korunur.
    if (typedKey) patch.apiKey = typedKey;

    saveLlmConfig(patch);
    syncLlmFormFromConfig();
    syncAutoToggles();
    setLlmStatus("Ayarlar kaydedildi ✅", "success");
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
    if (!window.confirm("Kayıtlı API anahtarı silinsin mi? LLM önerileri de kapatılır.")) return;
    clearApiKey();
    syncLlmFormFromConfig();
    setLlmStatus("Anahtar silindi.", "info");
  });
}

// ---------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------

function init() {
  renderIntentDuration();
  initTimer();
  initTabs();
  initQuickTab();
  initQuizTab();
  initCategoriesTab();
  initShowsTab();
  initForYouTab();
  initLlmSections();
  initSettingsTab();
  updateLibraryCount();

  const previousProfile = getQuizProfile();
  if (previousProfile) {
    state.quiz.answers = { ...previousProfile };
  }
}

document.addEventListener("DOMContentLoaded", init);
