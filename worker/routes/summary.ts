import { Hono } from 'hono';
import type { SiteMonthCell, SummaryResponse } from '../../shared/types';
import type { AppEnv } from '../types';
import { UNPAID_LINE_AMOUNT } from '../unpaid';

const summary = new Hono<AppEnv>();

/**
 * 현장 × 월 집계. 화면에서 크로스탭으로 펼쳐 쓴다.
 * unbilled_* 는 아직 어떤 명세표에도 담기지 않은(= 청구 안 한) 작업만 센다.
 * unpaid_amount 는 미입금 명세표에 찍힌 금액이다 (명세표에서 고친 금액 그대로, worker/unpaid.ts).
 */
summary.get('/summary', async (c) => {
  const { from, to, clientId } = c.req.query();

  const where = ['w.work_date >= ?', 'w.work_date <= ?'];
  const params: unknown[] = [from ?? '0000-01-01', to ?? '9999-12-31'];
  if (clientId) {
    where.push('s.client_id = ?');
    params.push(Number(clientId));
  }

  const ISSUED = `(SELECT 1 FROM statement_lines sl
                     JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                    WHERE sl.work_log_id = w.id LIMIT 1)`;

  const UNPAID = `(SELECT 1 FROM statement_lines sl
                     JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                    WHERE sl.work_log_id = w.id AND st.paid_at IS NULL LIMIT 1)`;

  const rows = await c.env.DB.prepare(
    `SELECT s.id     AS site_id,
            s.label  AS site_label,
            s.client_id,
            cl.name  AS client_name,
            substr(w.work_date, 1, 7) AS month,
            COUNT(*)                  AS count,
            SUM(w.supply_amount)      AS supply_amount,
            SUM(CASE WHEN ${ISSUED} IS NULL THEN w.supply_amount ELSE 0 END) AS unbilled_amount,
            SUM(CASE WHEN ${ISSUED} IS NULL THEN 1 ELSE 0 END)               AS unbilled_count,
            SUM(${UNPAID_LINE_AMOUNT})                                        AS unpaid_amount,
            SUM(CASE WHEN ${UNPAID} = 1 THEN 1 ELSE 0 END)                   AS unpaid_count
       FROM work_logs w
       JOIN sites   s  ON s.id  = w.site_id
       JOIN clients cl ON cl.id = s.client_id
      WHERE ${where.join(' AND ')}
      GROUP BY s.id, month
      ORDER BY cl.name, s.label, month`
  )
    .bind(...params)
    .all<SiteMonthCell>();

  const months = [...new Set(rows.results.map((r) => r.month))].sort();
  const body: SummaryResponse = { cells: rows.results, months };
  return c.json(body);
});

export default summary;
