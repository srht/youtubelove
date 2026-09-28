// Sinyallerden kullanıcı profilini (eksen Beta'ları, dil ağırlıkları, profil vektörü) yeniden hesaplar.
//
// Her seferinde önselden BAŞTAN toplanır; bu yüzden aynı olay iki kez gelse ya da bir videonun
// sinyali sonradan güçlense bile çift sayım olmaz.
//   pozitif ağırlık w → o videonun her eksen değerinde alpha += w
//   negatif ağırlık w → beta += |w|

import { PROFILE_AXES, PRIOR } from "./beliefs.js";
import { LEVEL_PRIORS } from "./languages.js";
import { profileVector, fromBlob, toBlob, EMBEDDING_MODEL } from "./embeddings.js";

/** Aynı videonun çok güçlü bir sinyali profili tek başına ele geçirmesin diye tavan. */
export const MAX_UPDATE = 3;

export function accumulateBeliefs(signals) {
  const acc = new Map(); // "axis\tvalue" → {alpha, beta}
  for (const s of signals) {
    const w = Math.max(-MAX_UPDATE, Math.min(MAX_UPDATE, s.weight));
    if (w === 0) continue;
    for (const axis of PROFILE_AXES) {
      const value = axis === "duration" ? s.duration_bucket : s[axis];
      if (!value) continue;
      const key = `${axis}\t${value}`;
      const b = acc.get(key) ?? { ...PRIOR };
      if (w > 0) b.alpha += w;
      else b.beta += -w;
      acc.set(key, b);
    }
  }
  return acc;
}

export function accumulateLanguages(languageRows, signals) {
  const out = new Map();
  for (const l of languageRows) out.set(l.lang, { ...LEVEL_PRIORS[l.level] });
  for (const s of signals) {
    const b = out.get(s.lang);
    if (!b) continue; // kullanıcının seçmediği dil (dil bağımsız içerik) ağırlık değiştirmez
    const w = Math.max(-MAX_UPDATE, Math.min(MAX_UPDATE, s.weight));
    if (w > 0) b.alpha += w;
    else b.beta += -w;
  }
  return out;
}

export async function recomputeProfile(db, userId, now = Date.now()) {
  const { results: signals } = await db
    .prepare(
      `SELECT s.weight, v.category, v.tone, v.depth, v.format, v.duration_bucket, v.lang, v.embedding
       FROM video_signals s JOIN probe_videos v ON v.video_id = s.video_id WHERE s.user_id = ?`
    )
    .bind(userId)
    .all();
  const { results: languages } = await db
    .prepare("SELECT lang, level FROM user_languages WHERE user_id = ?")
    .bind(userId)
    .all();

  const beliefs = accumulateBeliefs(signals);
  const langs = accumulateLanguages(languages, signals);

  const statements = [db.prepare("DELETE FROM user_axis_beliefs WHERE user_id = ?").bind(userId)];
  for (const [key, b] of beliefs) {
    const [axis, value] = key.split("\t");
    statements.push(
      db.prepare("INSERT INTO user_axis_beliefs (user_id, axis, value, alpha, beta, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, axis, value, b.alpha, b.beta, now)
    );
  }
  for (const [lang, b] of langs) {
    statements.push(
      db.prepare("UPDATE user_languages SET alpha = ?, beta = ?, updated_at = ? WHERE user_id = ? AND lang = ?")
        .bind(b.alpha, b.beta, now, userId, lang)
    );
  }
  // Dilden bağımsız profil vektörü: sinyal ağırlıklı embedding ortalaması
  const vector = profileVector(
    signals.map((s) => ({ weight: Math.max(-MAX_UPDATE, Math.min(MAX_UPDATE, s.weight)), vector: fromBlob(s.embedding) }))
  );
  statements.push(
    db.prepare(
      `INSERT INTO user_profiles (user_id, vector, model, signal_count, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET vector = excluded.vector, model = excluded.model,
         signal_count = excluded.signal_count, updated_at = excluded.updated_at`
    ).bind(userId, vector ? toBlob(vector) : null, vector ? EMBEDDING_MODEL : null, signals.length, now)
  );

  for (let i = 0; i < statements.length; i += 90) await db.batch(statements.slice(i, i + 90));
  return { beliefs: beliefs.size, signals: signals.length, vector: Boolean(vector) };
}
