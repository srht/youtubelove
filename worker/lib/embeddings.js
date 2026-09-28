// Çok dilli video embedding'leri (Workers AI @cf/baai/bge-m3, 1024 boyut) ve vektör yardımcıları.
// bge-m3 çok dilli olduğu için Türkçe ve İngilizce aynı konudaki videolar yakın düşer; profil
// vektörü bu yüzden dilden bağımsızdır.

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_BATCH = 20;

/** Embedding'e giden metin: başlık + açıklamanın başı. */
export function embeddingText(video) {
  return `${video.title ?? ""}\n${String(video.description ?? "").slice(0, 500)}`.trim();
}

export function normalize(vector) {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm);
  const out = new Float32Array(vector.length);
  if (norm === 0) return out;
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

/** Birim vektörler için kosinüs benzerliği = iç çarpım. */
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function toBlob(vector) {
  return new Float32Array(vector).buffer;
}

/** D1 BLOB'u (ArrayBuffer ya da sayı dizisi olarak gelebilir) → Float32Array. */
export function fromBlob(blob) {
  if (!blob) return null;
  const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : ArrayBuffer.isView(blob) ? new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength) : Uint8Array.from(blob);
  if (bytes.byteLength % 4 !== 0 || bytes.byteLength === 0) return null;
  return new Float32Array(bytes.slice().buffer);
}

/**
 * Sinyal ağırlıklı ortalama: pozitif sinyaller vektörü videoya yaklaştırır, negatifler uzaklaştırır.
 * @param {Array<{weight:number, vector:Float32Array}>} items
 * @returns {Float32Array|null} birim vektör (pozitif sinyal yoksa null)
 */
export function profileVector(items) {
  const usable = items.filter((i) => i.vector && i.weight !== 0);
  if (!usable.some((i) => i.weight > 0)) return null;
  const dim = usable[0].vector.length;
  const sum = new Float32Array(dim);
  let total = 0;
  for (const { weight, vector } of usable) {
    const w = Math.max(-1, Math.min(3, weight));
    for (let i = 0; i < dim; i++) sum[i] += w * vector[i];
    total += Math.abs(w);
  }
  for (let i = 0; i < dim; i++) sum[i] /= total;
  return normalize(sum);
}

export async function embedTexts(env, texts) {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  const data = result?.data;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error("Embedding yanıtı beklenen biçimde değil.");
  return data.map((v) => normalize(v));
}

/** Embedding'i olmayan onaylı videoları işler (bakım ve içe aktarma sonrası). */
export async function embedMissing(env, { limit = 200 } = {}) {
  if (!env.AI || !env.DB) return { embedded: 0 };
  const { results } = await env.DB
    .prepare("SELECT video_id, title, description FROM probe_videos WHERE status = 'approved' AND embedding IS NULL LIMIT ?")
    .bind(limit)
    .all();
  let embedded = 0;
  for (let i = 0; i < results.length; i += EMBEDDING_BATCH) {
    const batch = results.slice(i, i + EMBEDDING_BATCH);
    const vectors = await embedTexts(env, batch.map(embeddingText));
    await env.DB.batch(
      batch.map((v, j) =>
        env.DB.prepare("UPDATE probe_videos SET embedding = ?, embedding_model = ? WHERE video_id = ?")
          .bind(toBlob(vectors[j]), EMBEDDING_MODEL, v.video_id)
      )
    );
    embedded += batch.length;
  }
  return { embedded };
}
