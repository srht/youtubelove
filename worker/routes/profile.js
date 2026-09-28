// /api/profile — anonim kullanıcının profili ve dil tercihleri.

import { json, error, readJson, withCookie } from "../lib/http.js";
import { getOrCreateUser } from "../lib/user.js";
import { recomputeProfile } from "../lib/profileUpdate.js";
import {
  LANGUAGES, LEVEL_PRIORS, defaultLanguagesFrom, languageWeight, validateLanguageInput,
} from "../lib/languages.js";

export async function loadLanguages(db, userId) {
  const { results } = await db
    .prepare("SELECT lang, level, source, alpha, beta FROM user_languages WHERE user_id = ? ORDER BY level, lang")
    .bind(userId)
    .all();
  return results.map((r) => ({
    lang: r.lang,
    level: r.level,
    source: r.source,
    weight: Math.round(languageWeight(r) * 1000) / 1000,
  }));
}

function profileBody(user, languages, request) {
  return {
    trackingEnabled: user.tracking_enabled === 1,
    onboarded: user.onboarded_at != null,
    languagesSaved: languages.length > 0,
    languages,
    // Kullanıcı henüz seçmediyse tarayıcı dilinden önerilen başlangıç
    suggestedLanguages: languages.length ? null : defaultLanguagesFrom(request.headers.get("accept-language")),
    supportedLanguages: LANGUAGES.map(({ code, name, native }) => ({ code, name, native })),
  };
}

export async function getProfile({ request, env }) {
  const { user, cookie } = await getOrCreateUser(request, env.DB);
  const languages = await loadLanguages(env.DB, user.id);
  return withCookie(json(profileBody(user, languages, request)), cookie);
}

/**
 * PUT /api/profile/languages { languages: [{lang, level}] }
 * Listede olmayan diller silinir (= anlamıyorum). Seviyesi değişmeyen dillerin davranıştan
 * öğrenilmiş ağırlığı korunur; seviyesi değişen ya da yeni dil beyana göre baştan başlar.
 */
export async function putLanguages({ request, env }) {
  const body = await readJson(request);
  const { value, error: message } = validateLanguageInput(body?.languages);
  if (message) return error(message, 400);

  const { user, cookie } = await getOrCreateUser(request, env.DB);
  const now = Date.now();
  const { results: existing } = await env.DB
    .prepare("SELECT lang, level FROM user_languages WHERE user_id = ?")
    .bind(user.id)
    .all();
  const previous = new Map(existing.map((r) => [r.lang, r.level]));

  const statements = [];
  const keep = value.map((l) => l.lang);
  statements.push(
    env.DB
      .prepare(`DELETE FROM user_languages WHERE user_id = ? AND lang NOT IN (${keep.map(() => "?").join(",")})`)
      .bind(user.id, ...keep)
  );
  for (const { lang, level } of value) {
    if (previous.get(lang) === level) {
      statements.push(
        env.DB.prepare("UPDATE user_languages SET source = 'user', updated_at = ? WHERE user_id = ? AND lang = ?")
          .bind(now, user.id, lang)
      );
    } else {
      const prior = LEVEL_PRIORS[level];
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO user_languages (user_id, lang, level, source, alpha, beta, updated_at)
             VALUES (?, ?, ?, 'user', ?, ?, ?)
             ON CONFLICT (user_id, lang) DO UPDATE SET
               level = excluded.level, source = 'user', alpha = excluded.alpha,
               beta = excluded.beta, updated_at = excluded.updated_at`
          )
          .bind(user.id, lang, level, prior.alpha, prior.beta, now)
      );
    }
  }
  await env.DB.batch(statements);

  // Davranış sinyali varsa dil ağırlıkları yeni seviyelerin önseli + sinyallerden yeniden hesaplanır
  const signals = await env.DB.prepare("SELECT count(*) AS n FROM video_signals WHERE user_id = ?").bind(user.id).first();
  if (signals.n > 0) await recomputeProfile(env.DB, user.id, now);

  const languages = await loadLanguages(env.DB, user.id);
  return withCookie(json(profileBody(user, languages, request)), cookie);
}

/** PUT /api/profile/tracking { enabled: boolean } */
export async function putTracking({ request, env }) {
  const body = await readJson(request);
  if (typeof body?.enabled !== "boolean") return error("enabled true/false olmalı.", 400);
  const { user, cookie } = await getOrCreateUser(request, env.DB);
  await env.DB.prepare("UPDATE users SET tracking_enabled = ? WHERE id = ?").bind(body.enabled ? 1 : 0, user.id).run();
  user.tracking_enabled = body.enabled ? 1 : 0;
  const languages = await loadLanguages(env.DB, user.id);
  return withCookie(json(profileBody(user, languages, request)), cookie);
}
