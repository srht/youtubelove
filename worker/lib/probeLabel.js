// Probe videolarının Claude ile etiketlenmesi: istem, JSON şeması ve sonuç doğrulama.
// scripts/probe/collect.mjs kullanır; aynı eksen listeleri (axes.js) Worker'da doğrulamada da geçer.

import { AXES, AXIS_IDS, LABELED_AXES } from "./axes.js";

const axisGuide = (axis) => AXES[axis].map((v) => `${v.id} (${v.label})`).join(", ");

export const LABEL_SYSTEM = `Bir video öneri sitesi için YouTube videolarını etiketliyorsun.
Her video için yalnızca başlık, açıklama, kanal adı, süre ve etiketler verilir; videoyu izleyemezsin.
Emin olamadığın yerde en olası değeri seç, uydurma bilgi ekleme.

Eksenler (yalnızca verilen kimlikleri kullan):
- category: ${axisGuide("category")}
- tone: ${axisGuide("tone")}
- depth: ${axisGuide("depth")}
- format: ${axisGuide("format")}

Diğer alanlar:
- spoken_lang: videoda KONUŞULAN dilin ISO 639-1 kodu. Konuşma yoksa (enstrümantal müzik,
  doğa sesi, sessiz görüntü) "zxx". Başlığın dili ile konuşma dili farklı olabilir; kanal adı ve
  açıklama ipucudur.
- lang_dependency: 0-1. İçeriği anlamak için dili bilmek ne kadar gerekli?
  0 = hiç gerekmez (müzik, ortam sesi, doğa görüntüsü, görsel el işi), 0.5 = görüntü çok şey anlatır
  ama konuşma da önemli (yemek tarifi, belgesel), 1 = tamamen konuşmaya dayalı (podcast, ders, stand-up).
- clickbait: 0-1. 0 = başlık ve küçük resim içeriği dürüstçe anlatıyor; 1 = abartılı, yanıltıcı,
  merak tuzağı ("İNANAMAYACAKSINIZ", "herkes yanlış biliyor!!!", anlamsız büyük harf ve emoji).
- note: tek kısa cümle, etiketleri neden seçtiğin (inceleyen kişi için).`;

export const LABEL_SCHEMA = {
  type: "object",
  properties: {
    videos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          video_id: { type: "string" },
          spoken_lang: { type: "string" },
          category: { type: "string", enum: AXIS_IDS.category },
          tone: { type: "string", enum: AXIS_IDS.tone },
          depth: { type: "string", enum: AXIS_IDS.depth },
          format: { type: "string", enum: AXIS_IDS.format },
          lang_dependency: { type: "number" },
          clickbait: { type: "number" },
          note: { type: "string" },
        },
        required: ["video_id", "spoken_lang", "category", "tone", "depth", "format", "lang_dependency", "clickbait", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["videos"],
  additionalProperties: false,
};

/** Etiketlenecek videoları modele gidecek kısa JSON'a çevirir. */
export function buildLabelPrompt(videos) {
  const payload = videos.map((v) => ({
    video_id: v.id,
    title: v.title,
    description: (v.description ?? "").slice(0, 600),
    channel: v.channelTitle,
    duration_minutes: v.durationSeconds == null ? null : Math.round(v.durationSeconds / 60),
    tags: (v.tags ?? []).slice(0, 10),
  }));
  return `Şu ${videos.length} videoyu etiketle. Her video_id için tam bir kayıt döndür.\n\n${JSON.stringify(payload, null, 1)}`;
}

const clamp01 = (x) => (Number.isFinite(Number(x)) ? Math.min(1, Math.max(0, Number(x))) : null);

/**
 * Model çıktısını doğrular. Eksik ya da geçersiz etiketli videolar `failed` listesine düşer.
 * @returns {{labels: Map<string, object>, failed: string[]}}
 */
export function normalizeLabels(result, videoIds) {
  const labels = new Map();
  for (const item of result?.videos ?? []) {
    if (!videoIds.includes(item?.video_id)) continue;
    const ok = LABELED_AXES.every((axis) => AXIS_IDS[axis].includes(item[axis]));
    const langDependency = clamp01(item.lang_dependency);
    const clickbait = clamp01(item.clickbait);
    const spokenLang = String(item.spoken_lang ?? "").toLowerCase();
    if (!ok || langDependency == null || clickbait == null || !/^([a-z]{2}|zxx)$/.test(spokenLang)) continue;
    labels.set(item.video_id, {
      category: item.category,
      tone: item.tone,
      depth: item.depth,
      format: item.format,
      spokenLang,
      langDependency,
      clickbait,
      note: String(item.note ?? "").slice(0, 300),
    });
  }
  return { labels, failed: videoIds.filter((id) => !labels.has(id)) };
}

/**
 * Dil kararı: fastText yeterince eminse onun, değilse Claude'un sonucu.
 * Konuşma yoksa ("zxx") her zaman Claude'a güvenilir — metin dili konuşmayı belirlemez.
 */
export function chooseLanguage(fasttext, claudeLang, minConfidence) {
  if (claudeLang === "zxx") return { lang: "zxx", confidence: null, source: "claude" };
  if (fasttext && fasttext.lang && fasttext.confidence >= minConfidence) {
    return { lang: fasttext.lang, confidence: fasttext.confidence, source: "fasttext" };
  }
  if (claudeLang) return { lang: claudeLang, confidence: fasttext?.confidence ?? null, source: "claude" };
  return { lang: fasttext?.lang ?? "und", confidence: fasttext?.confidence ?? null, source: "fasttext" };
}

/** Sessiz önizlemenin başlangıcı: girişi atla, videonun ~%15'i, sona 30 sn kala en geç. */
export function previewStart(durationSeconds) {
  if (!durationSeconds || durationSeconds < 90) return 0;
  return Math.round(Math.min(Math.max(30, durationSeconds * 0.15), durationSeconds - 30));
}
