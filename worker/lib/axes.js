// Probe videolarının eksenleri. Claude etiketlemesi, elle inceleme, Thompson sampling ve
// kullanıcı profilindeki Beta dağılımları hep bu listeleri kullanır.
// Kategoriler sitenin mevcut kategori listesini (public/assets/js/data.js) genişletir.

import { CATEGORIES } from "../../public/assets/js/data.js";

export const AXES = {
  category: [
    ...CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    { id: "bilim_doga", label: "Bilim & Doğa" },
    { id: "tarih_kultur", label: "Tarih & Kültür" },
    { id: "gezi", label: "Gezi & Dünya" },
    { id: "muzik", label: "Müzik" },
    { id: "dizi_film", label: "Dizi & Film" },
    { id: "mizah", label: "Mizah" },
  ],
  tone: [
    { id: "sakin", label: "Sakin" },
    { id: "eglenceli", label: "Eğlenceli" },
    { id: "ilham_verici", label: "İlham verici" },
    { id: "dusundurucu", label: "Düşündürücü" },
    { id: "heyecanli", label: "Heyecanlı" },
    { id: "duygusal", label: "Duygusal" },
  ],
  depth: [
    { id: "hafif", label: "Hafif" },
    { id: "orta", label: "Orta" },
    { id: "derin", label: "Derin" },
  ],
  format: [
    { id: "anlatim", label: "Anlatım / ders" },
    { id: "belgesel", label: "Belgesel" },
    { id: "sohbet", label: "Sohbet / röportaj / podcast" },
    { id: "rehber", label: "Uygulamalı rehber" },
    { id: "vlog", label: "Vlog" },
    { id: "performans", label: "Performans (müzik, sahne)" },
    { id: "kurgu", label: "Kurgu (dizi, film, kısa film)" },
    { id: "ortam", label: "Ortam (doğa sesi, lo-fi, manzara)" },
  ],
  // Süre YouTube'dan gelir (worker/lib/youtube.js durationBucket), Claude etiketlemez.
  duration: [
    { id: "kisa", label: "4 dk altı" },
    { id: "orta", label: "4-20 dk" },
    { id: "uzun", label: "20-60 dk" },
    { id: "cok_uzun", label: "1 saat üstü" },
  ],
};

/** Claude'un etiketlediği eksenler. */
export const LABELED_AXES = ["category", "tone", "depth", "format"];

export const AXIS_IDS = Object.fromEntries(Object.entries(AXES).map(([k, list]) => [k, list.map((x) => x.id)]));

export function isValidAxisValue(axis, value) {
  return AXIS_IDS[axis]?.includes(value) ?? false;
}
