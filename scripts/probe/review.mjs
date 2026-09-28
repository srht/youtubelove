#!/usr/bin/env node
// Aday dosyasını elle gözden geçirme yardımcısı.
//
//   node scripts/probe/review.mjs data/candidates-X.jsonl --stats
//   node scripts/probe/review.mjs data/candidates-X.jsonl --to-csv      → candidates-X.csv
//   (CSV'yi Excel/Sheets'te düzenle: status = approved | rejected, etiketleri düzelt)
//   node scripts/probe/review.mjs data/candidates-X.jsonl --from-csv candidates-X.csv
//
// JSONL doğrudan da düzenlenebilir; her satır tek bir video.

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { toCsv, parseCsv, applyCsvEdits } from "./lib/csv.js";
import { validateProbeRow } from "../../worker/lib/probeStore.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "to-csv": { type: "boolean", default: false },
    "from-csv": { type: "string" },
    stats: { type: "boolean", default: false },
  },
});
const [file] = positionals;
if (!file) throw new Error("Kullanım: review.mjs <candidates.jsonl> [--to-csv | --from-csv x.csv | --stats]");

const readRows = async () =>
  (await readFile(file, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

let rows = await readRows();

if (args["to-csv"]) {
  const out = file.replace(/\.jsonl$/, ".csv");
  await writeFile(out, "﻿" + toCsv(rows)); // BOM: Excel Türkçe karakterleri doğru açsın
  console.log(`${rows.length} satır → ${out}`);
}

if (args["from-csv"]) {
  const csvRows = parseCsv(await readFile(args["from-csv"], "utf8"));
  const result = applyCsvEdits(rows, csvRows);
  rows = result.rows;
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${result.changed} satır güncellendi → ${file}`);
}

if (args.stats || args["from-csv"]) {
  const count = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
  console.log("Durum:", count("status"));
  console.log("Dil:", count("lang"));
  console.log("Kategori:", count("category"));
  const invalid = rows.map((r) => [r.video_id, validateProbeRow(r).error]).filter(([, e]) => e);
  if (invalid.length) console.log("Geçersiz satırlar:", invalid);
}
