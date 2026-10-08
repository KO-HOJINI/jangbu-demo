/**
 * 미수금 = 발행했는데(취소 아님) 아직 입금 처리하지 않은 명세표에 찍힌 공급가액.
 *
 * 예전에는 장부(work_logs) 금액을 더했다. 그러면 명세표에서 금액을 고친 줄은 고치기 전 금액으로 세고,
 * 장부에 없는 줄(「+ 줄 추가」, 「직접 입력」 명세표)은 입금이 안 되어도 미수금에 잡히지 않았다.
 */

/** 장부 한 줄(w)이 미입금 명세표에 찍힌 금액. 안 담겼거나 입금했으면 0 — 현장별 화면(현장·달마다 더한다) */
export const UNPAID_LINE_AMOUNT = `COALESCE((SELECT sl.supply_amount FROM statement_lines sl
    JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
   WHERE sl.work_log_id = w.id AND st.paid_at IS NULL LIMIT 1), 0)`;

/** 기간(? ~ ?, 줄의 작업 날짜) 안의 미수금 전체 — 손으로 적은 줄과 「직접 입력」 명세표까지 (대시보드) */
export const UNPAID_TOTAL_SQL = `
  SELECT COALESCE(SUM(sl.supply_amount), 0) AS amount
    FROM statement_lines sl
    JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void' AND st.paid_at IS NULL
   WHERE sl.work_date >= ? AND sl.work_date <= ?`;

/** 기간(? ~ ?) 안의 미수금을 거래처별로 — 통계의 「거래처별」 상자. 명세표가 가리키는 거래처로 묶는다 */
export const UNPAID_BY_CLIENT_SQL = `
  SELECT st.client_id AS client_id, c.name AS name, COALESCE(SUM(sl.supply_amount), 0) AS amount
    FROM statement_lines sl
    JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void' AND st.paid_at IS NULL
    JOIN clients c ON c.id = st.client_id
   WHERE sl.work_date >= ? AND sl.work_date <= ?
   GROUP BY st.client_id`;

/** 명세표·견적서의 상태 — 취소한 문서는 줄을 고치지 못하게 막는 데 쓴다 */
export const DOC_STATUS_SQL = (table: 'statements' | 'quotes') => `SELECT status FROM ${table} WHERE id = ?`;

/** 줄을 고쳐도 되는 문서인지. 안 되면 화면에 보일 말을 돌려준다 */
export async function lineEditBlock(
  db: D1Database,
  table: 'statements' | 'quotes',
  id: number
): Promise<{ error: string; status: 400 | 404 } | null> {
  const name = table === 'statements' ? '거래명세표' : '견적서';
  const doc = await db.prepare(DOC_STATUS_SQL(table)).bind(id).first<{ status: string }>();
  if (!doc) return { error: `${name}를 찾을 수 없습니다.`, status: 404 };
  if (doc.status === 'void') return { error: `취소한 ${name}는 고칠 수 없습니다. 다시 발행한 뒤 고쳐 주세요.`, status: 400 };
  return null;
}
