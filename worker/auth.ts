import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { User } from '../shared/types';
import type { AppEnv } from './types';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;
// Cloudflare Workers 는 PBKDF2 반복 횟수를 10만 회까지만 허용한다.
// (로컬 개발 서버는 이 제한이 없어 더 큰 값도 통과하므로 주의)
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** `pbkdf2$<iterations>$<salt>$<hash>` 형식으로 직렬화 (scripts/add-user.mjs 와 동일 포맷) */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;

  const actual = await derive(password, fromBase64(salt), Number(iterations));
  const expected = fromBase64(hash);
  if (actual.length !== expected.length) return false;

  // 타이밍 공격 방지를 위해 항상 전체를 비교한다
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const cookieOptions = (c: Context<AppEnv>) =>
  ({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    // 로컬 개발(http://localhost)에서도 쿠키가 붙도록 https 일 때만 Secure 를 켠다
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_DAYS * 86_400,
  }) as const;

export async function createSession(c: Context<AppEnv>, userId: number): Promise<void> {
  // 쿠키에 그대로 들어가므로 base64url 로 만든다 (+ / = 가 섞이면 인코딩 왕복이 지저분해진다)
  const id = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 만료시각은 SQLite 안에서 계산한다. JS 의 toISOString() 은 datetime('now') 와
  // 형식이 달라(`T`/`Z`/밀리초) 문자열 비교가 어긋난다.
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`
  )
    .bind(id, userId, `+${SESSION_DAYS} days`)
    .run();

  setCookie(c, SESSION_COOKIE, id, cookieOptions(c));
}

/**
 * 쓰고 있는 동안에는 로그인이 끊기지 않게 한다.
 * 남은 기간이 7일 아래로 내려가면 다시 30일로 늘리고 쿠키도 새로 준다. (접속 표시가 20초마다 부른다)
 */
export async function refreshSession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return;
  const { meta } = await c.env.DB.prepare(
    `UPDATE sessions SET expires_at = datetime('now', ?)
      WHERE id = ? AND expires_at < datetime('now', '+7 days')`
  )
    .bind(`+${SESSION_DAYS} days`, id)
    .run();
  if (meta.changes) setCookie(c, SESSION_COOKIE, id, cookieOptions(c));
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now')`
  )
    .bind(id)
    .first<User>();

  return row ?? null;
}

/** 로그인하지 않았으면 401. 통과하면 c.get('user') 로 사용자 정보를 꺼낼 수 있다. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401);
  c.set('user', user);
  await next();
};
