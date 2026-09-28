#!/usr/bin/env node
// Probe video adaylarını toplar ve incelemeye hazır bir JSONL dosyası yazar.
//
//   YOUTUBE_API_KEY=... ANTHROPIC_API_KEY=... node scripts/probe/collect.mjs --langs tr,en
//
// Akış: Claude ile dil başına native sorgular → search.list (relevanceLanguage + regionCode)
// → videos.list + channels.list → Shorts/az izlenme filtresi → fastText dil tespiti →
// Claude etiketleme (eksenler, dil bağımlılığı, clickbait; düşük güvenli dil) → kanal boyutu
// filtresi → scripts/probe/data/candidates-<zaman>.jsonl (status: pending).

import { parseArgs } from "node:util";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLIDModel } from "fasttext.wasm.js";

import config from "../../config/quality.json" with { type: "json" };
import { AXES } from "../../worker/lib/axes.js";
import { LANGUAGES } from "../../worker/lib/languages.js";
import { createClaude, askClaude } from "../../worker/lib/claude.js";
import { generateNativeQueries } from "../../worker/lib/nativeQueries.js";
import { LABEL_SYSTEM, LABEL_SCHEMA, buildLabelPrompt, normalizeLabels } from "../../worker/lib/probeLabel.js";
import { searchVideoIds, getVideos, getChannels } from "../../worker/lib/youtube.js";
import { languageText, prefilter, finalizeCandidates, estimateQuota } from "./lib/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "data");

const { values: args } = parseArgs({
  options: {
    langs: { type: "string", default: "tr" },
    categories: { type: "string", default: "" },          // boş = hepsi
    "queries-per-category": { type: "string", default: "2" },
    "results-per-query": { type: "string", default: "15" },
    "label-batch": { type: "string", default: "10" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

const langs = args.langs.split(",").map((s) => s.trim()).filter(Boolean);
const categories = args.categories
  ? AXES.category.filter((c) => args.categories.split(",").includes(c.id))
  : AXES.category;
const perCategory = Number(args["queries-per-category"]);
const perQuery = Number(args["results-per-query"]);
const labelBatch = Number(args["label-batch"]);

for (const lang of langs) {
  if (!LANGUAGES.some((l) => l.code === lang)) throw new Error(`Desteklenmeyen dil: ${lang}`);
}
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY gerekli.");
if (!args["dry-run"] && !process.env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY gerekli (ya da --dry-run).");

const searches = langs.length * categories.length * perCategory;
const quota = estimateQuota({ searches, videos: searches * perQuery });
console.log(`Plan: ${langs.join(", ")} × ${categories.length} kategori × ${perCategory} sorgu = ${searches} arama`);
console.log(`Tahmini YouTube kotası: ~${quota} birim (günlük ücretsiz kota 10.000).`);
if (quota > 10000 && !args.yes && !args["dry-run"]) {
  console.error("Günlük kotayı aşıyor. Daha az dil/kategori seç ya da --yes ile yine de çalıştır.");
  process.exit(1);
}

async function existingIds() {
  const ids = new Set();
  await mkdir(DATA_DIR, { recursive: true });
  for (const file of await readdir(DATA_DIR)) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of (await readFile(path.join(DATA_DIR, file), "utf8")).split("\n")) {
      if (line.trim()) ids.add(JSON.parse(line).video_id);
    }
  }
  return ids;
}

const claude = createClaude({ apiKey: process.env.ANTHROPIC_API_KEY });
const ytKey = process.env.YOUTUBE_API_KEY;
// Test için: YOUTUBE_API_BASE verilirse googleapis yerine o adrese gidilir.
const ytFetch = process.env.YOUTUBE_API_BASE
  ? (url) => fetch(String(url).replace("https://www.googleapis.com", process.env.YOUTUBE_API_BASE))
  : undefined;
const known = await existingIds();
const allRows = [];
const allDropped = [];

const lid = await getLIDModel();
await lid.load();

for (const lang of langs) {
  const region = LANGUAGES.find((l) => l.code === lang).region;
  for (const category of categories) {
    const queries = await generateNativeQueries(claude, {
      lang,
      topic: category.label,
      context: "Onboarding için çeşitli, kaliteli ve kanalına göre sıradışı ilgi görmüş videolar arıyoruz.",
      count: perCategory,
    });
    console.log(`\n[${lang}] ${category.label}: ${queries.map((q) => `“${q.query}”`).join(", ")}`);
    if (args["dry-run"]) continue;

    for (const { query } of queries) {
      const { ids } = await searchVideoIds(
        { q: query, relevanceLanguage: lang, regionCode: region, maxResults: perQuery, order: "relevance" },
        ytKey,
        ytFetch
      );
      const videos = await getVideos(ids, ytKey, ytFetch);
      const { kept, dropped } = prefilter(videos, { existingIds: known, config });
      allDropped.push(...dropped);
      if (kept.length === 0) continue;
      kept.forEach((v) => known.add(v.id));

      const channels = await getChannels(kept.map((v) => v.channelId), ytKey, ytFetch);
      const fasttext = new Map();
      for (const v of kept) {
        const r = await lid.identify(languageText(v));
        fasttext.set(v.id, { lang: r.alpha2, confidence: r.possibility });
      }

      const labels = new Map();
      for (let i = 0; i < kept.length; i += labelBatch) {
        const batch = kept.slice(i, i + labelBatch);
        try {
          const result = await askClaude(claude, { system: LABEL_SYSTEM, user: buildLabelPrompt(batch), schema: LABEL_SCHEMA });
          const { labels: got, failed } = normalizeLabels(result, batch.map((v) => v.id));
          got.forEach((value, key) => labels.set(key, value));
          if (failed.length) console.warn(`  etiketlenemedi: ${failed.join(", ")}`);
        } catch (err) {
          console.warn(`  etiketleme hatası: ${err.message}`);
        }
      }

      const { rows, dropped: late } = finalizeCandidates(kept, {
        channels, fasttext, labels, config, query, capturedAt: Date.now(),
      });
      allRows.push(...rows);
      allDropped.push(...late);
      console.log(`  “${query}”: ${rows.length} aday (${dropped.length + late.length} elendi)`);
    }
  }
}

if (args["dry-run"]) {
  console.log("\n--dry-run: YouTube'a istek atılmadı.");
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(DATA_DIR, `candidates-${stamp}.jsonl`);
  await writeFile(file, allRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const reasons = {};
  for (const d of allDropped) reasons[d.reason.split(" (")[0]] = (reasons[d.reason.split(" (")[0]] ?? 0) + 1;
  console.log(`\n${allRows.length} aday → ${path.relative(process.cwd(), file)}`);
  console.log("Elenenler:", reasons);
  console.log(`Sonraki adım: node scripts/probe/review.mjs ${path.relative(process.cwd(), file)} --to-csv`);
}
