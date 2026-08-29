import { CATEGORIES, MOODS, GOALS, DURATIONS } from "./data.js";
import { buildSearchUrlForItem } from "./youtube.js";
import { recommend, listByCategory, getDailyPick, getItemById } from "./recommend.js";
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
    onclick: () => pushRecentIds([item.id]),
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

function renderResults(container, items) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.appendChild(el("p", { class: "muted", text: "Bu filtrelerle eşleşen öneri bulunamadı. Farklı bir seçim dene." }));
    return;
  }
  items.forEach((item) => container.appendChild(renderCard(item)));
  pushRecentIds(items.map((i) => i.id));
}

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

const TAB_IDS = ["quick", "quiz", "categories", "shows", "library"];

function switchTab(tabId) {
  TAB_IDS.forEach((id) => {
    const tabBtn = document.getElementById(`tab-${id}`);
    const panel = document.getElementById(`panel-${id}`);
    const active = id === tabId;
    tabBtn.setAttribute("aria-selected", String(active));
    tabBtn.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
  if (tabId === "library") renderLibraryTab();
}

function initTabs() {
  const tabList = document.querySelector('[role="tablist"]');
  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).addEventListener("click", () => switchTab(id));
  });
  tabList.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const currentIndex = TAB_IDS.findIndex(
      (id) => document.getElementById(`tab-${id}`).getAttribute("aria-selected") === "true"
    );
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + dir + TAB_IDS.length) % TAB_IDS.length;
    const nextId = TAB_IDS[nextIndex];
    switchTab(nextId);
    document.getElementById(`tab-${nextId}`).focus();
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
// Bugünün önerisi
// ---------------------------------------------------------------------------

function renderDailyPick() {
  const container = document.getElementById("dailyPick");
  const item = getDailyPick();
  const url = buildSearchUrlForItem(item, { duration: item.duration });

  container.innerHTML = "";
  container.appendChild(
    el("div", { class: "daily-pick-card" }, [
      el("div", {}, [
        el("p", { class: "label", text: "🌞 Bugünün önerisi" }),
        el("h3", { text: item.title }),
        el("p", { text: item.description }),
      ]),
      el("a", {
        class: "watch-link",
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "YouTube'da Ara ↗",
        onclick: () => pushRecentIds([item.id]),
      }),
    ])
  );
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
    const profile = {
      moods: state.quick.mood ? [state.quick.mood] : [],
      goals: state.quick.goal ? [state.quick.goal] : [],
      duration: state.intentDuration,
    };
    const results = recommend(profile);
    renderResults(document.getElementById("quickResults"), results);
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
  document.getElementById("quizSummary").textContent = summarizeProfile(state.quiz.answers);

  const profile = answersToProfile(state.quiz.answers);
  const results = recommend(profile);
  renderResults(document.getElementById("quizResults"), results);
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
    renderResults(container, items);
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
      toggleWatched(show.id);
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

  return el("article", { class: `card show-card${watched ? " is-watched" : ""}` }, [
    note ? el("p", { class: "reason-note", text: `✨ ${note}` }) : null,
    el("div", { class: "card-top" }, [
      el("h4", { text: show.title }),
      saveShowBtn,
    ]),
    el("p", { text: show.description }),
    el("p", { class: "why", text: show.why }),
    el("div", { class: "card-tags" }, tags),
    el("div", { class: "card-actions" }, [
      el("a", {
        class: "watch-link",
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "YouTube'da Ara ↗",
      }),
      watchedBtn,
    ]),
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
}

function initShowsTab() {
  renderAllShowChips();
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

  section.hidden = suggestions.length === 0;
  container.innerHTML = "";
  suggestions.forEach(({ show, reason }) => container.appendChild(renderShowCard(show, reason)));
}

function renderWatchlistSection() {
  const shows = getSavedShowIds().map(getShowById).filter(Boolean);
  const container = document.getElementById("watchlistResults");
  document.getElementById("watchlistEmpty").hidden = shows.length > 0;
  container.innerHTML = "";
  shows.forEach((show) => container.appendChild(renderShowCard(show)));
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
  renderSavedSuggestionsSection();
}

// ---------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------

function init() {
  renderDailyPick();
  renderIntentDuration();
  initTimer();
  initTabs();
  initQuickTab();
  initQuizTab();
  initCategoriesTab();
  initShowsTab();
  updateLibraryCount();

  const previousProfile = getQuizProfile();
  if (previousProfile) {
    state.quiz.answers = { ...previousProfile };
  }
}

document.addEventListener("DOMContentLoaded", init);
