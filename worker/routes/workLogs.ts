import { Hono } from 'hono';
import type { LedgerResponse, WorkLog, WorkLogRow } from '../../shared/types';
import type { AppEnv } from '../types';
import { autoLearnRate } from '../learnRate';

const SELECT_ROW = `
  SELECT w.*,
         s.label   AS site_label,
         s.client_id,
         cl.name   AS client_name,
         op.name   AS operator_name,
         (SELECT sl.statement_id FROM statement_lines sl
            JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
           WHERE sl.work_log_id = w.id LIMIT 1) AS statement_id
    FROM work_logs w
    JOIN sites   s  ON s.id  = w.site_id
    JOIN clients cl ON cl.id = s.client_id
    LEFT JOIN operators op ON op.id = w.operator_id`;

const workLogs = new Hono<AppEnv>();

workLogs.get('/work-logs', async (c) => {
  const { from, to, siteId, clientId, operatorId, q } = c.req.query();

  const where: string[] = [];
  const params: unknown[] = [];
  if (from) (where.push('w.work_date >= ?'), params.push(from));
  if (to) (where.push('w.work_date <= ?'), params.push(to));
  if (siteId) (where.push('w.site_id = ?'), params.push(Number(siteId)));
  if (clientId) (where.push('s.client_id = ?'), params.push(Number(clientId)));
  if (operatorId) (where.push('w.operator_id = ?'), params.push(Number(operatorId)));
  if (q) {
    where.push('(w.description LIKE ? OR s.label LIKE ? OR w.note LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const rows = await c.env.DB.prepare(
    `${SELECT_ROW}${clause} ORDER BY w.work_date DESC, w.sort_order, w.id`
  )
    .bind(...params)
    .all<WorkLogRow>();

  const totals = rows.results.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.baseAmount += r.base_amount;
      acc.otAmount += r.ot_amount;
      acc.supplyAmount += r.supply_amount;
      acc.fuelAmount += r.fuel_amount ?? 0;
      return acc;
    },
    { count: 0, baseAmount: 0, otAmount: 0, supplyAmount: 0, vatAmount: 0, totalAmount: 0, fuelAmount: 0 }
  );
  totals.vatAmount = Math.round(totals.supplyAmount * 0.1);
  totals.totalAmount = totals.supplyAmount + totals.vatAmount;

  const body: LedgerResponse = { rows: rows.results, totals };
  return c.json(body);
});

/** 같은 날짜 안에서 맨 뒤에 붙일 순번 */
async function nextSortOrder(db: D1Database, workDate: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM work_logs WHERE work_date = ?')
    .bind(workDate)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

const FIELDS = [
  'work_date',
  'site_id',
  'description',
  'start_time',
  'end_time',
  'pour_volume',
  'boom_size',
  'ot_hours',
  'base_amount',
  'operator_id',
  'business_owner',
  'fuel_amount',
  'extra_amount',
  'note',
  'amount_auto',
  'entry_source',
] as const;

workLogs.post('/work-logs', async (c) => {
  const b = await c.req.json<Partial<WorkLog> & { rate_slot?: unknown }>();
  if (!b.work_date || !b.site_id) return c.json({ error: '날짜와 현장은 필수입니다.' }, 400);

  const values = FIELDS.map((f) => b[f] ?? null);
  const inserted = await c.env.DB.prepare(
    `INSERT INTO work_logs (${FIELDS.join(', ')}, sort_order)
     VALUES (${FIELDS.map(() => '?').join(', ')}, ?) RETURNING id`
  )
    .bind(
      ...values.map((v, i) => (FIELDS[i] === 'ot_hours' || FIELDS[i] === 'base_amount' || FIELDS[i] === 'amount_auto' ? (v ?? 0) : v)),
      b.sort_order ?? (await nextSortOrder(c.env.DB, b.work_date))
    )
    .first<{ id: number }>();

  const row = await c.env.DB.prepare(`${SELECT_ROW} WHERE w.id = ?`).bind(inserted!.id).first<WorkLogRow>();

  // M별 단가가 DB에 없던 경우 자동 등록 (방식 1: 기존 단가는 절대 덮어쓰지 않고 최초 1회 등록)
  // 등록했으면 화면이 알려 줄 수 있게 같이 돌려준다 — 처음 적은 금액이 말없이 단가가 되면 오타도 그대로 남는다
  let rateLearned: { slot: 'half_day' | 'full_day'; amount: number } | undefined;
  if (row) {
    try {
      const learned = await autoLearnRate(c.env.DB, {
        site_id: row.site_id,
        boom_size: row.boom_size,
        base_amount: row.base_amount,
        start_time: row.start_time,
        end_time: row.end_time,
        // 시간을 안 적은 줄은 화면이 하루·반나절을 물어 같이 보낸다
        slot: b.rate_slot === 'half_day' || b.rate_slot === 'full_day' ? b.rate_slot : null,
      });
      if (learned.learned) rateLearned = { slot: learned.slot, amount: learned.amount };
    } catch (e) {
      console.error('autoLearnRate error:', e);
    }
  }

  return c.json(rateLearned ? { ...row, rate_learned: rateLearned } : row, 201);
});

workLogs.patch('/work-logs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Partial<WorkLog>>();

  // 요청에 실제로 담겨 온 필드만 갱신한다 (부분 수정을 그대로 지원)
  const changed = FIELDS.filter((f) => f in b);
  if (!changed.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const updated = await c.env.DB.prepare(
    `UPDATE work_logs SET ${changed.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now')
     WHERE id = ? RETURNING id`
  )
    .bind(...changed.map((f) => b[f] ?? null), id)
    .first<{ id: number }>();
  if (!updated) return c.json({ error: '해당 작업을 찾을 수 없습니다.' }, 404);

  const row = await c.env.DB.prepare(`${SELECT_ROW} WHERE w.id = ?`).bind(id).first<WorkLogRow>();
  return c.json(row);
});

workLogs.delete('/work-logs/:id', async (c) => {
  const id = Number(c.req.param('id'));

  // 발행된 명세표에 들어간 작업은 지우지 못하게 막는다 (명세표 금액 근거가 사라지므로)
  const used = await c.env.DB.prepare(
    `SELECT st.id FROM statement_lines sl
       JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
      WHERE sl.work_log_id = ? LIMIT 1`
  )
    .bind(id)
    .first<{ id: number }>();
  if (used) {
    return c.json({ error: `이미 발행된 거래명세표(#${used.id})에 포함된 작업이라 삭제할 수 없습니다.` }, 409);
  }

  await c.env.DB.prepare('DELETE FROM work_logs WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

export default workLogs;
