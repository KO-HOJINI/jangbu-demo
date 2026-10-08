-- 기사님 표에는 우리 기사님(월급을 주는 분)과 다른 사장님(외주)이 섞여 있다. 우리 기사님만 따로 표시한다.
ALTER TABLE operators ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;
UPDATE operators SET is_staff = 1 WHERE name IN ('이', '박', '김');

-- 월급은 「언제부터 얼마」로 쌓는다 — 올리거나 내려도 지난달 통계는 그때 금액 그대로 나온다.
CREATE TABLE operator_salaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  from_month  TEXT    NOT NULL,                  -- YYYY-MM, 이 달부터
  amount      INTEGER NOT NULL,                  -- 한 달 월급
  UNIQUE (operator_id, from_month)
);

-- 달마다 따로 적는 것: 그 달의 OT 금액과 줬는지.
-- 줄 때 그때의 월급을 같이 적어 두어, 나중에 월급을 바꿔도 이미 준 달은 달라지지 않는다.
CREATE TABLE operator_pay (
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  month       TEXT    NOT NULL,                  -- YYYY-MM
  ot_amount   INTEGER NOT NULL DEFAULT 0,        -- 월급 외로 주는 OT 금액 (손으로 적는다)
  paid_date   TEXT,                              -- 준 날 (YYYY-MM-DD), 안 줬으면 비어 있다
  paid_salary INTEGER,                           -- 줄 때의 월급
  PRIMARY KEY (operator_id, month)
);
