import { Hono } from 'hono';
import type {
  Client,
  Company,
  Site,
  SiteContact,
  SiteDetail,
  SiteInput,
  SiteRate,
  WorkLogRow,
} from '../../shared/types';
import type { AppEnv } from '../types';

/** 현장 표기 규칙: 거래처와 현장 이름이 같으면 "다솜", 다르면 "아라(광장)" */
const buildLabel = (clientName: string, siteName: string) =>
  clientName === siteName ? clientName : `${clientName}(${siteName})`;

const sites = new Hono<AppEnv>();

/** 거래처를 이름으로 찾고 없으면 만든다 (등록 화면에서 새 거래처를 바로 칠 수 있게) */
async function upsertClient(db: D1Database, name: string, fullName?: string | null): Promise<Client> {
  const existing = await db.prepare('SELECT * FROM clients WHERE name = ?').bind(name).first<Client>();
  if (existing) {
    // 보관한 거래처에 현장을 새로 달면 거래처를 되살린다 (현장만 살아 있고 거래처는 숨은 상태가 되지 않게)
    if (existing.archived) {
      await db.prepare('UPDATE clients SET archived = 0 WHERE id = ?').bind(existing.id).run();
      existing.archived = 0;
    }
    if (fullName && fullName !== existing.full_name) {
      await db.prepare('UPDATE clients SET full_name = ? WHERE id = ?').bind(fullName, existing.id).run();
      return { ...existing, full_name: fullName };
    }
    return existing;
  }
  return (await db
    .prepare('INSERT INTO clients (name, full_name) VALUES (?, ?) RETURNING *')
    .bind(name, fullName ?? null)
    .first<Client>())!;
}

/** 단가·담당자는 통째로 갈아끼운다 (화면에서 표를 통으로 편집하므로) */
async function replaceRatesAndContacts(
  db: D1Database,
  siteId: number,
  rates?: SiteRate[],
  contacts?: SiteContact[]
) {
  if (rates) {
    const statements = [db.prepare('DELETE FROM site_rates WHERE site_id = ?').bind(siteId)];
    for (const r of rates) {
      if (r.half_day_amount == null && r.full_day_amount == null) continue;
      statements.push(
        db
          .prepare(
            'INSERT INTO site_rates (site_id, boom_size, half_day_amount, full_day_amount) VALUES (?, ?, ?, ?)'
          )
          .bind(siteId, r.boom_size, r.half_day_amount ?? null, r.full_day_amount ?? null)
      );
    }
    await db.batch(statements);
  }

  if (contacts) {
    const statements = [db.prepare('DELETE FROM site_contacts WHERE site_id = ?').bind(siteId)];
    contacts
      .filter((c) => c.name?.trim())
      .forEach((c, i) => {
        statements.push(
          db
            .prepare('INSERT INTO site_contacts (site_id, name, phone, email, sort_order) VALUES (?, ?, ?, ?, ?)')
            .bind(siteId, c.name.trim(), c.phone ?? null, c.email ?? null, i)
        );
      });
    await db.batch(statements);
  }
}

// ── 등록 ────────────────────────────────────────────────────────────────
sites.post('/sites', async (c) => {
  const body = await c.req.json<SiteInput>();
  if (!body.client_name?.trim() || !body.name?.trim()) {
    return c.json({ error: '건설회사와 현장 이름은 필수입니다.' }, 400);
  }

  const db = c.env.DB;
  const client = await upsertClient(db, body.client_name.trim(), body.client_full_name);
  const label = body.label?.trim() || buildLabel(client.name, body.name.trim());

  const duplicate = await db.prepare('SELECT id FROM sites WHERE label = ?').bind(label).first<{ id: number }>();
  if (duplicate) return c.json({ error: `'${label}' 현장이 이미 등록되어 있습니다.` }, 409);

  const site = await db
    .prepare(
      `INSERT INTO sites (client_id, name, label, prime_contractor, address, company_id,
                          closing_day, issue_day, registered_at, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?) RETURNING *`
    )
    .bind(
      client.id,
      body.name.trim(),
      label,
      body.prime_contractor ?? null,
      body.address ?? null,
      body.company_id ?? null,
      body.closing_day ?? null,
      body.issue_day ?? null,
      body.memo ?? null
    )
    .first<Site>();

  await replaceRatesAndContacts(db, site!.id, body.rates, body.contacts);
  return c.json(site, 201);
});

// ── 수정 ────────────────────────────────────────────────────────────────
sites.put('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<SiteInput>();
  const db = c.env.DB;

  const current = await db.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first<Site>();
  if (!current) return c.json({ error: '현장을 찾을 수 없습니다.' }, 404);

  const client = body.client_name?.trim()
    ? await upsertClient(db, body.client_name.trim(), body.client_full_name)
    : await db.prepare('SELECT * FROM clients WHERE id = ?').bind(current.client_id).first<Client>();

  const name = body.name?.trim() || current.name;
  const label = body.label?.trim() || buildLabel(client!.name, name);

  const site = await db
    .prepare(
      `UPDATE sites SET client_id = ?, name = ?, label = ?, prime_contractor = ?, address = ?,
                        company_id = ?, closing_day = ?, issue_day = ?, memo = ?
        WHERE id = ? RETURNING *`
    )
    .bind(
      client!.id,
      name,
      label,
      body.prime_contractor ?? null,
      body.address ?? null,
      body.company_id ?? null,
      body.closing_day ?? null,
      body.issue_day ?? null,
      body.memo ?? null,
      id
    )
    .first<Site>();

  await replaceRatesAndContacts(db, id, body.rates, body.contacts);
  return c.json(site);
});

/** 목록 화면용 — 현장마다 작업 건수·단가 수·담당자 수를 함께 준다 */
sites.get('/sites', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*,
            cl.name      AS client_name,
            cl.full_name AS client_full_name,
            co.name      AS company_name,
            (SELECT COUNT(*) FROM work_logs w     WHERE w.site_id = s.id) AS work_count,
            (SELECT COUNT(*) FROM site_rates r    WHERE r.site_id = s.id) AS rate_count,
            (SELECT COUNT(*) FROM site_contacts t WHERE t.site_id = s.id) AS contact_count
       FROM sites s
       JOIN clients cl ON cl.id = s.client_id
       LEFT JOIN companies co ON co.id = s.company_id
      ORDER BY s.archived, cl.name, s.name`
  ).all();
  return c.json(rows.results);
});

/** 보관 / 되살리기 — 끝난 현장을 고르는 목록에서 빼되 기록은 남긴다 */
sites.patch('/sites/:id/archive', async (c) => {
  const { archived } = await c.req.json<{ archived?: number | boolean }>();
  const row = await c.env.DB.prepare('UPDATE sites SET archived = ? WHERE id = ? RETURNING *')
    .bind(archived ? 1 : 0, Number(c.req.param('id')))
    .first<Site>();
  if (!row) return c.json({ error: '현장을 찾을 수 없습니다.' }, 404);
  return c.json(row);
});

sites.delete('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'));

  // 장부에 쓰이고 있으면 지우지 않는다 (기록의 근거가 사라진다)
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM work_logs WHERE site_id = ?')
    .bind(id)
    .first<{ n: number }>();
  if (used && used.n > 0) {
    return c.json({ error: `장부 ${used.n}건에 쓰이고 있어 삭제할 수 없습니다. 대신 '보관'으로 두세요.` }, 409);
  }

  // 단가·담당자는 CASCADE 로 함께 사라진다
  await c.env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

// ── 현장 상세 (엑셀의 현장별 시트) ──────────────────────────────────────
sites.get('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;

  const site = await db.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first<Site>();
  if (!site) return c.json({ error: '현장을 찾을 수 없습니다.' }, 404);

  const [client, company, rates, contacts, logs] = await Promise.all([
    db.prepare('SELECT * FROM clients WHERE id = ?').bind(site.client_id).first<Client>(),
    site.company_id
      ? db.prepare('SELECT * FROM companies WHERE id = ?').bind(site.company_id).first<Company>()
      : Promise.resolve(null),
    db.prepare('SELECT * FROM site_rates WHERE site_id = ? ORDER BY boom_size').bind(id).all<SiteRate>(),
    db
      .prepare('SELECT * FROM site_contacts WHERE site_id = ? ORDER BY sort_order, id')
      .bind(id)
      .all<SiteContact>(),
    db
      .prepare(
        `SELECT w.*, s.label AS site_label, s.client_id, cl.name AS client_name, op.name AS operator_name,
                (SELECT sl.statement_id FROM statement_lines sl
                   JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                  WHERE sl.work_log_id = w.id LIMIT 1) AS statement_id
           FROM work_logs w
           JOIN sites   s  ON s.id  = w.site_id
           JOIN clients cl ON cl.id = s.client_id
           LEFT JOIN operators op ON op.id = w.operator_id
          WHERE w.site_id = ?
          ORDER BY w.work_date, w.sort_order, w.id`
      )
      .bind(id)
      .all<WorkLogRow>(),
  ]);

  // 엑셀 현장 시트처럼 달마다 묶고, 달 끝에 명세표 합계를 붙인다
  const months: SiteDetail['months'] = [];
  for (const row of logs.results) {
    const month = row.work_date.slice(0, 7);
    let bucket = months.at(-1);
    if (!bucket || bucket.month !== month) {
      bucket = { month, rows: [], supplyAmount: 0, vatAmount: 0, totalAmount: 0 };
      months.push(bucket);
    }
    bucket.rows.push(row);
    bucket.supplyAmount += row.supply_amount;
  }
  for (const m of months) {
    m.vatAmount = Math.round(m.supplyAmount * 0.1);
    m.totalAmount = m.supplyAmount + m.vatAmount;
  }

  const body: SiteDetail = {
    site,
    client: client!,
    company: company ?? null,
    rates: rates.results,
    contacts: contacts.results,
    months,
  };
  return c.json(body);
});

export default sites;
