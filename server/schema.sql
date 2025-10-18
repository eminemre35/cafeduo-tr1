-- PostgreSQL şeması
CREATE TABLE IF NOT EXISTS cafes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  cafe_id INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  code TEXT NOT NULL,             -- A1, A2 vb.
  qr_token TEXT UNIQUE NOT NULL   -- QR ile gelen token
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  personal_id TEXT UNIQUE NOT NULL,  -- cihaz/person bazlı anonim kimlik
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cafe_id INTEGER NOT NULL REFERENCES cafes(id),
  table_id INTEGER NOT NULL REFERENCES tables(id),
  public_id TEXT NOT NULL,            -- oturumluk halka açık id
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  ended_at TIMESTAMP
);

-- İstekler (eşleşme isteği)
CREATE TYPE request_status AS ENUM ('PENDING', 'AWAIT_ADMIN', 'APPROVED', 'DENIED', 'EXPIRED');
CREATE TABLE IF NOT EXISTS game_requests (
  id SERIAL PRIMARY KEY,
  cafe_id INTEGER NOT NULL REFERENCES cafes(id),
  from_table_id INTEGER NOT NULL REFERENCES tables(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  game_type TEXT NOT NULL, -- 'reflex' | 'math'
  status request_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  accepted_by_user_id INTEGER,
  accepted_table_id INTEGER,
  expires_at TIMESTAMP,       -- 2 dk TTL
  admin_expires_at TIMESTAMP  -- 60 sn TTL (AWAIT_ADMIN)
);

-- Maçlar
CREATE TYPE match_result AS ENUM ('P1_WIN', 'P2_WIN', 'DRAW', 'VOID');
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  cafe_id INTEGER NOT NULL REFERENCES cafes(id),
  game_type TEXT NOT NULL,
  p1_user_id INTEGER NOT NULL REFERENCES users(id),
  p1_table_id INTEGER NOT NULL REFERENCES tables(id),
  p2_user_id INTEGER NOT NULL REFERENCES users(id),
  p2_table_id INTEGER NOT NULL REFERENCES tables(id),
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  ended_at TIMESTAMP,
  result match_result,
  p1_score NUMERIC(4,1) DEFAULT 0,
  p2_score NUMERIC(4,1) DEFAULT 0,
  winner_user_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_user_day ON matches (p1_user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_matches_user_day2 ON matches (p2_user_id, started_at);
