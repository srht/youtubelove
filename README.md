# YouTubeLove 🌱

YouTube'a dalmadan önce ne izleyeceğine niyetle karar vermen için bir ara katman.
Bütün öneriler **yapay zekâdan** gelir: sitede elle yazılmış bir video, dizi ya da film listesi yoktur.
Ziyaretçiden hiçbir API anahtarı istenmez.

## Nasıl çalışıyor?

```
Tarayıcı ──POST /api/suggest──▶ Cloudflare Worker
                                   └─ Workers AI (anahtar yok) ya da Claude (isteğe bağlı)
                                        → YouTube'da aratılacak arama başlıkları (JSON)
Tarayıcı ── başlığa tıklama ──▶ youtube.com/results?search_query=… (izlenmeye göre sıralı)
```

1. Site, seçimlerini (ruh hali, hedef, kategori, dizi filtreleri, test cevapları), süre tercihini
   ve hafızandaki izlediğin/kaydettiğin başlıkları kısa bir metne çevirip `/api/suggest`'e gönderir.
2. `worker/suggest.js` bu metni yapay zekâya verir ve JSON öneri listesi alır.
   Daha önce izlediğin ve yakın zamanda önerilenler "tekrar önerme" listesiyle gönderilir.
3. Öneriler **arama başlıkları** listesi olarak gösterilir (ör. "kaygılıyım" seçince
   "4-7-8 nefes egzersizi rehberli", "yağmur sesi 1 saat" gibi). Bir başlığa tıklayınca YouTube'un
   arama sonuç sayfası izlenmeye göre sıralı açılır; ne izleyeceğini orada sen seçersin.

## Özellikler

- **Sana Özel**: hafızana göre öneriler; **🎲 Şansımı dene** ile tek bir rastgele öneri.
  "Site her açıldığında rastgele öneriyle başlasın" seçeneği ve `#lucky` adresi.
- **Hızlı Seçim**, **Kısa Test**, **Kategoriler**: seçimlerin yapay zekâya bağlam olarak gider.
- **Dizi & Film**: dönem, tür, ruh hali, köken, tür (dizi/film), yoğunluk filtreleri; rastgele dizi.
  Kendi dizini/filmini formla ekleyebilirsin (YouTube başlık tamamlama ile).
- **Kütüphanem**: izlediklerin, kaydettiklerin, "bunlara benzer ne var?" ve kategorilere ayrılmış
  öneri geçmişi.
- Açık/koyu/sistem teması, oturum zamanlayıcısı, YouTube'u sakinleştirme ipuçları.
- Hafıza, kütüphane ve tercihler yalnızca tarayıcında (`localStorage`) tutulur.

## Kurulum (Cloudflare Workers)

Site bir Cloudflare Worker olarak `master` dalından yayınlanır (Workers Builds,
`npx wrangler versions upload`). `wrangler.toml`:

- `main = "worker/index.js"` → `/api/suggest` isteklerini karşılar,
- `[assets] directory = "./public"` → yalnızca `public/` klasöründeki site dosyaları yayınlanır,
- `[ai] binding = "AI"` → Workers AI, **ek bir panel ayarı olmadan** çalışır.

> `wrangler.toml` içindeki `name`, Cloudflare'deki Worker'ın adıyla aynı olmalı
> (şu an `youtubelove`). Farklıysa dosyadaki adı düzelt.

### İsteğe bağlı gizli değişkenler

Cloudflare → Workers & Pages → youtubelove → **Settings → Variables and secrets** (Production) altına
**Secret** olarak ekle, sonra yeniden dağıt:

| Ad | Ne işe yarar |
| --- | --- |
| `ANTHROPIC_API_KEY` | Workers AI yerine Claude kullanılır (Türkçe öneri kalitesi genelde daha iyi). |
| `ANTHROPIC_MODEL` | (İsteğe bağlı) Claude model adını değiştirir. |

Anahtarlar hiçbir zaman depoya yazılmaz; yalnızca sunucu tarafında kullanılır.

### Kendi anahtarınla (isteğe bağlı)

Ayarlar → "🔧 Gelişmiş: kendi yapay zekâ anahtarımı kullan" bölümünden tarayıcıda bir anahtar
tanımlarsan, sunucu yanıt vermediğinde öneriler doğrudan o servisten istenir. Anahtar yalnızca
tarayıcında saklanır.

## Yerel çalıştırma

Yapay zekâ uç noktası dahil tam çalıştırmak için:

```bash
npx wrangler pages dev .
```

Yalnızca arayüzü görmek için `cd public && python3 -m http.server 8000` da olur; ama bu durumda `/api/suggest`
olmadığından öneriler hata verir (Ayarlar'dan kendi anahtarını tanımlamadıysan).

## Dosya yapısı

```
wrangler.toml               Worker, statik dosyalar ve Workers AI yapılandırması
worker/index.js             Worker girişi: /api/suggest → suggest.js, gerisi public/
worker/suggest.js           yapay zekâ + YouTube uç noktası
public/index.html           tek sayfa, yan menülü arayüz
public/assets/css/styles.css tema ve bileşen stilleri
public/assets/js/aiPrompt.js       ortak istem, JSON ayrıştırma ve normalleştirme (sunucu + tarayıcı)
public/assets/js/aiClient.js       /api/suggest istemcisi, kendi anahtarla yedek yol
public/assets/js/llm.js            tarayıcıdan doğrudan yapay zekâ servisleri (kendi anahtar)
public/assets/js/app.js            arayüz, bölümler, kartlar
public/assets/js/data.js           yalnızca seçenek listeleri (ruh hali, hedef, kategori, süre)
public/assets/js/shows.js          dizi filtre seçenekleri
public/assets/js/library.js        izlediklerim / kaydettiklerim
public/assets/js/memory.js         hafıza olayları
public/assets/js/personalize.js    hafızadan yapay zekâ bağlamı üretimi
public/assets/js/recHistory.js     öneri geçmişi
public/assets/js/youtube.js        YouTube arama bağlantısı ve sıralama/süre filtreleri
public/assets/js/ytSuggest.js      YouTube başlık tamamlama
```

## Gizlilik ve not

Öneri almak için seçimlerin ve izlediğin/kaydettiğin başlıklar yapay zekâ servisine gönderilir;
bunun dışında hiçbir veri sunucuda saklanmaz. Site tıbbi tavsiye vermez; ciddi bir sıkıntı
yaşıyorsan bir uzmana başvur.
