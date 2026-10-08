-- ─────────────────────────────────────────────
-- 명세표 메일 보낸 기록
-- ─────────────────────────────────────────────

-- 「메일로 보내기」를 누를 때마다 한 줄. 보냈는지, 누구에게 보냈는지 명세표 화면에 보여준다.
-- 다음에 같은 거래처에 보낼 때 받는 주소를 미리 채우는 데도 쓴다.
CREATE TABLE statement_emails (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  to_addrs     TEXT    NOT NULL,              -- 쉼표로 이은 받는 주소
  subject      TEXT,
  status       TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
  error        TEXT,                          -- 실패했을 때 까닭
  sent_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX idx_statement_emails_stmt ON statement_emails(statement_id, sent_at);
