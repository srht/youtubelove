# YouTubeLove 🌱

YouTube'a dalmadan önce ne izleyeceğine niyetle karar vermen için bir ara katman.
Bütün öneriler **yapay zekâdan** gelir: sitede elle yazılmış bir video, dizi ya da film listesi yoktur.
Ziyaretçiden hiçbir API anahtarı istenmez.

## Nasıl çalışıyor?

Sitede iki öneri yolu var:

**1. Kişisel video önerileri (Beni tanı → Sana Özel)**

```
Beni tanı:  dil seçimi → 3-4 tur video ızgarası (sessiz önizleme / izleme)
               │  olaylar: impression, click, hover, oynatma, 5 sn heartbeat, seek, çıkış
               ▼
POST /api/events ──▶ video başına sinyal (izleme süresi, bitirme, ileri sarma…)
               ▼
Profil: eksen başına Beta(α, β) + dil ağırlıkları + bge-m3 profil vektörü
               ▼
POST /api/recommend ──▶ profil benzerliği × kalite skoru → dil filtresi → mood (oturum) → %15 keşif
```

- Onboarding kartları sunucuda seçilir: ilk tur geniş kapsam, sonraki turlar **Thompson sampling**
  ile en belirsiz eksenleri (konu, ton, derinlik, biçim, süre) sınar.
- Kullanıcıdan seçim istenmez; neye ne kadar baktığından öğrenilir (örtük sinyaller).
- Videolar elle gözden geçirilmiş bir **probe havuzundan** gelir (aşağıya bak).

**2. YouTube arama başlıkları (Hızlı Seçim, Test, Kategoriler, Dizi & Film)**

```
Tarayıcı ──POST /api/suggest──▶ Workers AI (anahtarsız) ya da Claude
                                  → kullanıcının dillerinde, o dilin kendi aramaları (JSON)
Tarayıcı ── başlığa tıklama ──▶ youtube.com/results?search_query=… (izlenmeye göre sıralı)
```

Seçimler (ruh hali, hedef, kategori, dizi filtreleri, test cevapları) ve süre tercihi yapay
zekâya bağlam olarak gider; yabancı dildeki başlıkların yanında Türkçe anlamı ve dil rozeti görünür.

## Özellikler

- **Beni tanı**: dil tercihi ("rahat anlıyorum" / "altyazıyla izleyebilirim" / anlamıyorum;
  tarayıcı dilinden doldurulur), ardından sessiz önizlemeli video turları.
- **Sana Özel**: kişisel video önerileri ("neden bu video?" gerekçesi, keşif işareti) ve yapay zekâ
  arama başlıkları; **🎲 Şansımı dene**, `#lucky` adresi.
- **Hızlı Seçim**, **Kısa Test**, **Kategoriler**: seçimlerin yapay zekâya bağlam olarak gider;
  Hızlı Seçim'deki ruh hali/hedef ve menüdeki süre, video önerilerine oturum filtresi olarak uygulanır.
- **Dizi & Film**, **Kütüphanem**, açık/koyu tema, zamanlayıcı, ipuçları.

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
worker/routes/onboarding.js   /api/onboarding/{next,reset} — Thompson sampling ile tur kartları
worker/routes/events.js       /api/events — toplu olay kaydı → sinyal → profil
worker/routes/recommend.js    /api/recommend — kişisel video önerileri
worker/lib/                   youtube, claude (Anthropic SDK), languages, langFilter, axes, quality,
                              probeLabel, probeStore, nativeQueries, bandit, beliefs,
                              onboardingPicker, signals, profileUpdate, embeddings, recommend,
                              mood, translate, migrate, user, http
scripts/probe/                collect / review / apply
test/                         vitest (@cloudflare/vitest-pool-workers)
public/index.html             tek sayfa, yan menülü arayüz
public/assets/js/app.js       arayüz, bölümler, kartlar
public/assets/js/onboarding.js "Beni tanı" akışı (dil + turlar)
public/assets/js/recommendations.js "Sana Özel" video önerileri
public/assets/js/videoCards.js  video kartı, sessiz önizleme, impression/hover
public/assets/js/player.js    YouTube IFrame API: önizleme, izleme penceresi, oynatma olayları
public/assets/js/events.js    olay kuyruğu → /api/events (toplu, sendBeacon)
public/assets/js/profileApi.js /api/profile istemcisi
public/assets/js/aiPrompt.js  ortak öneri istemi ve ayrıştırma (sunucu + tarayıcı)
public/assets/js/…            diğer arayüz modülleri (kütüphane, hafıza, geçmiş, YouTube bağlantıları)
```

## Gizlilik ve not

- Kimlik: tarayıcıdaki anonim `yl_uid` çerezi. E-posta, ad gibi bilgi istenmez ve saklanmaz.
- "Beni tanı" ve "Sana Özel" video kartlarında hangi videoyu gördüğün, önizlediğin ve ne kadar
  izlediğin sunucuda saklanır ve yalnızca önerileri kişiselleştirmek için kullanılır.
  **Beni tanı → "İzleme davranışımdan öğrensin"** kutusunu kapatırsan hiçbir olay kaydedilmez.
- Arama başlığı önerileri için seçimlerin ve kütüphanendeki başlıklar yapay zekâ servisine gönderilir.
- Kütüphane, hafıza ve arayüz tercihleri yalnızca tarayıcında (`localStorage`) durur.
- Site tıbbi tavsiye vermez; ciddi bir sıkıntı yaşıyorsan bir uzmana başvur.
