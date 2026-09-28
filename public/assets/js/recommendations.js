// "Sana Özel" → kişisel video önerileri (/api/recommend).
// Profil benzerliği × kalite, dil filtresi, ~%15 keşif sunucuda. Buradaki oturum bağlamı
// (ruh hali, hedef, süre) sitenin mevcut seçimlerinden gelir ve yalnızca bu istek için geçerlidir.

import { el } from "./dom.js";
import { renderVideoCard, observeImpressions, stopPreview } from "./videoCards.js";
import { MOODS, GOALS, DURATIONS } from "./data.js";

const COUNT = 12;
const state = { loaded: false, loading: false, observer: null, sessionKey: null, getSession: () => ({}) };

const labelOf = (list, id) => list.find((x) => x.id === id)?.label;

function setStatus(text, kind = "") {
  const status = document.getElementById("recoStatus");
  status.textContent = text;
  status.className = kind ? `form-status form-status-${kind}` : "form-status";
}

function renderContext(session) {
  const parts = [labelOf(MOODS, session.mood), labelOf(GOALS, session.goal), labelOf(DURATIONS, session.duration)].filter(Boolean);
  const box = document.getElementById("recoContext");
  box.hidden = parts.length === 0;
  box.textContent = parts.length ? `Bu oturum için: ${parts.join(" · ")} — profilin değişmez, yalnızca bu öneriler süzülür.` : "";
}

function renderCards(cards) {
  const grid = document.getElementById("recoGrid");
  stopPreview("refresh");
  state.observer?.disconnect();
  grid.innerHTML = "";
  cards.forEach((card, i) => {
    const extra = [
      el("p", { class: `reco-reason${card.explore ? " is-explore" : ""}`, text: card.explore ? `🧭 ${card.reason}` : card.reason }),
    ];
    grid.appendChild(renderVideoCard(card, {
      surface: "foryou",
      position: i,
      extra,
      onError: (message) => setStatus(`⚠️ ${message}`, "error"),
    }));
  });
  state.observer = observeImpressions(grid, { surface: "foryou" });
}

export async function loadRecommendations({ force = false } = {}) {
  const session = state.getSession();
  const key = JSON.stringify(session);
  // Oturum bağlamı (ruh hali, hedef, süre) değiştiyse yeniden yükle
  if (state.loading || (state.loaded && !force && key === state.sessionKey)) return;
  state.sessionKey = key;
  const section = document.getElementById("recoSection");
  state.loading = true;
  document.getElementById("recoRefresh").disabled = true;
  setStatus("Senin için seçiliyor…");
  renderContext(session);
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ count: COUNT, ...session }),
    });
    if (!response.ok) throw new Error(response.status === 404 ? "sunucu yok" : `Sunucu hatası (${response.status})`);
    const data = await response.json();
    section.hidden = false;
    const empty = document.getElementById("recoEmpty");
    if (data.needsOnboarding || data.cards.length === 0) {
      empty.hidden = false;
      document.getElementById("recoEmptyText").textContent = data.needsOnboarding
        ? "Birkaç kısa turda neyi sevdiğini görelim; öneriler buna göre gelsin."
        : "Şu an sana uygun yeni video kalmadı. Havuz büyüdükçe burada yenileri çıkacak.";
      renderCards([]);
      setStatus("");
    } else {
      empty.hidden = true;
      renderCards(data.cards);
      const explore = data.cards.filter((c) => c.explore).length;
      setStatus(
        data.status.hasVector
          ? `İzleme davranışından öğrendiklerine göre ${data.cards.length} video (${explore} tanesi keşif).`
          : `${data.cards.length} video — izledikçe öneriler sana daha çok benzeyecek.`
      );
    }
    state.loaded = true;
  } catch (err) {
    // Sunucu yoksa (ör. yerel statik sunucu) bölüm gizli kalır; site arama önerileriyle çalışmaya devam eder
    if (err.message === "sunucu yok" || err instanceof TypeError) section.hidden = true;
    else setStatus(`⚠️ ${err.message}`, "error");
  } finally {
    state.loading = false;
    document.getElementById("recoRefresh").disabled = false;
  }
}

/** @param {{getSession: () => ({mood?, goal?, duration?})}} options */
export function initRecommendations({ getSession }) {
  state.getSession = getSession;
  document.getElementById("recoRefresh").addEventListener("click", () => loadRecommendations({ force: true }));
  // Onboarding bittiğinde bir sonraki açılışta yeniden yüklensin
  document.addEventListener("yl:onboarding-round", (e) => {
    if (e.detail?.done) state.loaded = false;
  });
}
