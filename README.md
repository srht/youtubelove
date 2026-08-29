# YouTubeLove 🌱

YouTube'a dalmadan önce niyetini belirlemene yardımcı olan, tamamen statik bir web sitesi.
Ruh haline ve hedefine göre kişisel gelişim / zihinsel sağlık odaklı arama önerileri sunar ve
seni doğrudan YouTube'un arama sonuçlarına yönlendirir — algoritmanın seçtiği ana sayfaya değil.

API anahtarı, backend veya build adımı gerektirmez. Hiçbir veri toplanmaz; tercihlerin yalnızca
kendi tarayıcında (`localStorage`) tutulur.

## Özellikler

- **Hızlı Seçim** — ruh halini ve hedefini seç, anında öneri al.
- **Kısa Test** — 5 soruluk bir testle daha isabetli bir profil çıkar.
- **Kategoriler** — sakinleşme, odaklanma, öğrenme, beden, yaratıcılık gibi 9 alanda göz at.
- **Dizi & Film** — aklına gelmeyen eski dizi ve filmleri hatırlatan 79 yapımlık katalog
  (Türk klasikleri + yabancı klasikler). Dönem, tür, ruh hali, yapım ve yoğunluğa göre filtrele,
  ya da "🎲 Rastgele öner" ile karar vermeyi siteye bırak.
- **Kütüphanem** — izlediklerini işaretle; site "bunları izledin, bir de şunlara bak" diyerek
  benzerlerini önersin. Ayrıca izleme listen ve kaydettiğin öneriler de burada.
- **Niyet kartı ve zamanlayıcı** — YouTube'a girmeden önce ne kadar vakit ayıracağını seç,
  isteğe bağlı bir geri sayım başlat.
- **Bugünün önerisi** — her gün sabit, tarihe göre değişen bir öneri.
- Açık/koyu tema, mobil uyumlu, klavye ile tam erişilebilir arayüz.

## Yerel çalıştırma

Modüller `<script type="module">` ile yüklendiği için `index.html` dosyasını doğrudan
`file://` ile açmak tarayıcı güvenlik kısıtları yüzünden çalışmayabilir. Basit bir yerel
sunucu ile açman yeterli:

```bash
python3 -m http.server 8000
```

Sonra tarayıcıda `http://localhost:8000` adresine git.

## GitHub Pages'te yayınlama

1. Depo ayarlarında **Settings → Pages** bölümüne git.
2. Kaynak olarak `main` (veya yayınlamak istediğin dal) ve kök dizini (`/`) seç.
3. Kaydet; birkaç dakika içinde site `https://<kullanici>.github.io/<depo-adi>/` adresinde yayında olur.

Ekstra build adımı gerekmez — dosyalar olduğu gibi servis edilir.

## Yeni öneri ekleme

Tüm öneriler `assets/js/data.js` içindeki `ITEMS` dizisinde tutulur. Yeni bir kayıt eklemek için
aşağıdaki şablonu kopyalayıp diziye ekle:

```js
{
  id: "essiz-bir-kimlik",              // benzersiz, kebab-case
  title: "Kısa başlık",
  description: "Bir-iki cümlelik açıklama.",
  queryTr: "youtube'da aranacak türkçe sorgu",
  queryEn: "english search query for youtube",
  category: "sakinlesme",              // CATEGORIES içindeki bir id
  moods: ["kaygili", "yorgun"],        // MOODS içindeki id'ler
  goals: ["sakinlesmek"],              // GOALS içindeki id'ler
  energy: "dusuk",                     // dusuk | orta | yuksek
  duration: "kisa",                    // kisa | orta | uzun
  why: "Bu önerinin neden işe yaradığına dair kısa bir açıklama.",
}
```

`category`, `moods`, `goals`, `energy` ve `duration` alanlarındaki değerler mutlaka aynı dosyanın
başındaki `CATEGORIES`, `MOODS`, `GOALS`, `ENERGY_LEVELS`, `DURATIONS` sabitlerinde tanımlı
olmalı — aksi halde öneri motoru o kaydı hiç eşleştiremez.

Yeni bir kategori, ruh hali veya hedef eklemek istersen, önce ilgili sabit listeye (`CATEGORIES`,
`MOODS`, `GOALS`) yeni bir `{id, label, emoji, description}` girişi ekle, sonra öneri kayıtlarında
kullan.

## Yeni dizi/film ekleme

Dizi ve filmler `assets/js/shows.js` içindeki `SHOWS` dizisinde tutulur:

```js
{
  id: "essiz-kimlik",
  title: "Yapımın adı",
  startYear: 1989,                 // dönem bundan otomatik hesaplanır
  yearLabel: "1989–2002",          // kartta gösterilen yıl metni
  type: "dizi",                    // dizi | film
  origin: "turk",                  // turk | yabanci
  genres: ["aile", "dram"],        // SHOW_GENRES id'leri
  moods: ["nostaljik"],            // SHOW_MOODS id'leri
  intensity: "hafif",              // hafif | orta | agir
  description: "Bir-iki cümlelik tanıtım.",
  why: "Neden bilinçli bir izleme seçimi olduğuna dair kısa not.",
  queryTr: "youtube'da aranacak sorgu",
  similar: ["baska-yapim-id", "bir-digeri"],   // mevcut id'ler olmalı
}
```

`similar` alanı öneri motorunun en güçlü sinyalidir: iki yapımı karşılıklı olarak birbirine
eklemen gerekmez, motor her iki yönü de sayar. `intensity: "agir"` işaretlenen yapımlar kartta
kırmızı bir etiketle gösterilir — kaygılı bir günde ne seçtiğini bilerek seçebilesin diye.

## Dosya yapısı

```
index.html                 tek sayfa, sekmeli arayüz
assets/css/styles.css      tema ve bileşen stilleri
assets/js/data.js          öneri kütüphanesi ve sabitler
assets/js/shows.js         dizi & film kataloğu ve sabitleri
assets/js/youtube.js       YouTube arama URL'i üretimi
assets/js/recommend.js     öneri eşleştirme/skorlama motoru
assets/js/showRecommend.js dizi/film filtreleme ve benzerlik motoru
assets/js/quiz.js          kısa test akışı
assets/js/storage.js       localStorage sarmalayıcı
assets/js/app.js           arayüz bağlama ve olaylar
```

## Not

Bu site tıbbi tavsiye vermez. Kaygı, uyku veya ruh hali ile ilgili ciddi zorluklar yaşıyorsan
bir uzmana danışmanı öneririz.
