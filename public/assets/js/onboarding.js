// "Beni tanı" — onboarding.
// Adım 1: dil tercihi. Adım 2: 3-4 tur video ızgarası; seçim istemeden, önizleme ve izleme
// davranışından (örtük sinyaller) öğrenir. Kart seçimi sunucuda Thompson sampling ile yapılır.

import { el } from "./dom.js";
import { getProfile, saveLanguages, setTracking } from "./profileApi.js";
import { setTrackingEnabled } from "./events.js";
import { renderVideoCard, observeImpressions, stopPreview } from "./videoCards.js";

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

const round = { number: 0, total: 4, cards: [], observer: null };

function showStep(step) {
  document.getElementById("onbLangForm").hidden = step !== "languages";
  document.getElementById("onbRounds").hidden = step !== "rounds";
  document.getElementById("onbDone").hidden = step !== "done";
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
    grid.appendChild(renderVideoCard(card, {
      surface: "onboarding",
      round: data.round,
      position: i,
      onError: (message) => setRoundStatus(`⚠️ ${message}`, "error"),
    }));
  });
  document.getElementById("onbNext").textContent = data.round >= (data.minRounds ?? 3) ? "Devam →" : "Sonraki tur →";
  round.observer?.disconnect();
  round.observer = observeImpressions(grid, { surface: "onboarding", round: data.round });
}

async function nextRound() {
  stopPreview("next");
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
