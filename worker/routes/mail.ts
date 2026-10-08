import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { EMAIL_LOGS, insertEmailLog, isEmail, senderAddress, SmtpError, type DocKind, type MailConfig } from '../mail';
import { checkLogin, sendMail } from '../mailSocket';
import { lock, vaultSecret, VaultError } from '../mailVault';
import { configFor, contactLabel, ENV_ACCOUNT_ID, listAccounts, parseAccountInput, PREVIOUS_RECIPIENTS_SQL, serverFor } from '../mailAccounts';
import { sqlToIso } from './presence';

/**
 * 거래명세표·견적서를 네이버 메일로 보낸다.
 * PDF 는 화면(브라우저)이 A4 양식 그대로 만들어 보낸다 — 워커에는 글꼴·그림 그리는 도구가 없다.
 * 보내는 계정은 설정 > 계정에서 여러 개 등록하고, 보낼 때 고른다.
 */
const mail = new Hono<AppEnv>();

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_RECIPIENTS = 10;

// ── 보내는 계정 ─────────────────────────────────────────────────────────

/** canAdd 가 false 면 비밀번호를 잠글 서버 열쇠가 없어 등록할 수 없다 */
mail.get('/mail/accounts', async (c) =>
  c.json({ accounts: await listAccounts(c.env), canAdd: vaultSecret(c.env) != null })
);

/** 로그인이 되는지 메일 서버에 물어본다. 되면 null, 안 되면 화면에 보일 말 */
async function loginError(cfg: MailConfig): Promise<string | null> {
  try {
    await checkLogin(cfg);
    return null;
  } catch (e) {
    if (e instanceof SmtpError) return e.message;
    console.error('메일 계정 확인 실패', e instanceof Error ? e.message : e);
    return '메일 서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.';
  }
}

const NO_KEY = '메일 계정을 저장할 서버 열쇠가 없습니다. 김재현의 친구 고민준에게 연락 주세요.';
const isDuplicate = (e: unknown) => e instanceof Error && /UNIQUE/i.test(e.message);

mail.post('/mail/accounts', async (c) => {
  const parsed = parseAccountInput(await c.req.json().catch(() => ({})), true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { username, password, label } = parsed.value;

  const secret = vaultSecret(c.env);
  if (!secret) return c.json({ error: NO_KEY }, 503);

  // 틀린 비밀번호를 저장해 두면 보낼 때에야 알게 된다 — 등록할 때 바로 로그인해 본다
  const failed = await loginError(serverFor(c.env, username, password!));
  if (failed) return c.json({ error: failed }, 400);

  try {
    const row = await c.env.DB.prepare('INSERT INTO mail_accounts (label, username, password_enc) VALUES (?, ?, ?) RETURNING id')
      .bind(label, username, await lock(secret, password!))
      .first<{ id: number }>();
    return c.json({ id: row!.id }, 201);
  } catch (e) {
    if (isDuplicate(e)) return c.json({ error: '이미 등록된 계정입니다.' }, 409);
    throw e;
  }
});

mail.patch('/mail/accounts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT username FROM mail_accounts WHERE id = ?').bind(id).first<{ username: string }>();
  if (!existing) return c.json({ error: '메일 계정을 찾을 수 없습니다.' }, 404);

  const parsed = parseAccountInput(await c.req.json().catch(() => ({})), false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { username, password, label } = parsed.value;

  if (username !== existing.username && !password) {
    return c.json({ error: '아이디를 바꾸면 그 계정의 애플리케이션 비밀번호도 같이 적어 주세요.' }, 400);
  }

  try {
    if (password) {
      const secret = vaultSecret(c.env);
      if (!secret) return c.json({ error: NO_KEY }, 503);
      const failed = await loginError(serverFor(c.env, username, password));
      if (failed) return c.json({ error: failed }, 400);
      await c.env.DB.prepare('UPDATE mail_accounts SET label = ?, username = ?, password_enc = ? WHERE id = ?')
        .bind(label, username, await lock(secret, password), id)
        .run();
    } else {
      await c.env.DB.prepare('UPDATE mail_accounts SET label = ? WHERE id = ?').bind(label, id).run();
    }
  } catch (e) {
    if (isDuplicate(e)) return c.json({ error: '이미 등록된 계정입니다.' }, 409);
    throw e;
  }
  return c.body(null, 204);
});

mail.delete('/mail/accounts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM mail_accounts WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.body(null, 204);
});

// ── 문서 보내기 (거래명세표·견적서가 같은 길을 쓴다) ────────────────────

interface DocRow {
  client_id: number;
  site_id: number | null;
  status: string;
  customer_name: string;
  supplier_name: string;
}

const findDoc = (c: Context<AppEnv>, kind: DocKind, id: number) =>
  c.env.DB.prepare(`SELECT client_id, site_id, status, customer_name, supplier_name FROM ${kind} WHERE id = ?`).bind(id).first<DocRow>();

for (const kind of ['statements', 'quotes'] as const) {
  const doc = EMAIL_LOGS[kind];
  const missing = `${doc.name}를 찾을 수 없습니다.`;

  /**
   * 받는 주소 후보: 이 거래처에 전에 보냈던 주소 → 현장 담당자 이메일 순.
   * 현장을 고른 문서면 그 현장 담당자, 거래처 전체면 그 거래처 모든 현장 담당자.
   */
  mail.get(`/${kind}/:id/recipients`, async (c) => {
    const row = await findDoc(c, kind, Number(c.req.param('id')));
    if (!row) return c.json({ error: missing }, 404);

    const [previous, contacts] = await c.env.DB.batch([
      c.env.DB.prepare(PREVIOUS_RECIPIENTS_SQL).bind(row.client_id),
      c.env.DB.prepare(
        `SELECT sc.name, sc.email, s.name AS site FROM site_contacts sc JOIN sites s ON s.id = sc.site_id
          WHERE sc.email IS NOT NULL AND sc.email <> ''
            AND (s.id = ? OR (? IS NULL AND s.client_id = ?))
          ORDER BY s.id = ? DESC, sc.sort_order`
      ).bind(row.site_id, row.site_id, row.client_id, row.site_id),
    ]);

    const seen = new Set<string>();
    const out: { email: string; label: string }[] = [];
    for (const r of previous.results as { to_addrs: string }[]) {
      for (const email of r.to_addrs.split(',').map((s) => s.trim())) {
        if (email && !seen.has(email)) seen.add(email), out.push({ email, label: '전에 보낸 주소' });
      }
    }
    for (const r of contacts.results as { name: string; email: string; site: string }[]) {
      if (!seen.has(r.email)) seen.add(r.email), out.push({ email: r.email, label: contactLabel(r.name, r.site, row.site_id == null) });
    }
    return c.json(out);
  });

  /** 보낸 기록 (최근 것부터) */
  mail.get(`/${kind}/:id/emails`, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT to_addrs, subject, status, error, from_addr, sent_at FROM ${doc.emails} WHERE ${doc.fk} = ? ORDER BY sent_at DESC, id DESC`
    )
      .bind(Number(c.req.param('id')))
      .all<{ to_addrs: string; subject: string | null; status: string; error: string | null; from_addr: string | null; sent_at: string }>();
    return c.json(results.map((r) => ({ ...r, sent_at: sqlToIso(r.sent_at) })));
  });

  /** 네이버 메일 창·기본 메일 앱으로 보냈을 때 남기는 기록 (실제로 갔는지는 알 수 없다) */
  mail.post(`/${kind}/:id/email-log`, async (c) => {
    const id = Number(c.req.param('id'));
    const body: { to?: unknown; subject?: unknown } = await c.req.json().catch(() => ({}));
    const to = (Array.isArray(body.to) ? body.to : []).map((s) => String(s).trim()).filter(Boolean);
    await insertEmailLog(c.env.DB, id, to, typeof body.subject === 'string' ? body.subject : undefined, kind);
    return c.json({ ok: true });
  });

  /** 고른 계정으로 서버가 바로 보낸다 (PDF 첨부) */
  mail.post(`/${kind}/:id/email`, async (c) => {
    const id = Number(c.req.param('id'));
    const body: { account_id?: unknown; to?: unknown; subject?: unknown; text?: unknown; pdf?: unknown; filename?: unknown } = await c.req
      .json()
      .catch(() => ({}));

    const accountId = typeof body.account_id === 'number' ? body.account_id : ENV_ACCOUNT_ID;
    let cfg: MailConfig | null;
    try {
      cfg = await configFor(c.env, accountId);
    } catch (e) {
      if (e instanceof VaultError) return c.json({ error: e.message }, 409);
      throw e;
    }
    if (!cfg) return c.json({ error: '보내는 메일 계정을 찾을 수 없습니다. 설정 > 계정에서 확인해 주세요.' }, 400);

    const to = (Array.isArray(body.to) ? body.to : [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    if (!to.length) return c.json({ error: '받는 사람 메일 주소를 적어 주세요.' }, 400);
    if (to.length > MAX_RECIPIENTS) return c.json({ error: `받는 사람은 ${MAX_RECIPIENTS}명까지입니다.` }, 400);
    const bad = to.find((t) => !isEmail(t));
    if (bad) return c.json({ error: `메일 주소가 올바르지 않습니다: ${bad}` }, 400);

    const row = await findDoc(c, kind, id);
    if (!row) return c.json({ error: missing }, 404);
    if (row.status === 'void') return c.json({ error: `취소된 ${doc.name}는 보낼 수 없습니다.` }, 400);

    let pdf: Uint8Array;
    try {
      pdf = Uint8Array.from(atob(typeof body.pdf === 'string' ? body.pdf : ''), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ error: 'PDF 를 읽을 수 없습니다. 다시 해 주세요.' }, 400);
    }
    if (pdf.length < 100 || String.fromCharCode(...pdf.slice(0, 5)) !== '%PDF-') {
      return c.json({ error: 'PDF 가 만들어지지 않았습니다. 다시 해 주세요.' }, 400);
    }
    if (pdf.length > MAX_PDF_BYTES) return c.json({ error: 'PDF 가 너무 큽니다 (5MB 까지).' }, 413);

    const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
    const subject = clean(body.subject, 150) || `${row.customer_name} ${doc.name} — ${row.supplier_name}`;
    // 내용을 비워 보내면 빈 채로 간다 — 「첨부해 보내 드립니다」 같은 글을 대신 넣지 않는다 (사용자 요청 2026-10-04)
    const text = typeof body.text === 'string' ? body.text.slice(0, 5000) : '';
    const filename = (clean(body.filename, 120) || doc.name).replace(/[\\/:*?"<>|]/g, '').replace(/\.pdf$/i, '') + '.pdf';
    const from = senderAddress(cfg);

    const log = (status: 'sent' | 'failed', error: string | null) =>
      c.env.DB.prepare(
        `INSERT INTO ${doc.emails} (${doc.fk}, to_addrs, subject, status, error, from_addr, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, to.join(', '), subject, status, error, from, c.get('user').id)
        .run();

    try {
      await sendMail(cfg, {
        fromName: row.supplier_name,
        fromAddress: from,
        to,
        subject,
        text,
        attachment: { filename, contentType: 'application/pdf', bytes: pdf },
      });
    } catch (e) {
      const message = e instanceof SmtpError ? e.message : '메일 서버에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.';
      console.error('메일 보내기 실패', e instanceof Error ? e.message : e);
      await log('failed', message);
      return c.json({ error: message }, 502);
    }

    await log('sent', null);
    return c.json({ ok: true, to, from });
  });
}

export default mail;
