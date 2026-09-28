-- 0003: sonda (probe) video havuzu ve kalite skorları.
-- Satırlar scripts/probe ile toplanır, elle gözden geçirilir ve /api/admin/probe/import ile gelir.
-- Yalnızca status = 'approved' olanlar onboarding ve önerilerde kullanılır.

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  subscribers INTEGER,                 -- gizliyse NULL
  video_count INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS probe_videos (
  video_id         TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  channel_id       TEXT NOT NULL REFERENCES channels(id),
  published_at     TEXT,
  thumbnail_url    TEXT,
  duration_seconds INTEGER NOT NULL,
  duration_bucket  TEXT NOT NULL,
  preview_start    INTEGER NOT NULL DEFAULT 0,       -- sessiz önizlemenin başlayacağı saniye
  lang             TEXT NOT NULL,                     -- konuşma dili (ISO 639-1, "zxx" = konuşma yok)
  lang_confidence  REAL,
  lang_source      TEXT NOT NULL CHECK (lang_source IN ('fasttext', 'claude', 'manual')),
  category         TEXT NOT NULL,
  tone             TEXT NOT NULL,
  depth            TEXT NOT NULL,
  format           TEXT NOT NULL,
  lang_dependency  REAL NOT NULL CHECK (lang_dependency BETWEEN 0 AND 1),
  has_captions     INTEGER NOT NULL DEFAULT 0,
  clickbait        REAL CHECK (clickbait IS NULL OR clickbait BETWEEN 0 AND 1),
  label_source     TEXT NOT NULL CHECK (label_source IN ('claude', 'manual')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note      TEXT,
  embedding        BLOB,                              -- Aşama 6
  embedding_model  TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS probe_videos_pool ON probe_videos (status, lang, category);

-- İzlenme anlık görüntüleri; evergreen skoru iki görüntü arasındaki hızdan hesaplanır.
CREATE TABLE IF NOT EXISTS video_stats (
  video_id    TEXT NOT NULL REFERENCES probe_videos(video_id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  views       INTEGER,
  likes       INTEGER,
  comments    INTEGER,
  PRIMARY KEY (video_id, captured_at)
);

CREATE TABLE IF NOT EXISTS video_scores (
  video_id     TEXT PRIMARY KEY REFERENCES probe_videos(video_id) ON DELETE CASCADE,
  bucket       TEXT NOT NULL,          -- "tr:bilim_doga", "tr:*" ya da "*"
  outlier      REAL,                   -- bileşenler: kova içi percentile (0-1)
  like_rate    REAL,
  comment_rate REAL,
  evergreen    REAL,
  clickbait    REAL,                   -- 1 - clickbait
  quality      REAL,
  computed_at  INTEGER NOT NULL
);
