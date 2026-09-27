// Yapay zekâ öneri isteminin ve yanıt ayrıştırmanın ortak kodu.
//
// Hem tarayıcı (kullanıcı kendi anahtarını girdiyse) hem de Cloudflare Pages
// sunucu fonksiyonu (functions/api/suggest.js) aynı istemi ve aynı ayrıştırıcıyı
// kullanır. Bu yüzden bu dosya window/document gibi tarayıcıya özgü şeylere
// dokunmaz.

import { CATEGORIES } from "./data.js";

/** Önerilerin kütüphanede gruplanacağı başlıklar — model bunlardan birini seçer. */
export const AI_CATEGORIES = [
  ...CATEGORIES.map((c) => c.label),
  "Belgesel",
  "Müzik",
  "Dizi",
  "Film",
];

export const SYSTEM_PROMPT = `Sen "YouTubeLove" adlı bir sitenin öneri motorusun.
Sitenin amacı: kullanıcıyı YouTube'un amaçsız akışından çıkarıp izlemeye değer, ilginç,
iyi hissettiren ve ufuk açan içeriklere yönlendirmek. Kullanıcı Türk, arayüz Türkçe.

Görevin video bulmak DEĞİL, kullanıcının YouTube'da aratacağı ARAMA BAŞLIKLARI üretmek.
Kullanıcı bir başlığa tıklayınca YouTube'un arama sonuç sayfası açılır ve oradan kendisi seçer.
Örnek: kullanıcı "kaygılıyım" dediyse "kaygı" kelimesini tekrar etme; onu iyi gelecek konulara
götüren somut aramalar yaz: "4-7-8 nefes egzersizi rehberli", "yağmur sesi 1 saat",
"Bob Ross resim yapıyor tam bölüm", "Karadeniz yaylaları belgesel".

Kurallar:
- Yanıtın SADECE geçerli bir JSON dizisi olsun. Açıklama, selamlama, markdown çiti ekleme.
- Her öge şu alanlara sahip olsun:
  {"title": "YouTube'da aranacak başlık", "query": "arama kutusuna yazılacak metin",
   "why": "neden bu kişiye iyi gelir (tek kısa cümle)",
   "kind": "video" | "dizi" | "film", "category": "<kategori>", "year": "dizi/film ise yapım yılı, yoksa boş"}
- "title" kısa, net, doğrudan aranabilir bir ifade olsun (2-7 kelime). "query" çoğunlukla title ile
  aynı olabilir; gerekirse "belgesel", "tam bölüm", "rehberli", "1. bölüm" gibi eklerle netleştir.
- "category" şu listeden BİRİ olsun: ${AI_CATEGORIES.join(" | ")}
- Dizi/film önerirken gerçekten var olan, sevilen yapımların adını kullan (ör. "Yaprak Dökümü 1. bölüm");
  uydurma ad yazma.
- İlginç ol: klişe "motivasyon videosu" aramaları yerine merak uyandıran belgeseller, kült
  diziler, unutulmuş klasikler, etkileyici konuşmalar, iyi anlatılmış bilim/tarih konuları.
- Türkçe aramalar ağırlıklı olsun; uygun düştüğünde yabancı yapımlar da olabilir.
- Çeşitlilik olsun: başlıklar aynı konunun tekrarı olmasın.
- Tıbbi tavsiye verme, tanı koyma. Sansasyonel, öfke ya da kaygı pompalayan aramalar önerme.
- "why" alanı kullanıcıya "sen" diye hitap etsin ve kısa olsun.`;

/** Bölüme göre modelden ne tür öneri istendiğini belirtir. */
export const FOCUS_INSTRUCTIONS = {
  video: 'Yalnızca video/konu aramaları öner; "kind" alanı hep "video" olsun.',
  show: 'Yalnızca dizi ve film aramaları öner; "kind" alanı "dizi" veya "film" olsun.',
  any: "Konu aramalarıyla dizi/film aramalarını karıştır.",
};

/** Modele gidecek kullanıcı mesajını kurar. */
export function buildUserPrompt({ context = "", focus = "any", count = 6, avoid = [], lucky = false }) {
  return [
    "Kullanıcı ve arama bağlamı:",
    context || "(Belirgin bir bağlam yok — genel ama ilginç öneriler ver.)",
    "",
    FOCUS_INSTRUCTIONS[focus] ?? FOCUS_INSTRUCTIONS.any,
    lucky
      ? "Bu bir 'şansımı dene' isteği: tahmin edilemez, şaşırtıcı ama izlemeye kesinlikle değer bir şey seç."
      : "",
    avoid.length > 0
      ? `Şunları ÖNERME (zaten gördü veya izledi): ${avoid.slice(0, 40).join(", ")}`
      : "",
    "",
    `Tam olarak ${count} arama başlığı üret. Yalnızca JSON dizisi döndür.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function slugify(text) {
  return String(text)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Modelin ham dizisini güvenli, tek biçimli öneri kayıtlarına çevirir. */
export function normalizeSuggestions(raw, count = 6) {
  return (Array.isArray(raw) ? raw : [])
    .filter((item) => item && typeof item.title === "string" && typeof item.query === "string")
    .map((item) => {
      const kind = ["video", "dizi", "film"].includes(item.kind) ? item.kind : "video";
      const category = AI_CATEGORIES.includes(item.category)
        ? item.category
        : kind === "dizi" ? "Dizi" : kind === "film" ? "Film" : "Belgesel";
      const title = String(item.title).trim().slice(0, 120);
      return {
        id: `${kind}-${slugify(title)}`,
        title,
        query: String(item.query).trim().slice(0, 200),
        why: typeof item.why === "string" ? item.why.trim().slice(0, 300) : "",
        kind,
        category,
        year: item.year ? String(item.year).slice(0, 12) : "",
      };
    })
    .filter((item) => item.title && item.query)
    .slice(0, count);
}

/** JSON.parse dener; dizi ya da bilinen bir sarmalayıcı anahtar döndürür. */
function tryParseArray(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value;
    for (const key of ["suggestions", "items", "oneriler", "öneriler", "results", "data"]) {
      if (Array.isArray(value?.[key])) return value[key];
    }
  } catch {
    /* çağıran sıradaki adayı dener */
  }
  return null;
}

/** ```json ... ``` bloğu varsa içeriğini alır (metnin herhangi bir yerinde olabilir). */
function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

/**
 * Metindeki dengeli [ ... ] bloklarını bulur.
 * Dize içindeki köşeli parantezleri ve kaçış karakterlerini dikkate alır; böylece
 * "why" metninde geçen bir parantez ayrıştırmayı bozmaz.
 */
function findBalancedArrays(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Yanıt token sınırında kesildiyse dizi kapanmamış olur.
 * Bu durumda tamamlanmış { ... } nesnelerini toplayıp kısmi sonuç kurtarırız.
 */
function salvageObjects(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;

  const objects = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        try {
          objects.push(JSON.parse(text.slice(objectStart, i + 1)));
        } catch {
          /* bozuk nesneyi atla */
        }
        objectStart = -1;
      }
    }
  }
  return objects.length > 0 ? objects : null;
}

/**
 * Modelin döndürdüğü metinden öneri dizisini çıkarır.
 * Modeller sık sık kod çiti, giriş cümlesi ekler ya da yanıtı yarıda keser;
 * hepsine karşı sırayla tolerans gösterilir.
 */
export function parseJsonArray(text, { truncated = false } = {}) {
  const unfenced = stripCodeFence(text);

  // 1) Doğrudan ayrıştır
  const direct = tryParseArray(unfenced);
  if (direct) return direct;

  // 2) Metin içindeki dengeli dizileri dene (en uzundan başlayarak)
  const candidates = [...findBalancedArrays(unfenced), ...findBalancedArrays(text)]
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const parsed = tryParseArray(candidate);
    if (parsed) return parsed;
  }

  // 3) Kesilmiş yanıt: tamamlanmış nesneleri kurtar
  const salvaged = salvageObjects(unfenced) ?? salvageObjects(text);
  if (salvaged) return salvaged;

  // 4) Teşhis edilebilir bir hata ver
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
  if (truncated) {
    throw new Error(
      "Modelin yanıtı token sınırında kesilmiş. Ayarlar'dan öneri sayısını azaltmayı dene. " +
        `Yanıtın başı: “${preview}”`
    );
  }
  throw new Error(`Modelin yanıtı JSON olarak okunamadı. Yanıtın başı: “${preview}”`);
}

