-- 메일 보내는 네이버 계정을 여러 개 등록해 두고, 보낼 때 고른다.
-- 비밀번호는 네이버의 「애플리케이션 비밀번호」이고, 서버 열쇠로 잠근 글자만 여기 들어간다 (worker/mailVault.ts).
-- 이 표는 백업에 담지 않는다 — 잠근 글자라도 내려받은 백업 파일에 섞여 돌아다니지 않게.

CREATE TABLE mail_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT,                              -- 화면에 보일 이름 (예: 한강중기)
  username     TEXT    NOT NULL UNIQUE,           -- 네이버 아이디 (주소 전체를 적어도 된다)
  password_enc TEXT    NOT NULL,                  -- 잠근 애플리케이션 비밀번호
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 어느 계정으로 보냈는지 (웹메일 창으로 보낸 기록은 비어 있다)
ALTER TABLE statement_emails ADD COLUMN from_addr TEXT;

-- 견적서를 메일로 보낸 기록 (명세표의 statement_emails 와 같은 모양)
CREATE TABLE quote_emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  to_addrs   TEXT    NOT NULL,
  subject    TEXT,
  status     TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
  error      TEXT,
  from_addr  TEXT,
  sent_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_quote_emails_quote ON quote_emails(quote_id, sent_at);
