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

Site bir Cloudflare Worker olarak `master` dalından yayınlanır (Workers Builds). `wrangler.toml`:

- `main = "worker/index.js"` → `/api/*` isteklerini karşılar, gerisi `public/`'ten sunulur,
- `[ai] binding = "AI"` → Workers AI, **ek bir panel ayarı olmadan** çalışır,
- `[[d1_databases]] youtubelove-db` → ilk yayında **otomatik oluşturulur**; `migrations/*.sql`
  Worker'ın ilk isteğinde otomatik uygulanır (elle: `npx wrangler d1 migrations apply youtubelove-db --remote`),
- `[triggers]` → her pazartesi probe havuzunun istatistiklerini yeniler, kalite skorlarını hesaplar.

> `wrangler.toml` içindeki `name`, Cloudflare'deki Worker'ın adıyla aynı olmalı
> (şu an `youtubelove`). Farklıysa dosyadaki adı düzelt.

### Gizli değişkenler

Cloudflare → Workers & Pages → youtubelove → **Settings → Variables and secrets** altına
**Secret** olarak ekle. Hiçbiri depoya yazılmaz.

| Ad | Ne işe yarar |
| --- | --- |
| `ANTHROPIC_API_KEY` | Öneriler, etiketleme ve çeviride Workers AI yerine Claude (`claude-opus-5`). |
| `ANTHROPIC_MODEL` | (İsteğe bağlı) Claude model adını değiştirir. |
| `YOUTUBE_API_KEY` | Haftalık istatistik yenileme ve çok dilli keşif. |
| `ADMIN_TOKEN` | `/api/admin/*` uç noktaları; probe havuzunu içe aktarırken kullanılır. Uzun, rastgele bir değer seç. |

### Kendi anahtarınla (isteğe bağlı)

Ayarlar → "🔧 Gelişmiş: kendi yapay zekâ anahtarımı kullan" bölümünden tarayıcıda bir anahtar
tanımlarsan, sunucu yanıt vermediğinde öneriler doğrudan o servisten istenir. Anahtar yalnızca
tarayıcında saklanır.

## Probe (sonda) video havuzu

Onboarding'de gösterilen ve profil çıkarmak için kullanılan videolar. Elle gözden geçirilir.

```bash
npm install
# 1) Topla — Claude dil başına native sorgular üretir, YouTube'da arar, fastText + Claude etiketler
YOUTUBE_API_KEY=... ANTHROPIC_API_KEY=... node scripts/probe/collect.mjs --langs tr,en
#    (--categories muzik,gezi ile daralt; --dry-run yalnızca sorguları gösterir, YouTube kotası harcamaz)

# 2) Gözden geçir — CSV'yi Excel/Sheets'te aç, status sütununu approved / rejected yap,
#    gerekirse etiketleri düzelt (elle değişen etiket "manual" olarak işaretlenir)
node scripts/probe/review.mjs scripts/probe/data/candidates-<zaman>.jsonl --to-csv
node scripts/probe/review.mjs scripts/probe/data/candidates-<zaman>.jsonl --from-csv scripts/probe/data/candidates-<zaman>.csv

# 3) Siteye aktar — kalite skorları sunucuda hesaplanır
ADMIN_TOKEN=... node scripts/probe/apply.mjs scripts/probe/data/candidates-<zaman>.jsonl --site https://<site-adresi>
```

- **Eksenler** (`worker/lib/axes.js`): kategori (sitenin kategorileri + bilim, tarih, gezi, müzik,
  dizi/film, mizah), ton, derinlik, format, süre kovası. Ayrıca dil bağımlılığı (0-1), altyazı, clickbait.
- **Dil**: `defaultAudioLanguage` kullanılmaz. Başlık + açıklamada fastText (lid.176); güven
  `config/quality.json → langDetect.minConfidence` altındaysa ya da konuşma yoksa Claude'un kararı.
- **Shorts** ve az izlenen videolar toplamada, kanal boyutu dile göre (`channelSize`) elenir.
- **Kalite skoru** (`worker/lib/quality.js`): izlenme/abone sıradışılığı, beğeni/izlenme,
  yorum/izlenme, evergreen (son dönem izlenme hızı / ömür boyu ortalama; haftalık anlık
  görüntülerden), clickbait. Oranlar **dil + kategori kovası içinde percentile**'a çevrilir;
  ağırlıklar `config/quality.json`'da.
- **Kota**: arama başına 100 birim; script başta tahmini gösterir, 10.000'i aşarsa `--yes` ister.

## Yerel çalıştırma ve testler

```bash
npm install
npm test              # Workers çalışma zamanında (Miniflare + yerel D1) bütün testler
npx wrangler dev      # site + API (Workers AI için Cloudflare girişi gerekir)
```

Yalnızca arayüzü görmek için `cd public && python3 -m http.server 8000` da olur; bu durumda
`/api` olmadığından öneriler ve "Beni tanı" çalışmaz.

## Dosya yapısı

```
wrangler.toml                 Worker, statik dosyalar, Workers AI, D1, cron
migrations/*.sql              D1 şeması (Worker ilk istekte uygular)
config/quality.json           kalite skoru ağırlıkları, kanal boyutu sınırları, dil tespiti eşiği
worker/index.js               /api yönlendiricisi + haftalık bakım
worker/suggest.js             /api/suggest — arama başlığı önerileri
worker/routes/profile.js      /api/profile — dil tercihleri, olay takibi ayarı
worker/routes/adminProbe.js   /api/admin/probe/* — havuz içe aktarma, skor, istatistik
worker/lib/                   youtube, claude (Anthropic SDK), languages, axes, quality,
                              probeLabel, probeStore, nativeQueries, migrate, user, http
scripts/probe/                collect / review / apply
test/                         vitest (@cloudflare/vitest-pool-workers)
public/index.html             tek sayfa, yan menülü arayüz
public/assets/js/app.js       arayüz, bölümler, kartlar
public/assets/js/onboarding.js "Beni tanı" akışı
public/assets/js/profileApi.js /api/profile istemcisi
public/assets/js/aiPrompt.js  ortak öneri istemi ve ayrıştırma (sunucu + tarayıcı)
public/assets/js/…            diğer arayüz modülleri (kütüphane, hafıza, geçmiş, YouTube bağlantıları)
```

## Gizlilik ve not

Öneri almak için seçimlerin ve izlediğin/kaydettiğin başlıklar yapay zekâ servisine gönderilir;
bunun dışında hiçbir veri sunucuda saklanmaz. Site tıbbi tavsiye vermez; ciddi bir sıkıntı
yaşıyorsan bir uzmana başvur.
