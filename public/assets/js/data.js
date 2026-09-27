// Arayüzdeki seçenek listeleri (ruh hali, hedef, kategori, süre, enerji).
// Burada öneri İÇERİĞİ yoktur; bütün öneriler yapay zekâdan gelir (functions/api/suggest.js).

export const CATEGORIES = [
  { id: "sakinlesme", label: "Sakinleşme & Zihinsel Sağlık", emoji: "🌿", description: "Nefes, meditasyon, kaygıyla baş etme." },
  { id: "odaklanma", label: "Odaklanma & Üretkenlik", emoji: "🎯", description: "Derin çalışma, dikkat, zaman yönetimi." },
  { id: "aliskanlik", label: "Alışkanlık & Kişisel Gelişim", emoji: "🌱", description: "Rutinler, disiplin, küçük adımlar." },
  { id: "ogrenme", label: "Öğrenme & Merak", emoji: "📚", description: "Bilim, tarih, dil, genel kültür." },
  { id: "beden", label: "Beden & Hareket", emoji: "🏃", description: "Egzersiz, uyku, beslenme, enerji." },
  { id: "yaraticilik", label: "Yaratıcılık & Hobi", emoji: "🎨", description: "Çizim, müzik, yazı, el işi." },
  { id: "iliskiler", label: "İlişkiler & İletişim", emoji: "🤝", description: "Empati, sınırlar, aile, arkadaşlık." },
  { id: "kariyer", label: "Kariyer & Finansal Okuryazarlık", emoji: "💼", description: "İş hayatı, para yönetimi, kariyer gelişimi." },
  { id: "dijital", label: "Dijital Detoks & Ekran Alışkanlıkları", emoji: "📵", description: "Ekran süresi, dikkat dağıtıcılar, bilinçli teknoloji kullanımı." },
];

export const MOODS = [
  { id: "kaygili", label: "Kaygılıyım", emoji: "😟" },
  { id: "yorgun", label: "Yorgunum", emoji: "😴" },
  { id: "uykusuz", label: "Uykum kaçtı", emoji: "🌙" },
  { id: "motivasyonsuz", label: "Motivasyonsuzum", emoji: "😐" },
  { id: "dagilmis", label: "Dağınığım, odaklanamıyorum", emoji: "🌀" },
  { id: "huzursuz", label: "Huzursuzum, gerginim", emoji: "😣" },
  { id: "sikilmis", label: "Sıkılmışım", emoji: "🥱" },
  { id: "meraklı", label: "Meraklıyım", emoji: "🤔" },
  { id: "mutsuz", label: "Keyifsizim", emoji: "😔" },
  { id: "yalniz", label: "Yalnız hissediyorum", emoji: "🫂" },
  { id: "enerjik", label: "Enerjiğim", emoji: "⚡" },
];

export const GOALS = [
  { id: "sakinlesmek", label: "Sakinleşmek", emoji: "🕊️" },
  { id: "odaklanmak", label: "Odaklanmak", emoji: "🎯" },
  { id: "ogrenmek", label: "Bir şey öğrenmek", emoji: "💡" },
  { id: "motive_olmak", label: "Motive olmak", emoji: "🔥" },
  { id: "ilham", label: "İlham almak", emoji: "✨" },
  { id: "hareket", label: "Hareket etmek", emoji: "🏃" },
  { id: "baglanti", label: "Bağ kurmak", emoji: "💬" },
  { id: "yaratmak", label: "Yaratıcılığımı beslemek", emoji: "🎨" },
  { id: "dinlenmek", label: "Zihnimi dinlendirmek", emoji: "🌙" },
];

export const DURATIONS = [
  { id: "kisa", label: "Kısa (10 dk altı)", emoji: "⏱️" },
  { id: "orta", label: "Orta (10-30 dk)", emoji: "⏳" },
  { id: "uzun", label: "Uzun (30 dk üzeri)", emoji: "🕰️" },
];

export const ENERGY_LEVELS = [
  { id: "dusuk", label: "Düşük" },
  { id: "orta", label: "Orta" },
  { id: "yuksek", label: "Yüksek" },
];
