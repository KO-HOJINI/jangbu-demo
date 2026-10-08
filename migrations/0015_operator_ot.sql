-- 야간수당(OT)은 달마다 한 칸이 아니라 한 건씩 적고, 건마다 줬는지 표시한다 (2026-10-06 사용자 결정).
CREATE TABLE operator_ot (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  work_date   TEXT    NOT NULL,                  -- 야간 작업을 한 날 (YYYY-MM-DD)
  amount      INTEGER NOT NULL,
  note        TEXT,
  paid_date   TEXT                               -- 준 날 (YYYY-MM-DD), 안 줬으면 비어 있다
);
CREATE INDEX idx_operator_ot_date ON operator_ot(work_date);

-- 달마다 적던 OT 칸은 쓰지 않는다. 이제 operator_pay 는 그 달 월급을 줬는지만 적는다.
ALTER TABLE operator_pay DROP COLUMN ot_amount;
