// "Beni tanı" — onboarding.
// Adım 1: dil tercihi (bu dosya). Sonraki adımlar (video turları) Aşama 4'te eklenir.

import { el } from "./dom.js";
import { getProfile, saveLanguages, setTracking } from "./profileApi.js";

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
    setStatus("Kaydedildi ✅ Dil tercihlerin profiline işlendi.", "success");
    writeDismissed();
    document.dispatchEvent(new CustomEvent("yl:onboarding-step", { detail: { step: "languages" } }));
  } catch (err) {
    setStatus(`⚠️ ${err.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function renderPanel() {
  const unavailable = document.getElementById("onbUnavailable");
  const form = document.getElementById("onbLangForm");
  const profile = await getProfile({ refresh: true });
  state.profile = profile;
  unavailable.hidden = Boolean(profile);
  form.hidden = !profile;
  if (profile) renderLanguageStep();
}

export function initOnboarding({ switchTab }) {
  switchTabRef = switchTab;
  document.getElementById("onbLangForm").addEventListener("submit", submitLanguages);
  document.getElementById("onbSkip").addEventListener("click", () => {
    writeDismissed();
    switchTabRef("foryou");
  });
  document.getElementById("tab-onboarding").addEventListener("click", renderPanel);
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
