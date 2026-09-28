// /api/onboarding/* — örtük sinyal tabanlı onboarding turları.

import { json, error, withCookie } from "../lib/http.js";
import { getOrCreateUser } from "../lib/user.js";
import { loadLanguages } from "./profile.js";
import { loadBeliefs } from "../lib/beliefs.js";
import { pickRound, ROUNDS, MIN_ROUNDS } from "../lib/onboardingPicker.js";
import { languageFit, userLangMap, primaryLanguage } from "../lib/langFilter.js";
import { translateTitles } from "../lib/translate.js";
import { seededRandom } from "../lib/bandit.js";
import { LANGUAGES } from "../lib/languages.js";

const CANDIDATE_LIMIT = 500;
const axisLabel = (axis) => ({ category: "Konu", tone: "Ton", depth: "Derinlik", format: "Biçim", duration: "Süre" })[axis] ?? axis;

export async function loadCandidates(db, excludeIds) {
  const { results } = await db
    .prepare(
      `SELECT v.video_id, v.title, v.lang, v.category, v.tone, v.depth, v.format, v.duration_bucket,
              v.duration_seconds, v.preview_start, v.has_captions, v.lang_dependency, v.thumbnail_url,
              c.title AS channel_title, s.quality
       FROM probe_videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN video_scores s ON s.video_id = v.video_id
       WHERE v.status = 'approved' AND v.video_id NOT IN (SELECT value FROM json_each(?))
       ORDER BY random() LIMIT ?`
    )
    .bind(JSON.stringify(excludeIds), CANDIDATE_LIMIT)
    .all();
  return results;
}

async function shownSoFar(db, userId) {
  const { results } = await db
    .prepare("SELECT round, video_ids FROM onboarding_rounds WHERE user_id = ? ORDER BY round")
    .bind(userId)
    .all();
  return { lastRound: results.at(-1)?.round ?? 0, ids: results.flatMap((r) => JSON.parse(r.video_ids)) };
}

/** Kartın arayüze gidecek hali. */
export function toCard(row, translated) {
  const language = LANGUAGES.find((l) => l.code === row.lang);
  return {
    videoId: row.video_id,
    title: row.title,
    translatedTitle: translated ?? null,
    lang: row.lang,
    langName: language?.name ?? (row.lang === "zxx" ? "Konuşmasız" : row.lang),
    channel: row.channel_title,
    thumbnail: row.thumbnail_url ?? `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
    durationSeconds: row.duration_seconds,
    previewStart: row.preview_start,
    hasCaptions: row.has_captions === 1,
    // Olaylardan sinyal türetirken gereken eksenler (Aşama 5) — istemci geri göndermez, sunucu tablodan okur
  };
}

export async function postNext({ request, env }) {
  const { user, cookie } = await getOrCreateUser(request, env.DB);
  const languages = await loadLanguages(env.DB, user.id);
  if (!languages.length) return withCookie(error("Önce izleyebildiğin dilleri seç.", 409), cookie);

  const { lastRound, ids } = await shownSoFar(env.DB, user.id);
  const round = lastRound + 1;
  const beliefs = await loadBeliefs(env.DB, user.id);
  const langs = userLangMap(languages);

  const candidates = (await loadCandidates(env.DB, ids))
    .map((row) => ({ row, fit: languageFit(row, langs) }))
    .filter((x) => x.fit.ok)
    .map(({ row, fit }) => ({
      videoId: row.video_id,
      category: row.category,
      tone: row.tone,
      depth: row.depth,
      format: row.format,
      duration: row.duration_bucket,
      quality: row.quality,
      langFactor: fit.factor,
      row,
    }));

  const rng = seededRandom(crypto.getRandomValues(new Uint32Array(1))[0]);
  const result = pickRound({ candidates, beliefs, round, rng });
  const now = Date.now();

  if (result.done || result.cards.length === 0) {
    await env.DB.prepare("UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?").bind(now, user.id).run();
    return withCookie(
      json({ done: true, round: lastRound, totalRounds: ROUNDS.length, empty: lastRound === 0 && result.cards.length === 0 }),
      cookie
    );
  }

  await env.DB
    .prepare("INSERT INTO onboarding_rounds (user_id, round, video_ids, focus_axes, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, round, JSON.stringify(result.cards.map((c) => c.videoId)), JSON.stringify(result.focusAxes), now)
    .run();

  const target = primaryLanguage(languages);
  const translations = await translateTitles(
    env,
    result.cards.filter((c) => langs.get(c.row.lang)?.level !== "fluent").map((c) => ({ videoId: c.videoId, title: c.row.title, lang: c.row.lang })),
    target
  );

  return withCookie(
    json({
      done: false,
      round,
      totalRounds: ROUNDS.length,
      minRounds: MIN_ROUNDS,
      focusAxes: result.focusAxes.map((axis) => ({ axis, label: axisLabel(axis) })),
      cards: result.cards.map((c) => toCard(c.row, translations.get(c.videoId))),
    }),
    cookie
  );
}

/** Turları baştan başlatır (öğrenilmiş inançlar korunur). */
export async function postReset({ request, env }) {
  const { user, cookie } = await getOrCreateUser(request, env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM onboarding_rounds WHERE user_id = ?").bind(user.id),
    env.DB.prepare("UPDATE users SET onboarded_at = NULL WHERE id = ?").bind(user.id),
  ]);
  return withCookie(json({ ok: true }), cookie);
}

