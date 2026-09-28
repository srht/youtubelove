// POST /api/events — tarayıcıdaki olay kuyruğunun toplu kaydı.
// Olaylar saklanır, etkilenen videoların sinyali ve kullanıcı profili yeniden hesaplanır.

import { json, error, readJson, withCookie } from "../lib/http.js";
import { getOrCreateUser } from "../lib/user.js";
import { deriveSignal } from "../lib/signals.js";
import { recomputeProfile } from "../lib/profileUpdate.js";

export const MAX_EVENTS = 200;
export const EVENT_TYPES = new Set([
  "impression", "click", "hover", "preview_start", "preview_end",
  "play", "pause", "heartbeat", "seek", "ended", "exit",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const SURFACES = new Set(["onboarding", "foryou", "library"]);
const EXTRA_KEYS = ["mode", "target", "ms", "from", "to", "reason"];

const finite = (v, max = 1e7) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : null);

/** Tek olayı doğrular; geçersizse null. */
export function validateEvent(e, now) {
  if (!e || typeof e !== "object") return null;
  if (!EVENT_TYPES.has(e.type) || !VIDEO_ID.test(e.videoId ?? "")) return null;
  const seq = Number(e.seq);
  if (!Number.isInteger(seq) || seq < 0) return null;
  const extra = {};
  for (const key of EXTRA_KEYS) {
    if (e[key] === undefined) continue;
    extra[key] = typeof e[key] === "string" ? e[key].slice(0, 40) : finite(e[key]);
  }
  const at = Number(e.at);
  return {
    type: e.type,
    videoId: e.videoId,
    surface: SURFACES.has(e.surface) ? e.surface : "foryou",
    round: finite(e.round, 20),
    position: finite(e.position, 50),
    t: finite(e.t),
    duration: finite(e.duration),
    watched: finite(e.watched),
    extra,
    seq,
    // Saat kayması ya da uydurma zaman olmasın: son 1 gün ile şimdi arası
    clientAt: Number.isFinite(at) && at <= now + 60_000 && at >= now - 86_400_000 ? at : now,
  };
}

/** D1 satırı → deriveSignal'ın beklediği nesne. */
function rowToEvent(r) {
  return { type: r.type, t: r.t, duration: r.duration, watched: r.watched, ...(r.extra ? JSON.parse(r.extra) : {}) };
}

export async function refreshSignals(db, userId, videoIds, now = Date.now()) {
  if (!videoIds.length) return 0;
  const ids = JSON.stringify(videoIds);
  const { results: videos } = await db
    .prepare("SELECT video_id, duration_seconds, lang FROM probe_videos WHERE video_id IN (SELECT value FROM json_each(?))")
    .bind(ids)
    .all();
  if (!videos.length) return 0; // havuzda olmayan videolar profile katkı vermez
  const { results: rows } = await db
    .prepare(
      `SELECT video_id, type, t, duration, watched, extra FROM events
       WHERE user_id = ? AND video_id IN (SELECT value FROM json_each(?)) ORDER BY client_at, client_seq`
    )
    .bind(userId, ids)
    .all();
  const { results: langs } = await db.prepare("SELECT lang, level FROM user_languages WHERE user_id = ?").bind(userId).all();
  const langMap = new Map(langs.map((l) => [l.lang, l]));

  const statements = [];
  for (const v of videos) {
    const events = rows.filter((r) => r.video_id === v.video_id).map(rowToEvent);
    const signal = deriveSignal(events, { durationSeconds: v.duration_seconds, lang: v.lang }, langMap.get(v.lang));
    if (!signal) continue;
    statements.push(
      db.prepare(
        `INSERT INTO video_signals (user_id, video_id, weight, label, watched, duration, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, video_id) DO UPDATE SET weight = excluded.weight, label = excluded.label,
           watched = excluded.watched, duration = excluded.duration, updated_at = excluded.updated_at`
      ).bind(userId, v.video_id, signal.weight, signal.label, signal.watched, signal.duration, now)
    );
  }
  if (statements.length) await db.batch(statements);
  return statements.length;
}

export async function postEvents({ request, env }) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.events)) return error("events dizisi gerekli.", 400);
  if (body.events.length > MAX_EVENTS) return error(`Tek istekte en fazla ${MAX_EVENTS} olay.`, 413);
  if (!SESSION_ID.test(body.sessionId ?? "")) return error("sessionId geçersiz.", 400);

  const { user, cookie } = await getOrCreateUser(request, env.DB);
  if (user.tracking_enabled !== 1) return withCookie(json({ stored: 0, ignored: body.events.length, tracking: false }), cookie);

  const now = Date.now();
  const events = body.events.map((e) => validateEvent(e, now)).filter(Boolean);
  const statements = events.map((e) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO events (user_id, session_id, client_seq, type, video_id, surface, round, position,
         t, duration, watched, extra, client_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, body.sessionId, e.seq, e.type, e.videoId, e.surface, e.round, e.position,
      e.t, e.duration, e.watched, Object.keys(e.extra).length ? JSON.stringify(e.extra) : null, e.clientAt, now
    )
  );
  for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));

  const videoIds = [...new Set(events.map((e) => e.videoId))];
  const updated = await refreshSignals(env.DB, user.id, videoIds, now);
  if (updated) await recomputeProfile(env.DB, user.id, now);

  return withCookie(
    json({ stored: events.length, rejected: body.events.length - events.length, signalsUpdated: updated }),
    cookie
  );
}
