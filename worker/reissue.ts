/**
 * 취소한 명세표를 되살릴 때(다시 발행) 걸리는 작업을 찾는다.
 * 취소하면 담겨 있던 작업이 풀려 다른 명세표에 다시 담길 수 있다. 그 뒤에 되살리면 같은 작업이 두 장에 들어가므로 막는다.
 * (DB 의 이중 청구 트리거는 줄을 넣을 때만 보므로, 상태만 되돌리는 이 경우는 여기서 본다)
 * ? 자리에는 되살릴 명세표 id.
 */
export const REISSUE_CONFLICT_SQL = `
  SELECT mine.work_date, other.statement_id
    FROM statement_lines mine
    JOIN statement_lines other ON other.work_log_id = mine.work_log_id AND other.statement_id <> mine.statement_id
    JOIN statements st ON st.id = other.statement_id AND st.status <> 'void'
   WHERE mine.statement_id = ? AND mine.work_log_id IS NOT NULL
   ORDER BY mine.work_date`;
