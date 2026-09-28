-- 0004: onboarding turları, eksen inançları ve çevrilmiş başlıklar.

-- Her eksen değeri için Beta(alpha, beta). Satır yoksa önsel Beta(1, 1).
-- Olaylardan türetilen sinyaller (Aşama 5) bu tabloyu günceller.
CREATE TABLE IF NOT EXISTS user_axis_beliefs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  axis       TEXT NOT NULL,     -- category | tone | depth | format | duration
  value      TEXT NOT NULL,
  alpha      REAL NOT NULL DEFAULT 1,
  beta       REAL NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, axis, value)
);

CREATE TABLE IF NOT EXISTS onboarding_rounds (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  video_ids  TEXT NOT NULL,     -- JSON dizi, gösterim sırasıyla
  focus_axes TEXT NOT NULL,     -- JSON dizi; ilk turda []
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, round)
);

CREATE TABLE IF NOT EXISTS video_title_translations (
  video_id   TEXT NOT NULL,
  lang       TEXT NOT NULL,
  title      TEXT NOT NULL,
  source     TEXT NOT NULL,     -- m2m100 | claude
  created_at INTEGER NOT NULL,
  PRIMARY KEY (video_id, lang)
);
