import type { MailAccount } from '../shared/types';
import { mailConfig, senderAddress, type MailConfig } from './mail';
import { unlock, vaultSecret } from './mailVault';

/**
 * 메일 보내는 계정.
 *
 * 화면(설정 > 계정)에서 등록한 계정은 mail_accounts 표에 있고, 비밀번호는 잠겨 있다 (mailVault.ts).
 * 예전 방식대로 서버 비밀값(NAVER_SMTP_USER·NAVER_SMTP_PASSWORD)으로 넣은 계정이 있으면 번호 0 으로 같이 보인다 —
 * 그 계정은 화면에서 고치거나 지울 수 없다.
 */

export const ENV_ACCOUNT_ID = 0;

/** 아이디만 적었으면 @naver.com 을 붙인다 */
export const accountAddress = (username: string) => (username.includes('@') ? username : `${username}@naver.com`);

const USERNAME = /^[a-z0-9][a-z0-9._-]*(@[a-z0-9-]+(\.[a-z0-9-]+)+)?$/;

export type AccountInput = { username: string; password: string | null; label: string | null };

/**
 * 화면에서 적은 값을 확인한다.
 * 새로 등록할 때는 비밀번호가 꼭 있어야 하고, 고칠 때 비우면 원래 것을 그대로 둔다(null).
 */
export function parseAccountInput(
  body: { username?: unknown; password?: unknown; label?: unknown },
  passwordRequired: boolean
): { ok: true; value: AccountInput } | { ok: false; error: string } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // 네이버 주소 전체를 적어도 아이디만 남긴다 — 같은 계정이 두 번 등록되지 않게
  const username = text(body.username).toLowerCase().replace(/@naver\.com$/, '');
  const password = text(body.password);
  const label = text(body.label).slice(0, 40);

  if (!username) return { ok: false, error: '네이버 아이디를 적어 주세요.' };
  if (username.length > 80 || !USERNAME.test(username)) {
    return { ok: false, error: '네이버 아이디는 영문·숫자로 적어 주세요. (예: hangang01 또는 hangang01@naver.com)' };
  }
  if (!password && passwordRequired) return { ok: false, error: '애플리케이션 비밀번호를 적어 주세요.' };
  if (password.length > 100) return { ok: false, error: '비밀번호가 너무 깁니다.' };

  return { ok: true, value: { username, password: password || null, label: label || null } };
}

/** 메일 서버 주소는 계정마다 같다 (로컬 시험은 .dev.vars 의 SMTP_HOST 로 가짜 서버에 붙는다) */
export function serverFor(env: Env, user: string, pass: string): MailConfig {
  const e = env as unknown as Record<string, string | undefined>;
  return {
    host: e.SMTP_HOST || 'smtp.naver.com',
    port: Number(e.SMTP_PORT || 465),
    secure: (e.SMTP_SECURE || 'on') !== 'off',
    user,
    pass,
  };
}

/** 고를 수 있는 계정 목록 (비밀번호는 내보내지 않는다) */
export async function listAccounts(env: Env): Promise<MailAccount[]> {
  const { results } = await env.DB.prepare('SELECT id, label, username FROM mail_accounts ORDER BY id').all<{
    id: number;
    label: string | null;
    username: string;
  }>();
  const out: MailAccount[] = results.map((r) => ({ ...r, address: accountAddress(r.username), fixed: false }));

  const fromEnv = mailConfig(env);
  if (fromEnv && !out.some((a) => a.address === senderAddress(fromEnv))) {
    out.push({ id: ENV_ACCOUNT_ID, label: null, username: fromEnv.user, address: senderAddress(fromEnv), fixed: true });
  }
  return out;
}

/** 고른 계정으로 메일 서버에 붙을 설정. 없는 계정이면 null */
export async function configFor(env: Env, accountId: number): Promise<MailConfig | null> {
  if (accountId === ENV_ACCOUNT_ID) return mailConfig(env);

  const row = await env.DB.prepare('SELECT username, password_enc FROM mail_accounts WHERE id = ?')
    .bind(accountId)
    .first<{ username: string; password_enc: string }>();
  if (!row) return null;

  const secret = vaultSecret(env);
  if (!secret) return null;
  return serverFor(env, row.username, await unlock(secret, row.password_enc));
}

// ── 문서 지우기·받는 주소 (SQL 은 tests/mail-accounts.test.ts 가 실제 SQLite 로 확인한다) ──

/** 발행한 문서는 바로 지우지 못한다 — 취소한 것만 지운다. 지워졌으면 그 번호가 돌아온다 */
export const removeVoidSql = (table: 'statements' | 'quotes') =>
  `DELETE FROM ${table} WHERE id = ? AND status = 'void' RETURNING id`;

/** 이 거래처에 명세표·견적서로 보냈던 주소 (최근 것부터) */
export const PREVIOUS_RECIPIENTS_SQL = `
  SELECT to_addrs FROM (
    SELECT e.to_addrs, e.sent_at FROM statement_emails e JOIN statements s ON s.id = e.statement_id
     WHERE s.client_id = ?1 AND e.status = 'sent'
    UNION ALL
    SELECT e.to_addrs, e.sent_at FROM quote_emails e JOIN quotes q ON q.id = e.quote_id
     WHERE q.client_id = ?1 AND e.status = 'sent'
  ) ORDER BY sent_at DESC LIMIT 5`;

/** 받는 사람 추천에 붙는 설명. 거래처 전체 문서는 현장이 여럿이라 현장 이름을 같이 보인다 */
export const contactLabel = (name: string, site: string, wholeClient: boolean) =>
  wholeClient ? `${site} 담당자 ${name}` : `담당자 ${name}`;
