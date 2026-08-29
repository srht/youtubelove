// Kart kapak görselleri.
// Video kimliği varsa YouTube'un açık küçük resim adresi kullanılır (API gerekmez).
// Yoksa başlıktan üretilen, her yapım için sabit renkli bir döşeme çizilir.

const PALETTE = [
  ["#2f8f5b", "#1c5f3a"],
  ["#3b6ea5", "#22456b"],
  ["#8a5a3b", "#5c3a24"],
  ["#6d5aa8", "#443872"],
  ["#a8544f", "#6e3532"],
  ["#3f7f7a", "#265350"],
  ["#8a7a35", "#5b5023"],
  ["#7a4a72", "#4e2f4a"],
];

export function thumbUrlFor(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Başlıktan en fazla iki harflik bir kısaltma üretir ("The Wire" → "TW"). */
function initialsOf(title) {
  const words = (title ?? "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !["the", "a", "an", "of", "ve", "bir"].includes(w.toLowerCase()));

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("tr-TR");
  return (words[0][0] + words[1][0]).toLocaleUpperCase("tr-TR");
}

/**
 * Bir yapım için kapak öğesi üretir.
 * Gerçek küçük resim yüklenemezse otomatik olarak üretilmiş döşemeye düşer.
 * @param {object} show
 * @returns {HTMLElement}
 */
export function createThumb(show) {
  const wrap = document.createElement("div");
  wrap.className = "card-thumb";

  const [from, to] = PALETTE[hashString(show.id ?? show.title ?? "") % PALETTE.length];
  wrap.style.background = `linear-gradient(135deg, ${from}, ${to})`;

  const fallback = document.createElement("div");
  fallback.className = "thumb-fallback";
  fallback.setAttribute("aria-hidden", "true");
  fallback.innerHTML =
    `<span class="thumb-initials">${initialsOf(show.title)}</span>` +
    `<span class="thumb-kind">${show.type === "film" ? "🎬" : "📺"}</span>`;
  wrap.appendChild(fallback);

  if (show.videoId) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = thumbUrlFor(show.videoId);
    // Görsel gelirse döşemenin üstünü kapatır; gelmezse kaldırılır ve döşeme kalır.
    img.addEventListener("error", () => img.remove());
    wrap.appendChild(img);
  }

  return wrap;
}
