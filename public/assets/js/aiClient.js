// Önerileri yapay zekâdan getiren istemci.
//
// Varsayılan yol sitenin kendi sunucu fonksiyonudur (/api/suggest) — ziyaretçiden
// anahtar istenmez. Sunucuya ulaşılamazsa (ör. site yerel bir dosya sunucusunda
// çalışıyorsa) ve kullanıcı Ayarlar → Gelişmiş'te kendi anahtarını girdiyse, istek
// tarayıcıdan doğrudan o servise gider.

import { generateLlmSuggestions } from "./llm.js";
import { isLlmReady } from "./llmSettings.js";
import { getProfile } from "./profileApi.js";

const ENDPOINT = "/api/suggest";
const TIMEOUT_MS = 60_000;

/** Sunucuda hangi özelliklerin açık olduğunu sorar. Hata durumunda {available:false}. */
export async function checkServer() {
  try {
    const response = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
    if (!response.ok) return { available: false };
    return await response.json();
  } catch {
    return { available: false };
  }
}

/**
 * @param {{context?:string, focus?:"video"|"show"|"any", count?:number,
 *          avoid?:string[], lucky?:boolean}} options
 * @returns {Promise<{suggestions:Array<object>, provider:string}>}
 */
export async function getSuggestions(options) {
  let serverError;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && Array.isArray(data?.suggestions)) return data;
    serverError = data?.error ?? `Öneri servisi ${response.status} döndü.`;
  } catch (error) {
    serverError =
      error.name === "AbortError"
        ? "Yapay zekâ çok uzun süre yanıt vermedi."
        : "Sitenin yapay zekâ servisine ulaşılamadı.";
  } finally {
    clearTimeout(timer);
  }

  if (isLlmReady()) {
    // Sunucu yokken de dil tercihleri (daha önce yüklendiyse) isteme girsin
    const profile = await getProfile();
    const languages = profile?.languages ?? [];
    const suggestions = await generateLlmSuggestions(options.context ?? "", { ...options, languages });
    return { suggestions, provider: "own-key" };
  }
  throw new Error(serverError);
}
