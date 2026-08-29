// LLM sağlayıcı ayarları ve API anahtarı saklama.
//
// GÜVENLİK NOTU: Anahtar yalnızca kullanıcının kendi tarayıcısındaki localStorage'da
// durur; depoya, sunucuya ya da başka bir yere gönderilmez. Yine de tarayıcıya erişimi
// olan herkes okuyabilir — ortak kullanılan bilgisayarlarda kullanılmamalı.
// Bu uyarı arayüzde de gösterilir.

const KEY = "yl_llm_v1";
const memoryFallback = new Map();

export const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-5",
    keyPlaceholder: "sk-ant-...",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    keyPlaceholder: "sk-...",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    keyPlaceholder: "AIza...",
    keysUrl: "https://aistudio.google.com/app/apikey",
  },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

const DEFAULTS = {
  enabled: false,
  provider: "anthropic",
  apiKey: "",
  model: "",
  count: 6,
};

function read() {
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = memoryFallback.get(KEY) ?? null;
  }
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(config) {
  const payload = JSON.stringify(config);
  try {
    window.localStorage.setItem(KEY, payload);
  } catch {
    memoryFallback.set(KEY, payload);
  }
}

export function getLlmConfig() {
  const config = read();
  // Model boş bırakıldıysa sağlayıcının varsayılanı kullanılır.
  if (!config.model) config.model = getProvider(config.provider).defaultModel;
  return config;
}

export function saveLlmConfig(patch) {
  const next = { ...read(), ...patch };
  write(next);
  return next;
}

export function clearApiKey() {
  const next = { ...read(), apiKey: "", enabled: false };
  write(next);
  return next;
}

/** LLM önerileri kullanılabilir mi? (açık + anahtar girilmiş) */
export function isLlmReady(config = getLlmConfig()) {
  return Boolean(config.enabled && config.apiKey && config.apiKey.trim());
}

/** Anahtarı arayüzde göstermek için maskeler: sk-ant-…4f2a */
export function maskKey(apiKey) {
  if (!apiKey) return "";
  const text = apiKey.trim();
  if (text.length <= 10) return "•".repeat(text.length);
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}
