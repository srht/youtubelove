-- 0001: temel tablolar — anonim kullanıcılar.
-- Kullanıcı kimliği tarayıcıdaki `yl_uid` çerezidir; e-posta vb. kişisel veri tutulmaz.

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  created_at       INTEGER NOT NULL,              -- unix ms
  last_seen_at     INTEGER NOT NULL,
  tracking_enabled INTEGER NOT NULL DEFAULT 1     -- 0: olay takibi kapalı
);
