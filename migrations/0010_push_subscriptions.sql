-- ─────────────────────────────────────────────
-- 휴대폰·PC 알림 (웹 푸시)
-- ─────────────────────────────────────────────

-- 「이 기기에서 알림 받기」를 누른 기기마다 한 줄.
-- endpoint 는 브라우저 회사 푸시 서버의 주소, p256dh·auth 는 그 기기만 풀 수 있게 암호화하는 열쇠다.
-- 로그인(sessions)처럼 기기에 딸린 것이라 백업에는 넣지 않는다 (되살리면 오히려 끊긴 기기로 보낸다).
CREATE TABLE push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth         TEXT    NOT NULL,
  device       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  -- 마지막으로 보낸 때와 결과 ('ok' / 'error') — 설정 화면에서 잘 받고 있는지 보여준다
  last_sent_at TEXT,
  last_status  TEXT
);
