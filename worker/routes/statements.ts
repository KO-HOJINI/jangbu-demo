import { Hono } from 'hono';
import { REISSUE_CONFLICT_SQL } from '../reissue';
import { removeVoidSql } from '../mailAccounts';
import type {
  Client,
  Company,
  Site,
  Statement,
  StatementCreateInput,
  StatementDetail,
  StatementLine,
  StatementLineStatus,
  StatementListItem,
  StatementManualLine,
  StatementPayInput,
  StatementPreview,
  StatementPreviewLine,
  StatementTotals,
} from '../../shared/types';
import { customerSnapshot, manualClientId, MANUAL_CLIENT_NAME, typedCustomerName } from '../manualCustomer';
import type { AppEnv } from '../types';
import { koreaToday } from './alerts';
import { lineEditBlock } from '../unpaid';

/** 명세표에 찍히는 값들만 모아 해시 — 발행 뒤 장부가 바뀌었는지 알아내는 용도 */
async function sourceHash(line: {
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
}): Promise<string> {
  const canonical = [
    line.work_date,
    line.description ?? '',
    line.start_time ?? '',
    line.end_time ?? '',
    line.ot_hours,
    line.boom_size ?? '',
    line.supply_amount,
  ].join('|');

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * 합계. 세액은 줄마다 반올림한 값을 더하지 않고 공급가액 총액에 세율을 적용한다
 * (원본 엑셀의 J31 = H31 * 0.1 과 같은 방식).
 */
export function sumTotals(lines: { supply_amount: number }[], vatRate = 0.1): StatementTotals {
  const supplyAmount = lines.reduce((s, l) => s + l.supply_amount, 0);
  const vatAmount = Math.round(supplyAmount * vatRate);
  return { count: lines.length, supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount };
}

/** 발행할 때 장부에서 다시 읽어 오는 한 줄 */
type LedgerLine = {
  id: number;
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
  issued_statement_id: number | null;
};

const MAX_MANUAL_LINES = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 손으로 적은 줄을 다듬는다. 숫자 칸에 숫자가 아닌 게 있으면 null.
 * 날짜가 없거나 이상하면 기간 끝날로 둔다 (화면의 「+ 줄 추가」 도 기간 끝날로 시작한다).
 */
export function normalizeManualLines(raw: unknown, fallbackDate: string): StatementManualLine[] | null {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown, max = 100) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

  const out: StatementManualLine[] = [];
  for (const item of raw.slice(0, MAX_MANUAL_LINES)) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const supply = num(l.supply_amount);
    const ot = num(l.ot_hours);
    const boom = l.boom_size == null || l.boom_size === '' ? null : Number(l.boom_size);
    if (!Number.isFinite(supply) || !Number.isFinite(ot) || (boom != null && !Number.isFinite(boom))) return null;
    out.push({
      work_date: typeof l.work_date === 'string' && ISO_DATE.test(l.work_date) ? l.work_date : fallbackDate,
      description: text(l.description),
      start_time: text(l.start_time, 5),
      end_time: text(l.end_time, 5),
      ot_hours: ot,
      boom_size: boom,
      supply_amount: Math.round(supply),
    });
  }
  return out;
}

const statements = new Hono<AppEnv>();

// ── 발행 대상 미리보기 ──────────────────────────────────────────────────
statements.get('/statements/preview', async (c) => {
  const { clientId, siteId, from, to } = c.req.query();
  if (!clientId || !from || !to) {
    return c.json({ error: '거래처와 기간을 지정해 주세요.' }, 400);
  }

  // 등록한 현장의 작업일보만 찾는다. 「직접 입력」 현장은 장부에 없으니 화면에서 손으로 적는다.
  const where = ['s.client_id = ?', 'w.work_date >= ?', 'w.work_date <= ?'];
  const params: unknown[] = [Number(clientId), from, to];
  if (siteId) {
    where.push('w.site_id = ?');
    params.push(Number(siteId));
  }

  const rows = await c.env.DB.prepare(
    `SELECT w.id AS work_log_id, w.work_date, w.description, w.start_time, w.end_time,
            w.ot_hours, w.boom_size, w.supply_amount,
            (SELECT sl.statement_id FROM statement_lines sl
               JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
              WHERE sl.work_log_id = w.id LIMIT 1) AS issued_statement_id
       FROM work_logs w
       JOIN sites s ON s.id = w.site_id
      WHERE ${where.join(' AND ')}
      ORDER BY w.work_date, w.sort_order, w.id`
  )
    .bind(...params)
    .all<Omit<StatementPreviewLine, 'vat_amount'>>();

  const lines: StatementPreviewLine[] = rows.results.map((r) => ({
    ...r,
    vat_amount: Math.round(r.supply_amount * 0.1),
  }));

  // 합계는 아직 발행되지 않은 줄(= 실제로 담길 줄)만 센다
  const billable = lines.filter((l) => l.issued_statement_id == null);
  const body: StatementPreview = { lines, totals: sumTotals(billable) };
  return c.json(body);
});

// ── 목록 ────────────────────────────────────────────────────────────────
statements.get('/statements', async (c) => {
  const { clientId, siteId, from, to } = c.req.query();

  const where: string[] = [];
  const params: unknown[] = [];
  if (clientId) (where.push('st.client_id = ?'), params.push(Number(clientId)));
  if (siteId) (where.push('st.site_id = ?'), params.push(Number(siteId)));
  if (from) (where.push('st.period_end >= ?'), params.push(from));
  if (to) (where.push('st.period_start <= ?'), params.push(to));
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const rows = await c.env.DB.prepare(
    `SELECT st.*,
            CASE WHEN cl.name = ? THEN st.customer_name ELSE cl.name END AS client_name,
            s.label AS site_label,
            COUNT(sl.id)                       AS line_count,
            COALESCE(SUM(sl.supply_amount), 0) AS supply_amount
       FROM statements st
       JOIN clients cl ON cl.id = st.client_id
       LEFT JOIN sites s ON s.id = st.site_id
       LEFT JOIN statement_lines sl ON sl.statement_id = st.id
       ${clause}
      GROUP BY st.id
      ORDER BY st.issue_date DESC, st.id DESC`
  )
    .bind(MANUAL_CLIENT_NAME, ...params)
    .all<StatementListItem>();

  const body = rows.results.map((r) => {
    const vat = Math.round(r.supply_amount * r.vat_rate);
    return { ...r, vat_amount: vat, total_amount: r.supply_amount + vat };
  });
  return c.json(body);
});

// ── 상세 ────────────────────────────────────────────────────────────────
statements.get('/statements/:id', async (c) => {
  const id = Number(c.req.param('id'));

  const statement = await c.env.DB.prepare('SELECT * FROM statements WHERE id = ?')
    .bind(id)
    .first<Statement>();
  if (!statement) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);

  const lines = await c.env.DB.prepare(
    `SELECT sl.*,
            w.work_date   AS w_work_date,
            w.description AS w_description,
            w.start_time  AS w_start_time,
            w.end_time    AS w_end_time,
            w.ot_hours    AS w_ot_hours,
            w.boom_size   AS w_boom_size,
            w.supply_amount AS w_supply_amount
       FROM statement_lines sl
       LEFT JOIN work_logs w ON w.id = sl.work_log_id
      WHERE sl.statement_id = ?
      ORDER BY sl.line_no`
  )
    .bind(id)
    .all<StatementLine & Record<string, unknown>>();

  const withStatus: StatementLineStatus[] = await Promise.all(
    lines.results.map(async (row) => {
      const missing = row.work_log_id != null && row.w_work_date == null;
      let changed = false;

      // 명세표에서 직접 고친 줄은 장부와 다른 게 당연하므로 대조하지 않는다
      if (!missing && !row.edited && row.work_log_id != null && row.source_hash) {
        const current = await sourceHash({
          work_date: row.w_work_date as string,
          description: row.w_description as string | null,
          start_time: row.w_start_time as string | null,
          end_time: row.w_end_time as string | null,
          ot_hours: row.w_ot_hours as number,
          boom_size: row.w_boom_size as number | null,
          supply_amount: row.w_supply_amount as number,
        });
        changed = current !== row.source_hash;
      }

      const {
        w_work_date: _a,
        w_description: _b,
        w_start_time: _c,
        w_end_time: _d,
        w_ot_hours: _e,
        w_boom_size: _f,
        w_supply_amount: _g,
        ...line
      } = row;
      return { ...(line as StatementLine), changed, missing };
    })
  );

  const body: StatementDetail = {
    statement,
    lines: withStatus,
    totals: sumTotals(withStatus, statement.vat_rate),
  };
  return c.json(body);
});

// ── 발행 ────────────────────────────────────────────────────────────────
statements.post('/statements', async (c) => {
  const input = await c.req.json<StatementCreateInput>();
  const { company_id, site_id, issue_date, period_start, period_end } = input;
  // 「직접 입력」: 장부에 없는 곳이라 이름만 쳐 넣는다. 거래처·현장·장부 줄은 쓰지 않는다
  const typedCustomer = typedCustomerName(input.customer_name);
  const work_log_ids = Array.isArray(input.work_log_ids) ? input.work_log_ids : [];

  if (!company_id || !issue_date || !period_start || !period_end) {
    return c.json({ error: '공급자·발행일·기간은 필수입니다.' }, 400);
  }
  if (!typedCustomer && !input.client_id) {
    return c.json({ error: '거래처를 고르거나 받는 곳 이름을 적어 주세요.' }, 400);
  }
  if (typedCustomer && work_log_ids.length) {
    return c.json({ error: '직접 입력 명세표에는 장부 작업을 담을 수 없습니다. 줄을 손으로 적어 주세요.' }, 400);
  }
  const manualLines = normalizeManualLines(input.manual_lines, period_end);
  if (manualLines == null) {
    return c.json({ error: '손으로 적은 줄의 금액·시간·규격 칸에는 숫자만 적어 주세요.' }, 400);
  }
  if (!work_log_ids.length && !manualLines.length) {
    return c.json({ error: '명세표에 담을 작업을 하나 이상 선택하거나 줄을 적어 주세요.' }, 400);
  }
  const db = c.env.DB;
  const client_id = typedCustomer ? await manualClientId(db) : input.client_id!;
  const company = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(company_id).first<Company>();
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(client_id).first<Client>();
  if (!company || !client) return c.json({ error: '공급자 또는 거래처를 찾을 수 없습니다.' }, 400);

  const site = site_id && !typedCustomer
    ? await db.prepare('SELECT * FROM sites WHERE id = ?').bind(site_id).first<Site>()
    : null;
  if (site_id && !typedCustomer && !site) return c.json({ error: '현장을 찾을 수 없습니다.' }, 400);

  const customer = customerSnapshot(client, typedCustomer);

  // 금액은 요청 값을 믿지 않고 장부에서 다시 읽는다.
  // 손으로 적은 줄만 있는 명세표(등록하지 않은 임시 현장)는 장부를 읽지 않는다 — 빈 IN () 은 SQL 오류다.
  const placeholders = work_log_ids.map(() => '?').join(', ');
  const logs = !work_log_ids.length
    ? { results: [] as LedgerLine[] }
    : await db
    .prepare(
      `SELECT w.id, w.work_date, w.description, w.start_time, w.end_time, w.ot_hours,
              w.boom_size, w.supply_amount,
              (SELECT sl.statement_id FROM statement_lines sl
                 JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                WHERE sl.work_log_id = w.id LIMIT 1) AS issued_statement_id
         FROM work_logs w
        WHERE w.id IN (${placeholders})
        ORDER BY w.work_date, w.sort_order, w.id`
    )
    .bind(...work_log_ids)
    .all<LedgerLine>();

  if (logs.results.length !== work_log_ids.length) {
    return c.json({ error: '선택한 작업 중 일부를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' }, 409);
  }
  const duplicated = logs.results.filter((l) => l.issued_statement_id != null);
  if (duplicated.length) {
    return c.json(
      {
        error: `이미 다른 명세표에 발행된 작업이 ${duplicated.length}건 있습니다. (예: ${duplicated[0].work_date}, 명세표 #${duplicated[0].issued_statement_id})`,
      },
      409
    );
  }

  // 명세표 머리와 줄을 한 묶음(트랜잭션)으로 넣는다.
  //  - 중간에 실패하면 통째로 취소되어 빈 명세표가 남지 않는다.
  //  - 두 분이 동시에 같은 작업을 발행하면, 위의 확인을 둘 다 통과해도 DB 트리거
  //    (statement_lines_no_double_billing, 0007)가 뒤에 들어온 쪽을 거부한다.
  const header = db
    .prepare(
      `INSERT INTO statements (
         company_id, client_id, site_id, issue_date, period_start, period_end,
         supplier_name, supplier_biz_no, supplier_ceo, supplier_address,
         supplier_biz_type, supplier_biz_item, supplier_tel, supplier_fax,
         customer_name, customer_biz_no, customer_ceo, customer_address, customer_site_name,
         note, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
    .bind(
      company_id,
      client_id,
      typedCustomer ? null : (site_id ?? null),
      issue_date,
      period_start,
      period_end,
      company.name,
      company.biz_no,
      company.ceo_name,
      company.address,
      company.biz_type,
      company.biz_item,
      company.tel,
      company.fax,
      customer.customer_name,
      customer.customer_biz_no,
      customer.customer_ceo,
      customer.customer_address,
      site?.name ?? null,
      input.note ?? null,
      c.get('user').id
    );

  // 장부 줄과 손으로 적은 줄을 날짜 순서로 섞어 번호를 매긴다 (같은 날이면 장부 줄이 먼저).
  // 손으로 적은 줄은 장부와 연결되지 않으므로(work_log_id 없음) 처음부터 「고친 줄」로 둔다 — 장부와 대조하지 않는다.
  const ordered = [
    ...logs.results.map((log) => ({ log, manual: null as StatementManualLine | null })),
    ...manualLines.map((manual) => ({ log: null as LedgerLine | null, manual })),
  ].sort((a, b) => (a.log ?? a.manual!).work_date.localeCompare((b.log ?? b.manual!).work_date));

  // 줄은 머리의 번호를 알아야 한다. 같은 묶음 안이라 방금 매겨진 번호(sqlite_sequence)를 쓴다.
  const lines = await Promise.all(
    ordered.map(async ({ log, manual }, i) => {
      const line = (log ?? manual)!;
      return db
        .prepare(
          `INSERT INTO statement_lines (
             statement_id, work_log_id, line_no, work_date, description, start_time, end_time,
             ot_hours, boom_size, supply_amount, vat_amount, source_hash, edited
           ) VALUES ((SELECT seq FROM sqlite_sequence WHERE name = 'statements'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log?.id ?? null,
          i + 1,
          line.work_date,
          line.description,
          line.start_time,
          line.end_time,
          line.ot_hours,
          line.boom_size,
          line.supply_amount,
          Math.round(line.supply_amount * 0.1),
          log ? await sourceHash(log) : null,
          log ? 0 : 1
        );
    })
  );

  let statementId: number;
  try {
    const [created] = await db.batch([header, ...lines]);
    statementId = (created.results[0] as { id: number }).id;
  } catch (error) {
    if (String(error).includes('ALREADY_BILLED')) {
      return c.json({ error: '방금 다른 곳에서 같은 작업을 먼저 발행했습니다. 새로고침한 뒤 다시 확인해 주세요.' }, 409);
    }
    throw error;
  }

  return c.json({ id: statementId }, 201);
});

// ── 명세표 직접 수정 (표의 칸을 눌러 고치는 경우) ───────────────────────
// 여기서 고친 값은 이 명세표 문서에만 반영되고 장부(work_logs)는 건드리지 않는다.

const HEADER_FIELDS = [
  'issue_date',
  'note',
  'customer_name',
  'customer_biz_no',
  'customer_ceo',
  'customer_address',
  'customer_site_name',
  'supplier_name',
  'supplier_biz_no',
  'supplier_ceo',
  'supplier_address',
  'supplier_biz_type',
  'supplier_biz_item',
  'supplier_tel',
  'supplier_fax',
  'paid_at',
  'paid_amount',
  'paid_memo',
] as const;

statements.patch('/statements/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  const changed = HEADER_FIELDS.filter((f) => f in body);
  if (!changed.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE statements SET ${changed.map((f) => `${f} = ?`).join(', ')} WHERE id = ? RETURNING id`
  )
    .bind(...changed.map((f) => body[f] ?? null), id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);

  return c.body(null, 204);
});

const LINE_FIELDS = [
  'work_date',
  'description',
  'start_time',
  'end_time',
  'ot_hours',
  'boom_size',
  'supply_amount',
] as const;

statements.patch('/statements/:id/lines/:lineId', async (c) => {
  const statementId = Number(c.req.param('id'));
  const lineId = Number(c.req.param('lineId'));
  const body = await c.req.json<Record<string, unknown>>();

  const changed = LINE_FIELDS.filter((f) => f in body);
  if (!changed.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);
  const blocked = await lineEditBlock(c.env.DB, 'statements', statementId);
  if (blocked) return c.json({ error: blocked.error }, blocked.status);

  const sets = changed.map((f) => `${f} = ?`);
  const values: unknown[] = changed.map((f) => body[f] ?? null);

  // 공급가액을 고치면 세액도 같이 다시 계산한다
  if ('supply_amount' in body) {
    sets.push('vat_amount = ?');
    values.push(Math.round(Number(body.supply_amount ?? 0) * 0.1));
  }
  // 한 번이라도 직접 고친 줄은 이후 장부와 대조하지 않는다
  sets.push('edited = 1');

  const row = await c.env.DB.prepare(
    `UPDATE statement_lines SET ${sets.join(', ')} WHERE id = ? AND statement_id = ? RETURNING id`
  )
    .bind(...values, lineId, statementId)
    .first<{ id: number }>();
  if (!row) return c.json({ error: '해당 줄을 찾을 수 없습니다.' }, 404);

  return c.body(null, 204);
});

statements.post('/statements/:id/lines', async (c) => {
  const statementId = Number(c.req.param('id'));

  const statement = await c.env.DB.prepare('SELECT period_end, status FROM statements WHERE id = ?')
    .bind(statementId)
    .first<{ period_end: string; status: string }>();
  if (!statement) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  if (statement.status === 'void') return c.json({ error: '취소한 거래명세표는 고칠 수 없습니다. 다시 발행한 뒤 고쳐 주세요.' }, 400);

  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM statement_lines WHERE statement_id = ?'
  )
    .bind(statementId)
    .first<{ n: number }>();

  await c.env.DB.prepare(
    `INSERT INTO statement_lines (statement_id, line_no, work_date, supply_amount, vat_amount, edited)
     VALUES (?, ?, ?, 0, 0, 1)`
  )
    .bind(statementId, next!.n, statement.period_end)
    .run();

  return c.body(null, 204);
});

statements.delete('/statements/:id/lines/:lineId', async (c) => {
  const blocked = await lineEditBlock(c.env.DB, 'statements', Number(c.req.param('id')));
  if (blocked) return c.json({ error: blocked.error }, blocked.status);
  await c.env.DB.prepare('DELETE FROM statement_lines WHERE id = ? AND statement_id = ?')
    .bind(Number(c.req.param('lineId')), Number(c.req.param('id')))
    .run();
  return c.body(null, 204);
});

// ── 입금 처리 / 취소 ───────────────────────────────────────────────────
statements.post('/statements/:id/pay', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json<StatementPayInput>().catch(() => ({} as StatementPayInput))) || ({} as StatementPayInput);
  // 워커 시계는 UTC 라 한국 날짜로 바꿔 쓴다 (그냥 두면 자정~아침 9시에는 어제 날짜가 된다)
  const paidAt = body.paid_at || koreaToday();

  const stmt = await c.env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(id).first<Statement>();
  if (!stmt) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  if (stmt.status === 'void') return c.json({ error: '취소된 명세표는 입금 처리할 수 없습니다.' }, 400);

  let paidAmount = body.paid_amount;
  if (paidAmount === undefined || paidAmount === null) {
    const lines = await c.env.DB.prepare('SELECT supply_amount FROM statement_lines WHERE statement_id = ?')
      .bind(id)
      .all<{ supply_amount: number }>();
    const supply = lines.results.reduce((s, l) => s + l.supply_amount, 0);
    paidAmount = supply + Math.round(supply * stmt.vat_rate);
  }

  await c.env.DB.prepare(
    'UPDATE statements SET paid_at = ?, paid_amount = ?, paid_memo = ? WHERE id = ?'
  )
    .bind(paidAt, paidAmount, body.paid_memo ?? null, id)
    .run();

  return c.json({ ok: true, paid_at: paidAt, paid_amount: paidAmount, paid_memo: body.paid_memo ?? null });
});

statements.post('/statements/:id/unpay', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    'UPDATE statements SET paid_at = NULL, paid_amount = NULL, paid_memo = NULL WHERE id = ? RETURNING id'
  )
    .bind(id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  return c.json({ ok: true });
});

// ── 취소 ────────────────────────────────────────────────────────────────
statements.post('/statements/:id/void', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `UPDATE statements SET status = 'void' WHERE id = ? RETURNING id`
  )
    .bind(id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

// ── 취소한 것을 되살린다 (다시 발행) ────────────────────────────────────
// 되살린 뒤에는 발행된 명세표라 칸을 고칠 수 있다. 입금 기록은 비운 채로 미수금에서 다시 시작한다.
statements.post('/statements/:id/reissue', async (c) => {
  const id = Number(c.req.param('id'));
  const stmt = await c.env.DB.prepare('SELECT id, status FROM statements WHERE id = ?').bind(id).first<{ id: number; status: string }>();
  if (!stmt) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  if (stmt.status !== 'void') return c.json({ error: '취소된 명세표가 아닙니다.' }, 400);

  const conflicts = await c.env.DB.prepare(REISSUE_CONFLICT_SQL).bind(id).all<{ work_date: string; statement_id: number }>();
  if (conflicts.results.length) {
    return c.json(
      {
        error: `취소한 뒤 다른 명세표에 담긴 작업이 ${conflicts.results.length}건 있어 다시 발행할 수 없습니다. (예: ${conflicts.results[0].work_date}) 그 명세표를 먼저 취소해 주세요.`,
      },
      409
    );
  }

  await c.env.DB.prepare(
    `UPDATE statements SET status = 'issued', paid_at = NULL, paid_amount = NULL, paid_memo = NULL WHERE id = ?`
  )
    .bind(id)
    .run();
  return c.body(null, 204);
});

// ── 지우기 ──────────────────────────────────────────────────────────────
// 발행한 명세표는 바로 지우지 못한다. 먼저 발행 취소를 하고, 취소된 것만 지운다 (줄·메일 기록은 CASCADE 로 함께 사라진다)
statements.delete('/statements/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const removed = await c.env.DB.prepare(removeVoidSql('statements')).bind(id).first<{ id: number }>();
  if (removed) return c.body(null, 204);

  const exists = await c.env.DB.prepare('SELECT id FROM statements WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: '거래명세표를 찾을 수 없습니다.' }, 404);
  return c.json({ error: '발행한 명세표는 먼저 발행 취소를 한 뒤에 지울 수 있습니다.' }, 400);
});

export default statements;
