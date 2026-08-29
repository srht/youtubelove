// Kullanıcının formdan eklediği dizi/filmler. Tarayıcıda (localStorage) saklanır,
// katalogdaki yerleşik yapımlarla aynı şekilde filtrelenir ve önerilir.

const KEY = "yl_custom_shows_v1";
const memoryFallback = new Map();

function readAll() {
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = memoryFallback.get(KEY) ?? null;
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  const payload = JSON.stringify(list);
  try {
    window.localStorage.setItem(KEY, payload);
  } catch {
    memoryFallback.set(KEY, payload);
  }
}

/** Başlıktan url-dostu bir id üretir; çakışma olursa sonuna sayı ekler. */
function makeId(title, existingIds) {
  const base =
    "custom-" +
    (title || "yapim")
      .toLowerCase()
      .replace(/ı/g, "i").replace(/İ/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
      .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "yapim";

  let id = base;
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

/**
 * YouTube bağlantısından ya da düz metinden 11 karakterlik video kimliğini çıkarır.
 * Desteklenen: youtu.be/ID, /watch?v=ID, /embed/ID, /shorts/ID veya doğrudan ID.
 */
export function extractVideoId(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;

  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return null;
}

/** Formdan gelen ham veriyi katalog kaydı biçimine çevirir. */
function normalize(draft, existingIds) {
  const title = (draft.title ?? "").trim();
  const year = Number.parseInt(draft.year, 10);
  const hasYear = Number.isFinite(year) && year > 1900 && year < 2100;

  return {
    id: makeId(title, existingIds),
    title,
    startYear: hasYear ? year : null,
    yearLabel: hasYear ? String(year) : "Yıl belirtilmedi",
    type: draft.type === "film" ? "film" : "dizi",
    origin: draft.origin === "turk" ? "turk" : "yabanci",
    genres: Array.isArray(draft.genres) ? draft.genres : [],
    moods: Array.isArray(draft.moods) ? draft.moods : [],
    intensity: ["hafif", "orta", "agir"].includes(draft.intensity) ? draft.intensity : "orta",
    description: (draft.description ?? "").trim() || "Kendi eklediğin yapım.",
    why: (draft.why ?? "").trim() || "Bu yapımı sen seçtin — listende olmasının bir sebebi vardır.",
    queryTr: (draft.queryTr ?? "").trim() || `${title} ${draft.type === "film" ? "filmi" : "dizisi"}`,
    videoId: extractVideoId(draft.videoId),
    similar: [],
    custom: true,
    addedAt: new Date().toISOString(),
  };
}

export function getCustomShows() {
  return readAll();
}

export function getCustomShowIds() {
  return readAll().map((s) => s.id);
}

/**
 * Yeni yapım ekler.
 * @returns {{ok: true, show: object} | {ok: false, error: string}}
 */
export function addCustomShow(draft) {
  const title = (draft.title ?? "").trim();
  if (!title) return { ok: false, error: "Başlık boş olamaz." };

  const list = readAll();
  if (list.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
    return { ok: false, error: "Bu başlık zaten listende var." };
  }

  const show = normalize(draft, list.map((s) => s.id));
  list.unshift(show);
  writeAll(list);
  return { ok: true, show };
}

export function removeCustomShow(id) {
  const list = readAll().filter((s) => s.id !== id);
  writeAll(list);
}

export function isCustomShow(id) {
  return typeof id === "string" && id.startsWith("custom-");
}
