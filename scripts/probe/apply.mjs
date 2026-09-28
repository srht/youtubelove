#!/usr/bin/env node
// İncelenmiş aday dosyasını sitenin veritabanına gönderir (pending olanlar atlanır).
//
//   ADMIN_TOKEN=... node scripts/probe/apply.mjs data/candidates-X.jsonl --site https://youtubelove.<hesap>.workers.dev

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: "string" },
    "include-pending": { type: "boolean", default: false },
    "batch-size": { type: "string", default: "100" },
  },
});
const [file] = positionals;
if (!file || !args.site) throw new Error("Kullanım: apply.mjs <candidates.jsonl> --site https://...");
if (!process.env.ADMIN_TOKEN) throw new Error("ADMIN_TOKEN gerekli (Cloudflare'deki gizli değişkenle aynı).");

const rows = (await readFile(file, "utf8"))
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((r) => args["include-pending"] || r.status !== "pending");
if (rows.length === 0) {
  console.log("Gönderilecek satır yok (hepsi pending). Önce review.mjs ile onayla/reddet.");
  process.exit(0);
}

const size = Number(args["batch-size"]);
let imported = 0;
const rejected = [];
for (let i = 0; i < rows.length; i += size) {
  const last = i + size >= rows.length;
  const response = await fetch(new URL("/api/admin/probe/import", args.site), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    body: JSON.stringify({ rows: rows.slice(i, i + size), rescore: last }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sunucu ${response.status}: ${data.error ?? "bilinmeyen hata"}`);
  imported += data.imported;
  rejected.push(...data.rejected);
  if (last) console.log(`Kalite skoru hesaplanan video: ${data.scored}`);
}
console.log(`${imported} satır aktarıldı.`);
if (rejected.length) console.log("Reddedilenler:", rejected);
