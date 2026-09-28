-- 0006: kullanıcı profil vektörü (probe videolarının bge-m3 embedding'lerinin sinyal ağırlıklı ortalaması).
-- Video embedding'leri probe_videos.embedding sütununda (0003) tutulur.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vector       BLOB,                -- Float32 (little-endian), birim uzunlukta
  model        TEXT,
  signal_count INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
