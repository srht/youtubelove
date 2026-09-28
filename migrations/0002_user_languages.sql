-- 0002: kullanıcının dil tercihleri.
-- Listede olmayan dil = "anlamıyorum". level kullanıcının beyanıdır; alpha/beta izleme
-- davranışından öğrenilen Beta dağılımıdır (ağırlık = alpha / (alpha + beta)).

CREATE TABLE IF NOT EXISTS user_languages (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,                                          -- ISO 639-1
  level      TEXT NOT NULL CHECK (level IN ('fluent', 'subtitles')),
  source     TEXT NOT NULL CHECK (source IN ('accept-language', 'user')),
  alpha      REAL NOT NULL,
  beta       REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lang)
);

ALTER TABLE users ADD COLUMN onboarded_at INTEGER;
