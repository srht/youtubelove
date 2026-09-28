// Probe toplama hattının saf (dosya/ağ erişimi olmayan) parçaları — testlerde doğrudan kullanılır.

import { isLikelyShort } from "../../../worker/lib/youtube.js";
import { passesChannelSize } from "../../../worker/lib/quality.js";
import { chooseLanguage, previewStart } from "../../../worker/lib/probeLabel.js";

/** fastText için metin: başlık + açıklamanın başı, URL/etiket/e-posta temizlenmiş, tek satır. */
export function languageText(video) {
  return `${video.title ?? ""}. ${(video.description ?? "").slice(0, 300)}`
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/[#@]\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Etiketlemeden ÖNCE uygulanan ucuz filtreler: tekrar, Shorts, düşük izlenme.
 * (Kanal boyutu dile bağlı olduğu için dil kesinleştikten sonra `finalizeCandidates`'te.)
 */
export function prefilter(videos, { existingIds = new Set(), config }) {
  const kept = [];
  const dropped = [];
  const seen = new Set(existingIds);
  for (const v of videos) {
    if (seen.has(v.id)) dropped.push({ id: v.id, reason: "zaten var" });
    else if (isLikelyShort(v)) dropped.push({ id: v.id, reason: "shorts" });
    else if ((v.views ?? 0) < config.minViews) dropped.push({ id: v.id, reason: "az izlenme" });
    else kept.push(v);
    seen.add(v.id);
  }
  return { kept, dropped };
}

/**
 * Etiket + dil kararı + kanal boyutu filtresi → inceleme dosyası satırı.
 * @returns {{rows: object[], dropped: Array<{id, reason}>}}
 */
export function finalizeCandidates(videos, { channels, fasttext, labels, config, query, capturedAt }) {
  const rows = [];
  const dropped = [];
  for (const v of videos) {
    const label = labels.get(v.id);
    if (!label) {
      dropped.push({ id: v.id, reason: "etiketlenemedi" });
      continue;
    }
    const decision = chooseLanguage(fasttext.get(v.id), label.spokenLang, config.langDetect.minConfidence);
    const subscribers = channels.get(v.channelId)?.subscribers ?? null;
    if (!passesChannelSize(decision.lang, subscribers, config)) {
      dropped.push({ id: v.id, reason: `kanal boyutu (${subscribers})` });
      continue;
    }
    rows.push({
      status: "pending",
      video_id: v.id,
      title: v.title,
      channel_title: v.channelTitle,
      lang: decision.lang,
      lang_source: decision.source,
      lang_confidence: decision.confidence == null ? null : Math.round(decision.confidence * 1000) / 1000,
      category: label.category,
      tone: label.tone,
      depth: label.depth,
      format: label.format,
      lang_dependency: label.langDependency,
      clickbait: label.clickbait,
      label_source: "claude",
      review_note: label.note,
      duration_seconds: v.durationSeconds,
      preview_start: previewStart(v.durationSeconds),
      has_captions: v.hasCaptions,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      subscribers,
      channel_id: v.channelId,
      published_at: v.publishedAt,
      thumbnail_url: v.thumbnails?.high?.url ?? v.thumbnails?.medium?.url ?? null,
      description: (v.description ?? "").slice(0, 1000),
      captured_at: capturedAt,
      source_query: query ?? null,
    });
  }
  return { rows, dropped };
}

/** Kota tahmini (birim): search 100, videos/channels 50'lik grup başına 1. */
export function estimateQuota({ searches, videos = searches * 15 }) {
  return searches * 100 + Math.ceil(videos / 50) * 2;
}
