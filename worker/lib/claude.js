// Claude çağrıları — resmi Anthropic SDK ile. Worker (öneri, etiketleme, çeviri) ve
// scripts/probe aynı modülü kullanır.
//
// Varsayılan model claude-opus-5. Güvenlik sınıflandırıcısı bir isteği reddederse
// `fallbacks: "default"` isteği sunucu tarafında uygun bir modelle yeniden çalıştırır.

import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

export class ClaudeRefusalError extends Error {
  constructor(details) {
    super(`Claude isteği reddetti${details?.category ? ` (${details.category})` : ""}.`);
    this.details = details;
  }
}

/** @param {{apiKey:string, fetch?:Function}} options */
export function createClaude({ apiKey, fetch: fetchImpl, maxRetries = 2 }) {
  return new Anthropic({ apiKey, maxRetries, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/**
 * Tek bir istek. `schema` verilirse yanıt JSON şemasına uyar ve nesne olarak döner.
 * @returns {Promise<string|object>}
 */
export async function askClaude(client, { system, user, schema, model = DEFAULT_CLAUDE_MODEL, maxTokens = 16000, effort }) {
  const outputConfig = {};
  if (schema) outputConfig.format = { type: "json_schema", schema };
  if (effort) outputConfig.effort = effort;

  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") throw new ClaudeRefusalError(response.stop_details);
  if (response.stop_reason === "max_tokens") throw new Error("Claude yanıtı yarıda kesildi (max_tokens).");

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return schema ? JSON.parse(text) : text;
}
