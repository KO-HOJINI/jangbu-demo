-- ─────────────────────────────────────────────
-- 동시 접속 표시 + 자동 임시저장
-- ─────────────────────────────────────────────

-- 세션마다 「언제 마지막으로 움직였는지 · 어느 기기인지 · 어느 화면을 보는지」를 적어 둔다.
-- 이걸로 지금 다른 기기에서도 열어 두었는지 알 수 있다.
-- (SQLite 의 ADD COLUMN 은 기본값에 datetime('now') 같은 식을 못 쓰므로 값은 코드에서 넣는다)
ALTER TABLE sessions ADD COLUMN last_seen     TEXT;
ALTER TABLE sessions ADD COLUMN device        TEXT;   -- '윈도우 크롬' 처럼 사람이 알아볼 이름
ALTER TABLE sessions ADD COLUMN viewing       TEXT;   -- 'statement:12' — 같은 문서를 보는지 맞춰보는 열쇠
ALTER TABLE sessions ADD COLUMN viewing_label TEXT;   -- '26년 8월 아라 광장' — 화면에 보여줄 이름

UPDATE sessions SET last_seen = created_at WHERE last_seen IS NULL;

CREATE INDEX idx_sessions_seen ON sessions(last_seen);

-- 작성 중인 명세표·견적서를 서버에 담아 둔다. 발행 전이라도 다른 컴퓨터에서 이어서 할 수 있다.
--
-- draft_history 가 시간 순서대로 쌓인 기록 전체이고, drafts.current_id 가 그중 지금 보고 있는
-- 지점을 가리킨다. 되돌리기는 이 손가락을 앞뒤로 옮기는 것뿐이라 기록이 사라지지 않는다.
CREATE TABLE draft_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,          -- 'statement' | 'quote'
  payload  TEXT NOT NULL,          -- 화면이 담아 둔 JSON
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_draft_history ON draft_history(user_id, kind, id);

CREATE TABLE drafts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  -- draft_history.id 를 가리킨다. 외래키를 걸면 기록을 지울 때 순서가 까다로워져 일부러 뺐다.
  current_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
