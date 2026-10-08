import { Hono } from 'hono';
import type { Client, Company, Masters, Operator, Site, SiteRate } from '../../shared/types';
import { archiveBlock } from '../../shared/companyArchive';
import { MANUAL_CLIENT_NAME } from '../../shared/manualCustomer';
import { archiveClientSites } from '../clientArchive';
import type { AppEnv } from '../types';

/** 현장 표기 규칙: 거래처와 현장 이름이 같으면 "다솜", 다르면 "아라(광장)" */
const buildLabel = (clientName: string, siteName: string) =>
  clientName === siteName ? clientName : `${clientName}(${siteName})`;

/**
 * 요청에 실제로 담겨 온 필드만 갱신한다.
 * COALESCE 로 처리하면 값을 빈칸으로 지울 수가 없어서 이렇게 쓴다.
 */
function buildUpdate<T extends string>(allowed: readonly T[], body: Record<string, unknown>) {
  const fields = allowed.filter((f) => f in body);
  return { fields, values: fields.map((f) => body[f] ?? null) };
}

const masters = new Hono<AppEnv>();

masters.get('/masters', async (c) => {
  const db = c.env.DB;
  const [companies, clients, sites, rates, operators, descriptions, booms, amounts, owners] = await db.batch([
    // 도장 그림(수십 KB)은 목록에 싣지 않고, 있는지·언제 바꿨는지만 붙인다
    db.prepare(
      `SELECT c.*, s.updated_at AS stamp_updated_at
         FROM companies c
         LEFT JOIN company_stamps s ON s.company_id = c.id
        ORDER BY c.sort_order, c.id`
    ),
    // 「직접 입력」 명세표를 묶어 두는 숨은 거래처는 어느 목록에도 보이지 않게 뺀다
    db.prepare('SELECT * FROM clients WHERE name <> ? ORDER BY archived, name').bind(MANUAL_CLIENT_NAME),
    db.prepare('SELECT * FROM sites ORDER BY archived, label'),
    db.prepare('SELECT * FROM site_rates ORDER BY site_id, boom_size'),
    // 우리 기사님(월급을 주는 분)이 맨 위 — 장부의 기사님 목록도 이 순서로 나온다
    db.prepare('SELECT * FROM operators ORDER BY archived, is_staff DESC, name'),
    db.prepare(
      `SELECT description AS v, COUNT(*) AS n FROM work_logs
        WHERE description IS NOT NULL AND description <> ''
        GROUP BY description ORDER BY n DESC, description`
    ),
    db.prepare(`SELECT DISTINCT boom_size AS v FROM work_logs WHERE boom_size IS NOT NULL ORDER BY boom_size`),
    db.prepare(
      `SELECT base_amount AS v, COUNT(*) AS n FROM work_logs
        WHERE base_amount > 0 GROUP BY base_amount ORDER BY n DESC, base_amount`
    ),
    db.prepare(
      `SELECT business_owner AS v, COUNT(*) AS n FROM work_logs
        WHERE business_owner IS NOT NULL AND business_owner <> ''
        GROUP BY business_owner ORDER BY n DESC, business_owner`
    ),
  ]);

  const body: Masters = {
    companies: companies.results as unknown as Company[],
    clients: clients.results as unknown as Client[],
    sites: sites.results as unknown as Site[],
    operators: operators.results as unknown as Operator[],
    rates: rates.results as unknown as SiteRate[],
    suggestions: {
      descriptions: (descriptions.results as { v: string }[]).map((r) => r.v),
      boomSizes: (booms.results as { v: number }[]).map((r) => r.v),
      baseAmounts: (amounts.results as { v: number }[]).map((r) => r.v),
      businessOwners: (owners.results as { v: string }[]).map((r) => r.v),
    },
  };
  return c.json(body);
});

/** 기사님·거래처를 몇 건이나 쓰고 있는지 — 설정 화면에서 지워도 되는지 판단용 */
masters.get('/usage', async (c) => {
  const db = c.env.DB;
  const [operators, clients] = await db.batch([
    // last: 그 기사님이 마지막으로 일한 날 — 설정에서 「N건 보기」가 그 달의 작업일보로 넘어간다
    db.prepare(
      'SELECT operator_id AS id, COUNT(*) AS n, MAX(work_date) AS last FROM work_logs WHERE operator_id IS NOT NULL GROUP BY operator_id'
    ),
    db.prepare(
      `SELECT s.client_id AS id, COUNT(*) AS n FROM work_logs w JOIN sites s ON s.id = w.site_id GROUP BY s.client_id`
    ),
  ]);

  const toMap = (rows: unknown[]) =>
    Object.fromEntries((rows as { id: number; n: number }[]).map((r) => [r.id, r.n]));

  const operatorLast = Object.fromEntries(
    (operators.results as { id: number; last: string }[]).map((r) => [r.id, r.last])
  );
  return c.json({ operators: toMap(operators.results), clients: toMap(clients.results), operatorLast });
});

// ── 거래처 ──────────────────────────────────────────────────────────────
const CLIENT_FIELDS = ['name', 'full_name', 'biz_no', 'ceo_name', 'address', 'tel', 'memo', 'archived'] as const;

masters.post('/clients', async (c) => {
  const b = await c.req.json<Partial<Client>>();
  if (!b.name?.trim()) return c.json({ error: '거래처 이름을 입력해 주세요.' }, 400);

  const row = await c.env.DB.prepare(
    `INSERT INTO clients (name, full_name, biz_no, ceo_name, address, tel, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(
      b.name.trim(),
      b.full_name ?? null,
      b.biz_no ?? null,
      b.ceo_name ?? null,
      b.address ?? null,
      b.tel ?? null,
      b.memo ?? null
    )
    .first<Client>();
  return c.json(row, 201);
});

masters.patch('/clients/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const { fields, values } = buildUpdate(CLIENT_FIELDS, body);
  if (!fields.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE clients SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? RETURNING *`
  )
    .bind(...values, id)
    .first<Client>();
  if (!row) return c.json({ error: '거래처를 찾을 수 없습니다.' }, 404);

  if ('archived' in body) await archiveClientSites(c.env.DB, id, !!row.archived);

  // 거래처 이름이 바뀌면 소속 현장의 장부 표기도 함께 맞춰준다
  if (fields.includes('name' as (typeof CLIENT_FIELDS)[number])) {
    const sites = await c.env.DB.prepare('SELECT id, name FROM sites WHERE client_id = ?').bind(id).all<Site>();
    if (sites.results.length) {
      await c.env.DB.batch(
        sites.results.map((s) =>
          c.env.DB.prepare('UPDATE sites SET label = ? WHERE id = ?').bind(buildLabel(row.name, s.name), s.id)
        )
      );
    }
  }
  return c.json(row);
});

// 현장 등록·수정·상세는 routes/sites.ts 에서 다룬다 (단가표·담당자까지 함께 저장하므로)

// ── 기사님 ──────────────────────────────────────────────────────────────
const OPERATOR_FIELDS = ['name', 'memo', 'archived', 'is_staff'] as const;

masters.post('/operators', async (c) => {
  const b = await c.req.json<Partial<Operator>>();
  if (!b.name?.trim()) return c.json({ error: '이름을 입력해 주세요.' }, 400);

  const row = await c.env.DB.prepare('INSERT INTO operators (name, memo) VALUES (?, ?) RETURNING *')
    .bind(b.name.trim(), b.memo ?? null)
    .first<Operator>();
  return c.json(row, 201);
});

masters.patch('/operators/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const { fields, values } = buildUpdate(OPERATOR_FIELDS, body);
  if (!fields.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE operators SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? RETURNING *`
  )
    .bind(...values, Number(c.req.param('id')))
    .first<Operator>();
  if (!row) return c.json({ error: '기사님을 찾을 수 없습니다.' }, 404);
  return c.json(row);
});

masters.delete('/operators/:id', async (c) => {
  const id = Number(c.req.param('id'));

  // 장부에서 쓰고 있으면 지우지 않고 보관 처리하도록 안내한다
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM work_logs WHERE operator_id = ?')
    .bind(id)
    .first<{ n: number }>();
  if (used && used.n > 0) {
    return c.json({ error: `장부 ${used.n}건에 쓰이고 있어 삭제할 수 없습니다. 대신 '숨김'으로 두세요.` }, 409);
  }

  await c.env.DB.prepare('DELETE FROM operators WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

// ── 공급자(내 회사) ─────────────────────────────────────────────────────
const COMPANY_FIELDS = [
  'name',
  'biz_no',
  'ceo_name',
  'address',
  'biz_type',
  'biz_item',
  'tel',
  'fax',
  'is_default',
  'archived',
] as const;

masters.post('/companies', async (c) => {
  const b = await c.req.json<Partial<Company>>();
  const name = b.name?.trim();
  const bizNo = b.biz_no?.trim();
  if (!name || !bizNo) return c.json({ error: '상호와 등록번호를 적어 주세요.' }, 400);

  const taken = await c.env.DB.prepare('SELECT id FROM companies WHERE biz_no = ?').bind(bizNo).first();
  if (taken) return c.json({ error: '같은 등록번호의 회사가 이미 있습니다.' }, 400);

  // 새 회사는 목록 맨 뒤에
  const row = await c.env.DB.prepare(
    `INSERT INTO companies (name, biz_no, sort_order)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM companies)) RETURNING *`
  )
    .bind(name, bizNo)
    .first<Company>();
  return c.json(row, 201);
});

masters.patch('/companies/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (body.archived) {
    const all = await c.env.DB.prepare('SELECT id, is_default, archived FROM companies').all<Company>();
    const company = all.results.find((x) => x.id === Number(c.req.param('id')));
    const blocked = company && archiveBlock(company, all.results);
    if (blocked) return c.json({ error: blocked }, 400);
  }
  const { fields, values } = buildUpdate(COMPANY_FIELDS, body);
  if (!fields.length) return c.json({ error: '수정할 내용이 없습니다.' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE companies SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? RETURNING *`
  )
    .bind(...values, Number(c.req.param('id')))
    .first<Company>();
  if (!row) return c.json({ error: '회사를 찾을 수 없습니다.' }, 404);

  if (row.is_default) {
    await c.env.DB.prepare('UPDATE companies SET is_default = 0 WHERE id <> ?').bind(row.id).run();
  }
  return c.json(row);
});

// ── 도장 ────────────────────────────────────────────────────────────────
// 공개 폴더에 두면 주소만 알면 로그인 없이 받아 갈 수 있으므로 DB 에 넣고 로그인한 사람에게만 내준다.
const STAMP_MAX_BYTES = 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

masters.get('/companies/:id/stamp', async (c) => {
  const row = await c.env.DB.prepare('SELECT png FROM company_stamps WHERE company_id = ?')
    .bind(Number(c.req.param('id')))
    .first<{ png: string }>();
  if (!row) return c.json({ error: '등록된 도장이 없습니다.' }, 404);

  const bytes = Uint8Array.from(atob(row.png), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      // 로그인한 사람 것이라 private. 여러 사람이 쓰는 컴퓨터에 오래 남지 않게 하루만 둔다.
      'Cache-Control': 'private, max-age=86400',
    },
  });
});

masters.put('/companies/:id/stamp', async (c) => {
  const id = Number(c.req.param('id'));
  const body: { png?: unknown } = await c.req.json().catch(() => ({}));
  if (typeof body.png !== 'string' || !body.png) return c.json({ error: '도장 그림이 없습니다.' }, 400);

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.png), (ch) => ch.charCodeAt(0));
  } catch {
    return c.json({ error: '그림 파일을 읽을 수 없습니다.' }, 400);
  }
  if (bytes.length > STAMP_MAX_BYTES) return c.json({ error: '도장 그림은 1MB 까지 올릴 수 있습니다.' }, 413);
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return c.json({ error: 'PNG 그림만 올릴 수 있습니다. 배경이 투명한 도장 그림을 골라 주세요.' }, 400);
  }

  const company = await c.env.DB.prepare('SELECT id FROM companies WHERE id = ?').bind(id).first();
  if (!company) return c.json({ error: '회사를 찾을 수 없습니다.' }, 404);

  const row = await c.env.DB.prepare(
    `INSERT INTO company_stamps (company_id, png, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(company_id) DO UPDATE SET png = excluded.png, updated_at = excluded.updated_at
     RETURNING updated_at`
  )
    .bind(id, body.png)
    .first<{ updated_at: string }>();

  return c.json({ stamp_updated_at: row!.updated_at });
});

masters.delete('/companies/:id/stamp', async (c) => {
  await c.env.DB.prepare('DELETE FROM company_stamps WHERE company_id = ?').bind(Number(c.req.param('id'))).run();
  return c.body(null, 204);
});

export default masters;
