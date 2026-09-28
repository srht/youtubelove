// POST /api/recommend — probe havuzundan kişisel video önerileri.
// Gövde: { count?, mood?, goal?, duration? } — mood/goal/duration sitenin mevcut seçimleri (oturum filtresi).

import { json, readJson, withCookie } from "../lib/http.js";
import { getOrCreateUser } from "../lib/user.js";
import { loadLanguages } from "./profile.js";
import { toCard } from "./onboarding.js";
import { loadBeliefs } from "../lib/beliefs.js";
import { recommend } from "../lib/recommend.js";
import { fromBlob } from "../lib/embeddings.js";
import { translateTitles } from "../lib/translate.js";
import { primaryLanguage, userLangMap } from "../lib/langFilter.js";
import { seededRandom } from "../lib/bandit.js";
import { MOODS, GOALS, DURATIONS } from "../../public/assets/js/data.js";

const MAX_COUNT = 24;
const pick = (value, list) => (list.some((x) => x.id === value) ? value : undefined);

/** İzlenmiş, önizlemesi bakılmış ya da açıkça beğenilmemiş videolar yeniden önerilmez. */
async function loadCandidates(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT v.video_id, v.title, v.lang, v.category, v.tone, v.depth, v.format, v.duration_bucket,
              v.duration_seconds, v.preview_start, v.has_captions, v.lang_dependency, v.thumbnail_url,
              v.channel_id, v.embedding, c.title AS channel_title, s.quality
       FROM probe_videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN video_scores s ON s.video_id = v.video_id
       LEFT JOIN video_signals g ON g.video_id = v.video_id AND g.user_id = ?
       WHERE v.status = 'approved' AND (g.video_id IS NULL OR (g.watched = 0 AND g.weight > -1))`
    )
    .bind(userId)
    .all();
  return results.map(({ embedding, ...row }) => ({ ...row, vector: fromBlob(embedding) }));
}

export async function postRecommend({ request, env }) {
  const body = (await readJson(request)) ?? {};
  const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || 12));
  const session = {
    mood: pick(body.mood, MOODS),
    goal: pick(body.goal, GOALS),
    duration: pick(body.duration, DURATIONS),
  };

  const { user, cookie } = await getOrCreateUser(request, env.DB);
  const languages = await loadLanguages(env.DB, user.id);
  const profileRow = await env.DB
    .prepare("SELECT vector, signal_count FROM user_profiles WHERE user_id = ?")
    .bind(user.id)
    .first();
  const status = {
    onboarded: user.onboarded_at != null,
    signals: profileRow?.signal_count ?? 0,
    hasVector: Boolean(profileRow?.vector),
  };
  if (!languages.length) {
    return withCookie(json({ needsOnboarding: true, status, cards: [] }), cookie);
  }

  const [beliefs, candidates] = await Promise.all([loadBeliefs(env.DB, user.id), loadCandidates(env.DB, user.id)]);
  const rng = seededRandom(crypto.getRandomValues(new Uint32Array(1))[0]);
  const picks = recommend({
    candidates,
    profile: fromBlob(profileRow?.vector),
    beliefs,
    languages,
    session,
    count,
    rng,
  });

  const langs = userLangMap(languages);
  const translations = await translateTitles(
    env,
    picks.filter((p) => langs.get(p.video.lang)?.level !== "fluent").map((p) => ({ videoId: p.video.video_id, title: p.video.title, lang: p.video.lang })),
    primaryLanguage(languages)
  );

  return withCookie(
    json({
      needsOnboarding: !status.onboarded && status.signals === 0,
      status,
      session,
      cards: picks.map((p) => ({
        ...toCard(p.video, translations.get(p.video.video_id)),
        reason: p.reason,
        explore: p.explore,
        score: Math.round(p.score * 1000) / 1000,
      })),
    }),
    cookie
  );
}
