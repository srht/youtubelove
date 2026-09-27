# YouTubeLove 🌱

YouTube'a dalmadan önce ne izleyeceğine niyetle karar vermen için bir ara katman.
Bütün öneriler **yapay zekâdan** gelir: sitede elle yazılmış bir video, dizi ya da film listesi yoktur.
Ziyaretçiden hiçbir API anahtarı istenmez.

## Nasıl çalışıyor?

```
Tarayıcı ──POST /api/suggest──▶ Cloudflare Pages Function
                                   ├─ Workers AI (anahtar yok) ya da Claude (isteğe bağlı)
                                   │    → ilginç video / dizi / film önerileri (JSON)
                                   └─ YouTube Data API (isteğe bağlı)
                                        → her öneri için en çok izlenen gerçek video
```

1. Site, seçimlerini (ruh hali, hedef, kategori, dizi filtreleri, test cevapları), süre tercihini
   ve hafızandaki izlediğin/kaydettiğin başlıkları kısa bir metne çevirip `/api/suggest`'e gönderir.
2. `functions/api/suggest.js` bu metni yapay zekâya verir ve JSON öneri listesi alır.
   Daha önce izlediğin ve yakın zamanda önerilenler "tekrar önerme" listesiyle gönderilir.
3. `YOUTUBE_API_KEY` tanımlıysa her öneri YouTube'da **izlenme sayısına göre** aranır ve en üstteki
   gerçek video (başlık, kanal, kapak, izlenme) karta eklenir; kart doğrudan o videoya bağlanır.
   Tanımlı değilse kart, izlenmeye göre sıralı YouTube arama sonucuna gider.

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

## Kurulum (Cloudflare Pages)

Site Cloudflare Pages'te `master` dalından yayınlanır. `wrangler.toml` Workers AI bağlamasını
(`[ai] binding = "AI"`) içerdiği için **ek bir panel ayarı olmadan** yapay zekâ çalışır.

> `wrangler.toml` içindeki `name`, Cloudflare'deki Pages projesinin adıyla aynı olmalı
> (şu an `youtubelove`). Farklıysa dosyadaki adı düzelt.

### İsteğe bağlı gizli değişkenler

Cloudflare → Workers & Pages → proje → **Settings → Variables and secrets** (Production) altına
**Secret** olarak ekle, sonra yeniden dağıt:

| Ad | Ne işe yarar |
| --- | --- |
| `YOUTUBE_API_KEY` | Önerilere en çok izlenen gerçek videoyu ekler. Google Cloud Console → YouTube Data API v3'ü etkinleştir → API anahtarı oluştur. |
| `ANTHROPIC_API_KEY` | Workers AI yerine Claude kullanılır (Türkçe öneri kalitesi genelde daha iyi). |
| `ANTHROPIC_MODEL` | (İsteğe bağlı) Claude model adını değiştirir. |

Anahtarlar hiçbir zaman depoya yazılmaz; yalnızca sunucu tarafında kullanılır.

**YouTube kotası:** ücretsiz kota günde 10.000 birimdir; bir arama 100 birim harcar (≈ günde 100
yeni arama). Aynı arama 24 saat önbellekte tutulur. Kota dolarsa öneriler videosuz (arama
bağlantısıyla) gelmeye devam eder.

### Kendi anahtarınla (isteğe bağlı)

Ayarlar → "🔧 Gelişmiş: kendi yapay zekâ anahtarımı kullan" bölümünden tarayıcıda bir anahtar
tanımlarsan, sunucu yanıt vermediğinde öneriler doğrudan o servisten istenir. Anahtar yalnızca
tarayıcında saklanır.

## Yerel çalıştırma

Yapay zekâ uç noktası dahil tam çalıştırmak için:

```bash
npx wrangler pages dev .
```

Yalnızca arayüzü görmek için `python3 -m http.server 8000` da olur; ama bu durumda `/api/suggest`
olmadığından öneriler hata verir (Ayarlar'dan kendi anahtarını tanımlamadıysan).

## Dosya yapısı

```
index.html                  tek sayfa, yan menülü arayüz
assets/css/styles.css       tema ve bileşen stilleri
functions/api/suggest.js    yapay zekâ + YouTube uç noktası (Cloudflare Pages Function)
wrangler.toml               Workers AI bağlaması
assets/js/aiPrompt.js       ortak istem, JSON ayrıştırma ve normalleştirme (sunucu + tarayıcı)
assets/js/aiClient.js       /api/suggest istemcisi, kendi anahtarla yedek yol
assets/js/llm.js            tarayıcıdan doğrudan yapay zekâ servisleri (kendi anahtar)
assets/js/app.js            arayüz, bölümler, kartlar
assets/js/data.js           yalnızca seçenek listeleri (ruh hali, hedef, kategori, süre)
assets/js/shows.js          dizi filtre seçenekleri
assets/js/library.js        izlediklerim / kaydettiklerim
assets/js/memory.js         hafıza olayları
assets/js/personalize.js    hafızadan yapay zekâ bağlamı üretimi
assets/js/recHistory.js     öneri geçmişi
assets/js/youtube.js        YouTube arama bağlantısı ve sıralama/süre filtreleri
assets/js/ytSuggest.js      YouTube başlık tamamlama
```

## Gizlilik ve not

Öneri almak için seçimlerin ve izlediğin/kaydettiğin başlıklar yapay zekâ servisine gönderilir;
bunun dışında hiçbir veri sunucuda saklanmaz. Site tıbbi tavsiye vermez; ciddi bir sıkıntı
yaşıyorsan bir uzmana başvur.
