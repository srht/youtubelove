# YouTubeLove 🌱

YouTube'a dalmadan önce niyetini belirlemene yardımcı olan, tamamen statik bir web sitesi.
Ruh haline ve hedefine göre kişisel gelişim / zihinsel sağlık odaklı arama önerileri sunar ve
seni doğrudan YouTube'un arama sonuçlarına yönlendirir — algoritmanın seçtiği ana sayfaya değil.

API anahtarı, backend veya build adımı gerektirmez. Hiçbir veri toplanmaz; tercihlerin yalnızca
kendi tarayıcında (`localStorage`) tutulur.

Menü üç gruba ayrılmıştır: **Öneri al** (Sana Özel, Hızlı Seçim, Kısa Test, Kategoriler),
**Keşfet** (Dizi & Film, Kütüphanem) ve **Yardım & ayar** (İpuçları, Ayarlar). İlk açılışta
Sana Özel bölümü nereden başlanacağını gösteren üç kart sunar, her bölümün sonunda "şuraya da
bakabilirsin" bağlantıları vardır ve boş listeler ilgili bölüme yönlendirir.

Bütün işlevler tek bir sayfada, soldaki menüden erişilen bölümler hâlinde toplanmıştır
(mobilde ☰ düğmesiyle açılan çekmece menü). Her bölümün kendi adresi vardır
(`#foryou`, `#quick`, `#quiz`, `#categories`, `#shows`, `#library`, `#tips`, `#settings`), böylece doğrudan
bağlantı verebilir veya yer imine ekleyebilirsin.

## Özellikler

- **Sana Özel** — “Önerileri göster” düğmesi, geçmiş seçimlerinden ve izlediklerinden oluşan bir
  hafızaya göre her seferinde yeniden derlenen karma bir liste üretir (video önerileri + dizi/film).
  Her kart neden önerildiğini söyler; aynı düğmeye tekrar basınca yeni set gelir.
- **Hızlı Seçim** — ruh halini ve hedefini seç, anında öneri al.
- **Kısa Test** — 5 soruluk bir testle daha isabetli bir profil çıkar.
- **Kategoriler** — sakinleşme, odaklanma, öğrenme, beden, yaratıcılık gibi 9 alanda göz at.
- **Dizi & Film** — aklına gelmeyen eski dizi ve filmleri hatırlatan 79 yapımlık katalog
  (Türk klasikleri + yabancı klasikler). Dönem, tür, ruh hali, yapım ve yoğunluğa göre filtrele,
  ya da "🎲 Rastgele öner" ile karar vermeyi siteye bırak.
- **Kendi yapımını ekle** — koda dokunmadan, formdan dizi/film ekle. Başlık alanına yazmaya
  başladığında YouTube'un arama önerileri açılır. Eklediğin yapımlar katalogla birlikte
  filtrelenir ve önerilere dahil olur.
- **Kapak görselleri** — YouTube bağlantısı yapıştırdıysan videonun kapağı, yoksa başlıktan
  üretilen sabit renkli bir kapak gösterilir.
- **Kütüphanem** — izlediklerini işaretle; site "bunları izledin, bir de şunlara bak" diyerek
  benzerlerini önersin. Ayrıca izleme listen, kaydettiğin öneriler ve
  **geçmiş öneriler** de burada.
- **Geçmiş öneriler** — sana yapılan tüm öneriler (Sana Özel, Hızlı Seçim, Kısa Test,
  Kategoriler, benzer öneriler ve LLM) kütüphanede **kategorilere ayrılmış** olarak birikir.
  Her kart hangi bölümden ve ne zaman geldiğini, tekrar önerildiyse kaç kez çıktığını gösterir.
- **İpuçları** — YouTube'u sakinleştirmek için bir kez yapıp unutacağın ayarlar.
- **Ayarlar (LLM)** — istersen bir yapay zekâ servisi (Anthropic / OpenAI / Google Gemini)
  tanımlayıp önerileri modelden de alabilirsin. Anahtar tanımlı değilken site tamamen
  kendi motoruyla, aynen eskisi gibi çalışır.
- **En çok izlenenler** — üretilen bütün YouTube arama bağlantıları varsayılan olarak
  **izlenme sayısına göre** sıralanır, yani öneriler seni o konunun en çok izlenen
  videolarına götürür. Menüden “İlgili” veya “En yeni” sıralamasına geçebilirsin.
- **Niyet kartı ve zamanlayıcı** — menünün altında sabit durur: YouTube'a girmeden önce ne kadar
  vakit ayıracağını seç, isteğe bağlı bir geri sayım başlat. Seçtiğin süre önerileri de filtreler.
- **Tema seçimi** — menünün üstündeki 🖥️ Sistem / ☀️ Açık / 🌙 Koyu anahtarı. Varsayılan
  “Sistem”dir (işletim sisteminin ayarını izler); açık ya da koyu seçersen sistem ne derse desin
  o geçerli olur ve tercih tarayıcında saklanır. Sayfa açılırken tema, stil hesaplanmadan önce
  uygulanır; bu yüzden yanlış temanın kısa süre görünüp değişmesi (yanıp sönme) yaşanmaz.
- Mobil uyumlu, klavye ile tam erişilebilir arayüz (menüde yön tuşlarıyla gezinme).

## Hafıza nasıl çalışıyor?

Sitede yaptığın her anlamlı hareket `assets/js/memory.js` içinde küçük bir olay kaydına yazılır:
ruh hali/hedef seçimi, test cevapları, gezdiğin kategoriler, açtığın ve kaydettiğin öneriler,
“izledim” dediğin ve kaydettiğin dizi/filmler. Her hareketin bir ağırlığı vardır (“izledim” en
güçlü sinyal) ve **eskidikçe değeri düşer** — 30 günde yarıya iner, böylece zevkin değişince
öneriler de değişir. En fazla son 300 hareket tutulur.

`assets/js/personalize.js` bu kayıtlardan bir zevk profili çıkarır (hangi hedefler, ruh halleri,
kategoriler, türler, dönemler öne çıkıyor), profili 0–1 aralığına indirger ve hem video
önerilerini hem dizi/film kataloğunu bu profile göre puanlar. Zaten izlediklerin ve daha önce
gösterilenler elenir; bu yüzden düğmeye her basışta yeni öneriler gelir.

Hafıza boşken “başlangıç seti” gösterilir. **Hafızayı sıfırla** düğmesi olay kaydını siler;
kaydettiklerin ve izlediklerin listesi (kütüphanen) durmaya devam eder, dolayısıyla profil
tamamen sıfırlanmaz — bu davranış onay penceresinde de belirtilir.

Her şey yalnızca senin tarayıcında (`localStorage`) durur; hiçbir yere gönderilmez.

## LLM önerileri (isteğe bağlı)

Her bölümde bir LLM çubuğu vardır. Servis **tanımlı değilken** çubuk gizlenmez; bunun yerine
*“🤖 Yapay zekâdan da öneri alabilirsin — Ayarlar'dan bir servis tanımla →”* yazıp doğrudan
Ayarlar'a götürür. Böylece seçeneğin varlığı ayarlara girmeden de görünür.

**Ayarlar** bölümünden bir servis seçip API anahtarı girersen, aynı çubuk
**“🤖 LLM ile öner”** düğmesine ve “Her aramada otomatik” anahtarına dönüşür. Model, YouTube'da aratılacak yeni öneriler üretir;
her kart neden önerildiğini yazar.

Her bölüm modele kendi bağlamını verir — üstüne genel zevk profilin de eklenir:

| Bölüm | Modele giden bağlam | İstenen tür |
|---|---|---|
| Sana Özel | hafızandan çıkan zevk profili | video + dizi/film |
| Hızlı Seçim | seçtiğin ruh hali, hedef ve süre | video |
| Kısa Test | test cevaplarından çıkan profil | video |
| Kategoriler | seçtiğin kategori | video |
| Dizi & Film | seçtiğin dönem/tür/yapım/yoğunluk filtreleri + izlediklerin | dizi/film |
| Kütüphanem | izlediğin yapımların listesi | dizi/film |

LLM sonuçları kendi alanında, o bölümün normal sonuçlarının üstünde gösterilir; katalog
sonuçlarını silmez.

- Desteklenen servisler: **Anthropic (Claude)**, **OpenAI**, **Google Gemini**.
- Model adı elle düzenlenebilir — model kimlikleri zamanla değişir. **Bağlantıyı test et**
  düğmesiyle ayarlarını tek tıkla doğrulayabilirsin.
- **Her aramaya ekle:** Her LLM çubuğundaki (ve Ayarlar'daki) **“Her aramada otomatik”**
  anahtarını açarsan, o bölümde yaptığın her arama sonucuna LLM önerileri de kendiliğinden
  eklenir — ayrıca düğmeye basman gerekmez. Anahtar tek bir ayardır; bir yerde değiştirince
  bütün bölümlerde aynı olur ve tarayıcında saklanır.
- **Varsayılan kapalıdır** ve istekler ücretli olduğu için boşa çağrı yapılmaz:
  - Arka arkaya filtre değiştirirken istekler beklemeye alınır (yaklaşık 1 sn), dört hızlı
    tıklama tek çağrıya iner.
  - Bağlam değişmediyse (aynı arama tekrar) yeni istek gönderilmez.
  - **“🤖 LLM ile öner”** düğmesi bu kısıtları atlar; aynı aramada bile yeniden üretir.
- Çağrı başarısız olursa o bölümde hata mesajı gösterilir; bölümün kendi (yerel) önerileri
  yerinde kalır, silinmez.

**Modelin yanıtı ayrıştırılırken** kod çiti (` ```json `), giriş/kapanış cümlesi,
`{"suggestions": [...]}` gibi sarmalayıcılar ve yanıtın token sınırında yarıda kesilmesi
gibi durumlara tolerans gösterilir; kesilmiş bir yanıttan tamamlanmış öneriler kurtarılır.
Hiçbiri tutmazsa hata mesajı modelin yanıtının ilk satırını da gösterir, böylece sorunun
nerede olduğu anlaşılır. Düşünme (thinking) adımı açık olan modeller token bütçesinin bir
kısmını oraya harcadığı için istekler geniş bir bütçeyle (`max_tokens: 8000`) gönderilir.

### ⚠️ API anahtarı güvenliği

Anahtar **yalnızca senin tarayıcında** (`localStorage`) saklanır; bu depoya, bize veya
herhangi bir sunucuya gönderilmez. İstekler tarayıcından doğrudan seçtiğin servise gider.
Buna karşılık:

- Tarayıcına erişimi olan **herkes anahtarı okuyabilir** — ortak bilgisayarda anahtar girme.
- Site herkese açık olsa bile anahtar siteye gömülü değildir; her ziyaretçi kendi anahtarını
  girer. Yani anahtarını yayınlamış olmazsın.
- Mümkünse **harcama limiti tanımlı, sadece bu iş için üretilmiş** bir anahtar kullan.
- İşin bitince **Anahtarı sil** düğmesiyle temizleyebilirsin.

Kod: sağlayıcı ayarları `assets/js/llmSettings.js`, HTTP adaptörleri `assets/js/llm.js`.
Proje build adımı olmayan saf tarayıcı JS'i olduğu ve üç sağlayıcı desteklendiği için resmî
SDK'lar yerine doğrudan `fetch` kullanılır.

## Arama sıralaması

Sol menüdeki **“Aramaları neye göre sırala?”** seçimi, sitenin ürettiği her YouTube
bağlantısına uygulanır. Varsayılan **🔥 En çok izlenen**'dir.

Bu, YouTube'un `sp` arama parametresiyle yapılır. `sp`, base64'lenmiş küçük bir
protobuf'tur:

```
alan 1 (varint)          = sıralama  (0 ilgili, 1 puan, 2 tarih, 3 izlenme)
alan 2 { alan 3 varint } = süre      (1 kısa, 2 uzun, 3 orta)
```

`assets/js/youtube.js` bu yapıyı kodlar; böylece sıralama ve süre birlikte
kullanılabilir (ör. *en çok izlenen* + *kısa* → `CAMSAhgB`) ve elle hazırlanmış bir
token tablosu tutmak gerekmez. Parametre YouTube tarafından resmî olarak belgelenmiş
değildir; değişirse `USE_SEARCH_FILTERS = false` ile tek yerden kapatılabilir — arama
yine çalışır, yalnızca sıralama/süre tercihi uygulanmaz.

LLM'den öneri istenirken de modele "çok izlenmiş, tanınmış içerikleri tercih et"
talimatı verilir.

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

**Çoğu durumda koda dokunmana gerek yok:** sitede **Dizi & Film** sekmesindeki
*"➕ Kendi dizini / filmini ekle"* formunu kullan. Eklediklerin tarayıcında saklanır
(`localStorage`), katalogla birlikte filtrelenir ve öneri motoruna dahil olur. Kartlarında
"senin eklediğin" etiketi ve bir 🗑️ silme düğmesi bulunur.

> Not: Form ile eklenenler yalnızca **o tarayıcıda** görünür. Herkeste görünmesini istediğin
> yapımları aşağıdaki gibi `shows.js` dosyasına eklemen gerekir.

### YouTube başlık önerileri nasıl çalışıyor?

Form, Google'ın herkese açık arama-önerisi ucunu (`suggestqueries.google.com`) JSONP ile
çağırır — API anahtarı, backend veya kota gerekmez. Bu uç nokta resmî olarak belgelenmiş
değildir; erişilemezse (ağ engeli veya biçim değişikliği) öneri listesi sessizce açılmaz ve
form normal şekilde çalışmayı sürdürür. İlgili kod: `assets/js/ytSuggest.js`.

Kapak görselleri için YouTube'un açık küçük resim adresi kullanılır
(`i.ytimg.com/vi/<video-id>/hqdefault.jpg`), bu da anahtar gerektirmez. Video kimliği
yoksa `assets/js/thumb.js` başlıktan sabit renkli bir kapak üretir.

### Kalıcı olarak koda eklemek

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
assets/js/customShows.js   kullanıcının formdan eklediği yapımlar (localStorage)
assets/js/memory.js        seçim/izleme geçmişinin ham kaydı (hafıza)
assets/js/personalize.js   hafızadan zevk profili ve dinamik öneriler
assets/js/recHistory.js    geçmiş önerilerin kaydı ve kategorilere ayrılması
assets/js/llmSettings.js   LLM servis seçimi ve API anahtarı saklama
assets/js/llm.js           sağlayıcıdan bağımsız LLM istemcisi (Anthropic/OpenAI/Gemini)
assets/js/ytSuggest.js     YouTube arama önerileri (JSONP, anahtarsız)
assets/js/thumb.js         kart kapak görselleri (YouTube küçük resmi / üretilmiş kapak)
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
