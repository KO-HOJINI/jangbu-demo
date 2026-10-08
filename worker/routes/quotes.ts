import { Hono } from 'hono';
import type {
  Client,
  Company,
  Quote,
  QuoteCreateInput,
  QuoteDetail,
  QuoteLine,
  QuoteListItem,
  Site,
  SiteRate,
} from '../../shared/types';
import type { AppEnv } from '../types';
import { removeVoidSql } from '../mailAccounts';
import { lineEditBlock } from '../unpaid';

const DEFAULT_ITEM_NAME = '펌프카 장비';

/** 견적 줄을 안 넘겨주면 현장 단가표에서 만들어 준다 (반나절 → 하루 순서, 규격 오름차순) */
function linesFromRates(rates: SiteRate[]) {
  return rates
    .slice()
    .sort((a, b) => a.boom_size - b.boom_size)
    .flatMap((rate) =>
      (
        [
          ['반나절', rate.half_day_amount],
          ['하루', rate.full_day_amount],
        ] as const
      )
        .filter(([, amount]) => amount != null)
        .map(([basis, amount]) => ({
          item_name: DEFAULT_ITEM_NAME,
          spec: `${rate.boom_size}M`,
          basis,
          supply_amount: amount as number,
        }))
    );
}

const quotes = new Hono<AppEnv>();

// ── 목록 ────────────────────────────────────────────────────────────────
quotes.get('/quotes', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT q.*, cl.name AS client_name, s.label AS site_label, COUNT(ql.id) AS line_count
       FROM quotes q
       JOIN clients cl ON cl.id = q.client_id
       LEFT JOIN sites s ON s.id = q.site_id
       LEFT JOIN quote_lines ql ON ql.quote_id = q.id
      GROUP BY q.id
      ORDER BY q.issue_date DESC, q.id DESC`
  ).all<QuoteListItem>();
  return c.json(rows.results);
});

// ── 미리보기: 현장 단가표를 견적 줄로 ───────────────────────────────────
quotes.get('/quotes/preview', async (c) => {
  const siteId = c.req.query('siteId');
  if (!siteId) return c.json({ lines: [] });

  const rates = await c.env.DB.prepare('SELECT * FROM site_rates WHERE site_id = ? ORDER BY boom_size')
    .bind(Number(siteId))
    .all<SiteRate>();
  return c.json({ lines: linesFromRates(rates.results) });
});

// ── 상세 ────────────────────────────────────────────────────────────────
quotes.get('/quotes/:id', async (c) => {
  const id = Number(c.req.param('id'));

  const quote = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Quote>();
  if (!quote) return c.json({ error: '견적서를 찾을 수 없습니다.' }, 404);

  const lines = await c.env.DB.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY line_no')
    .bind(id)
    .all<QuoteLine>();

  return c.json({ quote, lines: lines.results } satisfies QuoteDetail);
});

// ── 발행 ────────────────────────────────────────────────────────────────
quotes.post('/quotes', async (c) => {
  const input = await c.req.json<QuoteCreateInput>();
  if (!input.company_id || !input.client_id || !input.issue_date) {
    return c.json({ error: '공급자·거래처·발행일은 필수입니다.' }, 400);
  }

  const db = c.env.DB;
  const company = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(input.company_id).first<Company>();
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(input.client_id).first<Client>();
  if (!company || !client) return c.json({ error: '공급자 또는 거래처를 찾을 수 없습니다.' }, 400);

  const site = input.site_id
    ? await db.prepare('SELECT * FROM sites WHERE id = ?').bind(input.site_id).first<Site>()
    : null;
  if (input.site_id && !site) return c.json({ error: '현장을 찾을 수 없습니다.' }, 400);

  // 줄을 안 넘겼으면 현장 단가표에서 만들어 넣는다
  let lines = input.lines ?? [];
  if (!lines.length && site) {
    const rates = await db
      .prepare('SELECT * FROM site_rates WHERE site_id = ? ORDER BY boom_size')
      .bind(site.id)
      .all<SiteRate>();
    lines = linesFromRates(rates.results);
  }
  if (!lines.length) {
    return c.json({ error: '견적에 담을 줄이 없습니다. 현장 단가표를 먼저 등록해 주세요.' }, 400);
  }

  // 머리와 줄을 한 묶음(트랜잭션)으로 넣는다 — 줄 넣기가 실패하면 통째로 취소되어 빈 견적서가 남지 않는다 (명세표와 같은 방법)
  const header = db
    .prepare(
      `INSERT INTO quotes (
         company_id, client_id, site_id, issue_date,
         supplier_name, supplier_biz_no, supplier_ceo, supplier_address,
         supplier_biz_type, supplier_biz_item, supplier_tel, supplier_fax,
         customer_name, customer_site_name, customer_site_address, note, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
    .bind(
      input.company_id,
      input.client_id,
      input.site_id ?? null,
      input.issue_date,
      company.name,
      company.biz_no,
      company.ceo_name,
      company.address,
      company.biz_type,
      company.biz_item,
      company.tel,
      company.fax,
      client.full_name ?? client.name,
      site?.name ?? null,
      site?.address ?? null,
      input.note ?? null,
      c.get('user').id
    );

  // 줄은 머리의 번호를 알아야 한다. 같은 묶음 안이라 방금 매겨진 번호(sqlite_sequence)를 쓴다
  const [created] = await db.batch([
    header,
    ...lines.map((line, i) =>
      db
        .prepare(
          `INSERT INTO quote_lines (quote_id, line_no, item_name, spec, basis, supply_amount, vat_amount)
           VALUES ((SELECT seq FROM sqlite_sequence WHERE name = 'quotes'), ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          i + 1,
          line.item_name ?? DEFAULT_ITEM_NAME,
          line.spec ?? null,
          line.basis ?? null,
          line.supply_amount ?? 0,
          Math.round((line.supply_amount ?? 0) * 0.1)
        )
    ),
  ]);
  const quoteId = (created.results[0] as { id: number }).id;

  return c.json({ id: quoteId }, 201);
});

// ── 발행 후 직접 수정 ───────────────────────────────────────────────────
const HEADER_FIELDS = [
  'issue_date',
  'note',
  'customer_name',
  'customer_site_name',
  'customer_site_address',
  'supplier_name',
  'supplier_biz_no',
  'supplier_ceo',
  'supplier_address',
  'supplier_biz_type',
  'supplier_biz_item',
  'supplier_tel',
  'supplier_fax',
] as const;

quotes.patch('/quotes/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const fields = HEADER_FIELDS.filter((f) => f in body);
  if (!fields.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE quotes SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? RETURNING id`
  )
    .bind(...fields.map((f) => body[f] ?? null), Number(c.req.param('id')))
    .first<{ id: number }>();
  if (!row) return c.json({ error: '견적서를 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

const LINE_FIELDS = ['item_name', 'spec', 'basis', 'supply_amount'] as const;

quotes.patch('/quotes/:id/lines/:lineId', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const fields = LINE_FIELDS.filter((f) => f in body);
  if (!fields.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);
  const blocked = await lineEditBlock(c.env.DB, 'quotes', Number(c.req.param('id')));
  if (blocked) return c.json({ error: blocked.error }, blocked.status);

  const sets = fields.map((f) => `${f} = ?`);
  const values: unknown[] = fields.map((f) => body[f] ?? null);
  if ('supply_amount' in body) {
    sets.push('vat_amount = ?');
    values.push(Math.round(Number(body.supply_amount ?? 0) * 0.1));
  }

  const row = await c.env.DB.prepare(
    `UPDATE quote_lines SET ${sets.join(', ')} WHERE id = ? AND quote_id = ? RETURNING id`
  )
    .bind(...values, Number(c.req.param('lineId')), Number(c.req.param('id')))
    .first<{ id: number }>();
  if (!row) return c.json({ error: '해당 줄을 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

quotes.post('/quotes/:id/lines', async (c) => {
  const quoteId = Number(c.req.param('id'));
  const blocked = await lineEditBlock(c.env.DB, 'quotes', quoteId);
  if (blocked) return c.json({ error: blocked.error }, blocked.status);
  const next = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM quote_lines WHERE quote_id = ?'
  )
    .bind(quoteId)
    .first<{ n: number }>();

  await c.env.DB.prepare(
    `INSERT INTO quote_lines (quote_id, line_no, item_name, supply_amount, vat_amount) VALUES (?, ?, ?, 0, 0)`
  )
    .bind(quoteId, next!.n, DEFAULT_ITEM_NAME)
    .run();
  return c.body(null, 204);
});

quotes.delete('/quotes/:id/lines/:lineId', async (c) => {
  const blocked = await lineEditBlock(c.env.DB, 'quotes', Number(c.req.param('id')));
  if (blocked) return c.json({ error: blocked.error }, blocked.status);
  await c.env.DB.prepare('DELETE FROM quote_lines WHERE id = ? AND quote_id = ?')
    .bind(Number(c.req.param('lineId')), Number(c.req.param('id')))
    .run();
  return c.body(null, 204);
});

/** 발행한 견적서는 바로 지우지 못한다. 먼저 발행 취소를 하고, 취소된 것만 지운다 (줄·메일 기록은 CASCADE 로 함께 사라진다) */
quotes.delete('/quotes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const removed = await c.env.DB.prepare(removeVoidSql('quotes')).bind(id).first<{ id: number }>();
  if (removed) return c.body(null, 204);

  const exists = await c.env.DB.prepare('SELECT id FROM quotes WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: '견적서를 찾을 수 없습니다.' }, 404);
  return c.json({ error: '발행한 견적서는 먼저 발행 취소를 한 뒤에 지울 수 있습니다.' }, 400);
});

quotes.post('/quotes/:id/void', async (c) => {
  const row = await c.env.DB.prepare(`UPDATE quotes SET status = 'void' WHERE id = ? RETURNING id`)
    .bind(Number(c.req.param('id')))
    .first<{ id: number }>();
  if (!row) return c.json({ error: '견적서를 찾을 수 없습니다.' }, 404);
  return c.body(null, 204);
});

export default quotes;
