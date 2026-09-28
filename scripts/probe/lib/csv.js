// İnceleme için CSV dışa/içe aktarma (Excel/Google Sheets'te düzenlenebilsin diye).

/** İncelemede düzenlenebilen sütunlar önce; geri kalanı bilgi amaçlı. */
export const REVIEW_COLUMNS = [
  "status", "video_id", "title", "channel_title", "lang", "lang_source", "lang_confidence",
  "category", "tone", "depth", "format", "lang_dependency", "clickbait", "preview_start",
  "review_note", "duration_seconds", "has_captions", "views", "likes", "comments", "subscribers",
  "published_at", "source_query",
];
export const EDITABLE_COLUMNS = [
  "status", "lang", "category", "tone", "depth", "format", "lang_dependency", "clickbait", "preview_start", "review_note",
];

function cell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns = REVIEW_COLUMNS) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  return lines.join("\n") + "\n";
}

/** RFC 4180 CSV ayrıştırıcı (tırnak içinde virgül, satır sonu ve "" kaçışı). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * CSV'deki düzenlemeleri JSONL satırlarına uygular (yalnızca EDITABLE_COLUMNS).
 * Elle değiştirilen etiketlerin kaynağı "manual" olur.
 */
export function applyCsvEdits(rows, csvRows) {
  const edits = new Map(csvRows.map((r) => [r.video_id, r]));
  let changed = 0;
  const out = rows.map((row) => {
    const edit = edits.get(row.video_id);
    if (!edit) return row;
    const next = { ...row };
    for (const col of EDITABLE_COLUMNS) {
      if (!(col in edit)) continue;
      const raw = edit[col];
      const value = ["lang_dependency", "clickbait"].includes(col)
        ? (raw === "" ? null : Number(String(raw).replace(",", ".")))
        : col === "preview_start" ? (raw === "" ? 0 : Math.round(Number(raw)))
        : raw;
      if (String(value ?? "") !== String(row[col] ?? "")) {
        next[col] = value;
        if (["category", "tone", "depth", "format", "lang_dependency", "clickbait"].includes(col)) next.label_source = "manual";
        if (col === "lang") next.lang_source = "manual";
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(row)) changed++;
    return next;
  });
  return { rows: out, changed };
}
