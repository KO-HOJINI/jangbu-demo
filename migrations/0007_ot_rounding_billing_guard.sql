-- ─────────────────────────────────────────────
-- 전체 점검(코드 리뷰)에서 나온 것 세 가지
-- ─────────────────────────────────────────────

-- 1. OT 금액을 버림이 아니라 반올림으로
--    350,000 × 0.1 × 2.3 을 컴퓨터로 계산하면 80,499.99999… 가 되어, 소수점을 버리면 80,499원이 된다.
--    (지금까지 장부의 OT 는 1·2·3시간이라 엑셀과 모두 같았지만, 0.7시간 같은 값을 넣으면 1원이 모자랐다)
--    계산 열은 식을 고칠 수 없어 새로 붙이고 옛것을 지운다. 표를 통째로 새로 만들면
--    명세표 줄(statement_lines.work_log_id)과의 연결이 끊길 수 있어 이 방법을 쓴다.
--
--    순서가 중요하다. 0001 의 표 정의에는 계산 열 바로 앞에 「-- 엑셀 수식과 동일」 주석이 있어서,
--    맨 끝 열을 지우면 SQLite 가 닫는 괄호를 그 주석 뒤에 붙여 정의가 깨진다(incomplete input).
--    그래서 새 열을 먼저 뒤에 붙여 옛 열이 맨 끝이 아니게 한 뒤 지우고, 이름을 옛 이름으로 바꾼다.
--    (tests/money-billing.test.ts 가 실제 SQLite 에 이 파일을 올려 확인한다)
ALTER TABLE work_logs ADD COLUMN ot_amount_r INTEGER
  GENERATED ALWAYS AS (CAST(ROUND(base_amount * ot_hours / 10.0) AS INTEGER)) VIRTUAL;
ALTER TABLE work_logs ADD COLUMN supply_amount_r INTEGER
  GENERATED ALWAYS AS (base_amount + CAST(ROUND(base_amount * ot_hours / 10.0) AS INTEGER)) VIRTUAL;
ALTER TABLE work_logs DROP COLUMN ot_amount;
ALTER TABLE work_logs DROP COLUMN supply_amount;
ALTER TABLE work_logs RENAME COLUMN ot_amount_r TO ot_amount;
ALTER TABLE work_logs RENAME COLUMN supply_amount_r TO supply_amount;

-- 2. 같은 작업이 살아 있는 명세표 두 장에 들어가지 않게
--    발행할 때 「이미 발행됐나」를 먼저 보고 넣기 때문에, 두 분이 동시에 발행하면 둘 다 통과할 수 있었다.
--    DB 가 직접 막는다. 취소된 명세표에 든 것은 다시 발행할 수 있고, 손으로 추가한 줄(work_log_id 없음)은 상관없다.
CREATE TRIGGER statement_lines_no_double_billing
BEFORE INSERT ON statement_lines
WHEN NEW.work_log_id IS NOT NULL
 AND (SELECT status FROM statements WHERE id = NEW.statement_id) <> 'void'
 AND EXISTS (
   SELECT 1 FROM statement_lines l
     JOIN statements s ON s.id = l.statement_id
    WHERE l.work_log_id = NEW.work_log_id AND s.status <> 'void'
 )
BEGIN
  SELECT RAISE(ABORT, 'ALREADY_BILLED');
END;

-- 3. 로그인 실패 기록 — 같은 곳(IP)에서 15분 안에 10번 틀리면 잠시 막는다.
--    실패에 1초씩 늦추기만으로는 동시에 여러 번 넣어 보는 것을 막지 못한다. 백업에는 넣지 않는다.
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_failures ON login_failures(ip, at);
