import { describe, it, expect, afterEach, vi } from "vitest";
import { createClaude, askClaude, ClaudeRefusalError } from "../worker/lib/claude.js";
import { generateNativeQueries } from "../worker/lib/nativeQueries.js";
import { api } from "./helpers.js";

/** Messages API'yi taklit eden sahte fetch; gelen istekleri kaydeder. */
function fakeAnthropic(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), body, headers });
    const payload = typeof reply === "function" ? reply(body) : reply;
    return Response.json({
      id: "msg_1", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: typeof payload.text === "string" ? payload.text : JSON.stringify(payload.text) }],
      stop_reason: payload.stop_reason ?? "end_turn", stop_details: payload.stop_details ?? null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  return { calls, fetchImpl };
}

afterEach(() => vi.unstubAllGlobals());

describe("Claude istemcisi", () => {
  it("claude-opus-5, JSON şema, varsayılan fallback ile istek atar", async () => {
    const { calls, fetchImpl } = fakeAnthropic({ text: { ok: true } });
    const client = createClaude({ apiKey: "k", fetch: fetchImpl });
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const out = await askClaude(client, { system: "s", user: "u", schema });
    expect(out).toEqual({ ok: true });
    const { url, body, headers } = calls[0];
    expect(url).toMatch(/\/v1\/messages/);
    expect(body.model).toBe("claude-opus-5");
    expect(body.output_config.format).toEqual({ type: "json_schema", schema });
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(headers.get("x-api-key")).toBe("k");
  });

  it("reddi ve yarıda kesilmeyi hata olarak bildirir", async () => {
    let client = createClaude({ apiKey: "k", fetch: fakeAnthropic({ text: "", stop_reason: "refusal", stop_details: { category: "cyber" } }).fetchImpl });
    await expect(askClaude(client, { system: "s", user: "u" })).rejects.toBeInstanceOf(ClaudeRefusalError);
    client = createClaude({ apiKey: "k", fetch: fakeAnthropic({ text: "yarım", stop_reason: "max_tokens" }).fetchImpl });
    await expect(askClaude(client, { system: "s", user: "u" })).rejects.toThrow(/max_tokens/);
  });

  it("native sorgular: dil adıyla istenir, tekrarlar atılır", async () => {
    const { calls, fetchImpl } = fakeAnthropic({ text: { queries: [
      { query: "Wissenschaft einfach erklärt", intent: "bilim" },
      { query: "wissenschaft einfach erklärt", intent: "tekrar" },
      { query: "Dokumentation Natur Alpen", intent: "doğa" },
    ] } });
    const out = await generateNativeQueries(createClaude({ apiKey: "k", fetch: fetchImpl }), { lang: "de", topic: "Bilim & Doğa", count: 3 });
    expect(out.map((q) => q.query)).toEqual(["Wissenschaft einfach erklärt", "Dokumentation Natur Alpen"]);
    expect(calls[0].body.messages[0].content).toContain("Almanca (Deutsch, de)");
  });

  it("/api/suggest ANTHROPIC_API_KEY varsa şemalı Claude yolunu kullanır", async () => {
    const { calls, fetchImpl } = fakeAnthropic({ text: { suggestions: [
      { title: "yağmur sesi 1 saat", query: "yağmur sesi 1 saat", why: "Sakinleşirsin.", kind: "video", category: "Müzik", year: "" },
    ] } });
    vi.stubGlobal("fetch", fetchImpl);
    const r = await api("/api/suggest", { method: "POST", body: { count: 1 }, overrides: { ANTHROPIC_API_KEY: "k", AI: undefined } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.provider).toBe("anthropic");
    expect(body.suggestions[0].title).toBe("yağmur sesi 1 saat");
    expect(calls[0].body.output_config.format.schema.required).toEqual(["suggestions"]);
  });
});
