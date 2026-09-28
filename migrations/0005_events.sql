-- 0005: ham olaylar ve bunlardan türetilen video başına sinyal.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,           -- sayfa yüklemesi başına rastgele
  client_seq  INTEGER NOT NULL,        -- oturum içi sıra no (tekrar gönderimde çift kayıt olmasın)
  type        TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  surface     TEXT NOT NULL,           -- onboarding | foryou | ...
  round       INTEGER,
  position    INTEGER,
  t           REAL,                    -- oynatıcı konumu (sn)
  duration    REAL,
  watched     REAL,                    -- bu oynatıcıda gerçekten izlenen sn
  extra       TEXT,                    -- JSON: hover ms, seek from/to, çıkış nedeni…
  client_at   INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe ON events (user_id, session_id, client_seq);
CREATE INDEX IF NOT EXISTS events_user_video ON events (user_id, video_id);

-- Olaylardan türetilen sinyal (her yeni olay grubunda o videolar için yeniden hesaplanır).
CREATE TABLE IF NOT EXISTS video_signals (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  weight     REAL NOT NULL,            -- -1 (negatif) … +4 (çok güçlü pozitif)
  label      TEXT NOT NULL,            -- insan için: neden bu ağırlık
  watched    REAL NOT NULL DEFAULT 0,
  duration   REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
