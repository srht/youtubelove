// Olaylardan video başına tek bir sinyal türetir.
//
//   gösterildi, etkileşim yok ............ zayıf negatif  (-0.3)
//   izlemeye başladı, kısa sürede çıktı ... negatif        (-1)    eşik: min(10 sn, sürenin %10'u)
//   bir süre izledi ....................... orta pozitif   (+1)    eşik: min(30 sn, sürenin %25'i)
//   yarısını izledi ....................... güçlü pozitif  (+2)
//   bitirdi / tekrar izledi ............... çok güçlü      (+3)
//   ileri sardı ........................... karışık: pozitif ağırlık azalır, çok sarıp az izlediyse 0
//   önizleme (sessiz, ~25 sn) ............. hafif: çoğunu izlediyse +0.3, hemen geçtiyse -0.1
//
// Eşikler video süresine göre ölçeklenir (3 dakikalık videoda 30 sn ile 1 saatlikte 30 sn aynı değil).
// Yabancı dilde, altyazıyla izlenen bir video uzun izlenmişse ağırlık 1.5 katına çıkar.

export const WEIGHTS = {
  impressionOnly: -0.3,
  quickExit: -1,
  neutral: 0.2,
  medium: 1,
  strong: 2,
  veryStrong: 3,
  previewLong: 0.3,
  previewSkip: -0.1,
};
export const FOREIGN_SUBTITLE_BONUS = 1.5;
export const MIN_WEIGHT = -1;
export const MAX_WEIGHT = 4;
const FORWARD_SEEK_SECONDS = 5;

/**
 * @param {Array<object>} events aynı kullanıcı + aynı video, zamana göre sıralı
 * @param {{durationSeconds?:number, lang?:string}} video
 * @param {{level?:string}|undefined} langPref kullanıcının bu videonun dilindeki seviyesi
 * @returns {{weight:number, label:string, watched:number, duration:number|null}|null}
 */
export function deriveSignal(events, video = {}, langPref) {
  if (!events.length) return null;
  const duration = video.durationSeconds ?? Math.max(0, ...events.map((e) => e.duration ?? 0)) ?? null;

  // İzleme penceresi: oynatıcı oturumu başına en yüksek "watched" (exit/pause/ended/heartbeat)
  const watchEvents = events.filter((e) => ["heartbeat", "pause", "ended", "exit"].includes(e.type) && e.mode !== "preview");
  const watched = Math.max(0, ...watchEvents.map((e) => e.watched ?? 0));
  const startedWatch = events.some((e) => e.type === "click" && e.target === "watch") || watchEvents.length > 0;
  const ended = events.some((e) => e.type === "ended");
  const plays = events.filter((e) => e.type === "exit").length;
  const forwardSeeks = events.filter((e) => e.type === "seek" && (e.to ?? 0) - (e.from ?? 0) > FORWARD_SEEK_SECONDS).length;
  const backSeeks = events.filter((e) => e.type === "seek" && (e.from ?? 0) - (e.to ?? 0) > FORWARD_SEEK_SECONDS).length;

  const previewWatched = Math.max(0, ...events.filter((e) => e.type === "preview_end").map((e) => e.watched ?? 0));
  const previewed = events.some((e) => e.type === "preview_start");
  const hoverMs = events.filter((e) => e.type === "hover").reduce((s, e) => s + (e.ms ?? 0), 0);

  let weight;
  let label;
  if (startedWatch) {
    const frac = duration ? watched / duration : 0;
    const quick = Math.min(10, (duration ?? 100) * 0.1);
    const medium = Math.min(30, (duration ?? 120) * 0.25);
    if (ended || frac >= 0.9 || (plays >= 2 && watched >= medium)) {
      weight = WEIGHTS.veryStrong;
      label = ended || frac >= 0.9 ? "bitirdi" : "tekrar izledi";
    } else if (frac >= 0.5) {
      weight = WEIGHTS.strong;
      label = "yarısından fazlasını izledi";
    } else if (watched >= medium) {
      weight = WEIGHTS.medium;
      label = `${Math.round(watched)} sn izledi`;
    } else if (watched < quick) {
      weight = WEIGHTS.quickExit;
      label = "hemen çıktı";
    } else {
      weight = WEIGHTS.neutral;
      label = "kısa izledi";
    }

    if (forwardSeeks > 0 && weight > 0) {
      if (forwardSeeks >= 3 && frac < 0.5) {
        weight = 0;
        label += ", çok ileri sardı (karışık)";
      } else {
        weight *= 0.7;
        label += ", ileri sardı";
      }
    }
    if (backSeeks > 0 && weight > 0) {
      weight += 0.2;
      label += ", geri sarıp tekrar baktı";
    }
    const longEnough = watched >= 60 || frac >= 0.5;
    if (langPref?.level === "subtitles" && weight > 0 && longEnough) {
      weight *= FOREIGN_SUBTITLE_BONUS;
      label += ", yabancı dilde altyazıyla";
    }
  } else if (previewed) {
    if (previewWatched >= 15) {
      weight = WEIGHTS.previewLong;
      label = "önizlemeyi izledi";
    } else if (previewWatched < 5) {
      weight = WEIGHTS.previewSkip;
      label = "önizlemeyi hemen geçti";
    } else {
      weight = 0;
      label = "önizlemeye göz attı";
    }
  } else if (hoverMs >= 1500) {
    weight = 0;
    label = "üzerinde durdu";
  } else if (events.some((e) => e.type === "impression")) {
    weight = WEIGHTS.impressionOnly;
    label = "gösterildi, tıklanmadı";
  } else {
    return null;
  }

  return {
    weight: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(weight * 100) / 100)),
    label,
    watched: Math.round(Math.max(watched, previewWatched)),
    duration: duration || null,
  };
}
