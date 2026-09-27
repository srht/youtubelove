// Kütüphane: izlenenler ve kaydedilenler.
//
// Öneriler yapay zekâdan geldiği ve sabit bir katalog olmadığı için, kütüphaneye
// giren her öneri bütün bilgisiyle (başlık, arama metni, varsa YouTube videosu)
// saklanır; sonradan kimliğiyle geri çağrılabilir.

import { readJson, writeJson } from "./storage.js";

const KEYS = {
  ITEMS: "yl_items_v1",
  WATCHED: "yl_watched_v2",
  SAVED: "yl_saved_v2",
};

function items() {
  return readJson(KEYS.ITEMS, {});
}

/** Öneriyi kimliğiyle saklar (aynı kimlik varsa günceller). */
export function rememberItem(item) {
  if (!item?.id) return;
  const all = items();
  all[item.id] = { ...all[item.id], ...item };
  writeJson(KEYS.ITEMS, all);
}

export function getItem(id) {
  return items()[id] ?? null;
}

function readList(key) {
  const list = readJson(key, []);
  return Array.isArray(list) ? list : [];
}

function toggleIn(key, item) {
  const list = readList(key);
  const index = list.indexOf(item.id);
  if (index === -1) {
    rememberItem(item);
    list.unshift(item.id);
  } else {
    list.splice(index, 1);
  }
  writeJson(key, list);
  return index === -1;
}

export function isWatched(id) {
  return readList(KEYS.WATCHED).includes(id);
}

export function isSaved(id) {
  return readList(KEYS.SAVED).includes(id);
}

/** İzledim işaretini açıp kapatır; yeni durumu döndürür. */
export function toggleWatched(item) {
  return toggleIn(KEYS.WATCHED, item);
}

export function toggleSaved(item) {
  return toggleIn(KEYS.SAVED, item);
}

/** Bir öneriyi (ör. formdan eklenen) doğrudan kaydedilenlere koyar. */
export function addSaved(item) {
  if (!isSaved(item.id)) toggleIn(KEYS.SAVED, item);
}

export function removeSaved(id) {
  writeJson(KEYS.SAVED, readList(KEYS.SAVED).filter((x) => x !== id));
}

export function getWatchedItems() {
  return readList(KEYS.WATCHED).map(getItem).filter(Boolean);
}

export function getSavedItems() {
  return readList(KEYS.SAVED).map(getItem).filter(Boolean);
}
