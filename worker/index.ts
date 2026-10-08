import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { User } from '../shared/types';
import { createSession, currentUser, destroySession, hashPassword, requireAuth, verifyPassword } from './auth';
import { countsAsChange, markChanged } from './changed';
import { listBackups, readBackup, restoreBackup, runBackup } from './backup';
import alerts, { runOverdueAlerts } from './routes/alerts';
import drafts from './routes/drafts';
import mail from './routes/mail';
import photoLogs from './routes/photoLogs';
import masters from './routes/masters';
import operatorPay from './routes/operatorPay';
import presence from './routes/presence';
import quotes from './routes/quotes';
import sites from './routes/sites';
import statements from './routes/statements';
import summary from './routes/summary';
import workLogs from './routes/workLogs';
import dashboard from './routes/dashboard';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// 모든 API 응답에 보안 헤더. (화면 파일에는 public/_headers 가 붙인다)
// API 는 JSON·그림만 내보내므로 무엇도 실행하거나 끼워 넣지 못하게 가장 좁게 둔다.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    xFrameOptions: 'DENY',
    referrerPolicy: 'same-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    crossOriginResourcePolicy: 'same-origin',
  })
);

// ── 인증 ────────────────────────────────────────────────────────────────
/** 같은 곳(IP)에서 이 시간 안에 이만큼 틀리면 잠시 막는다 */
const LOGIN_LOCK_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;

app.post('/api/auth/login', async (c) => {
  const body: { username?: unknown; password?: unknown } = await c.req.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return c.json({ error: '아이디와 비밀번호를 입력해 주세요.' }, 400);

  // 1초 늦추기만으로는 동시에 여러 번 넣어 보는 것을 막지 못해, 틀린 횟수를 세어 막는다
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > datetime('now', ?)`
  )
    .bind(ip, `-${LOGIN_LOCK_MINUTES} minutes`)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= LOGIN_MAX_FAILURES) {
    return c.json({ error: `여러 번 틀려서 잠시 막았습니다. ${LOGIN_LOCK_MINUTES}분 뒤에 다시 해 주세요.` }, 429);
  }

  const row = await c.env.DB.prepare(
    'SELECT id, username, name, password_hash FROM users WHERE username = ?'
  )
    .bind(username.trim().toLowerCase())
    .first<User & { password_hash: string }>();

  // 계정이 없을 때도 같은 메시지를 돌려주어 있는 아이디를 알아낼 수 없게 한다
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await c.env.DB.prepare('INSERT INTO login_failures (ip) VALUES (?)').bind(ip).run();
    // 비밀번호를 기계로 하나씩 넣어보는 걸 늦추기 위해 실패에는 일부러 시간을 준다
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return c.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  await c.env.DB.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
  await createSession(c, row.id);
  return c.json({ id: row.id, username: row.username, name: row.name } satisfies User);
});

app.post('/api/auth/logout', async (c) => {
  await destroySession(c);
  return c.body(null, 204);
});

app.get('/api/auth/me', async (c) => {
  const user = await currentUser(c);
  return user ? c.json(user) : c.json({ error: '로그인이 필요합니다.' }, 401);
});

// ── 이하 모든 API 는 로그인 필요 ────────────────────────────────────────
const api = new Hono<AppEnv>();
api.use('*', requireAuth);

// 저장이 끝난 요청마다 「장부가 바뀐 시각」을 적어 둔다 — 다른 기기가 접속 표시의 답으로 알아챈다 (worker/changed.ts)
api.use('*', async (c, next) => {
  await next();
  if (countsAsChange(c.req.method, c.req.path, c.res.status)) await markChanged(c.env);
});

/** 비밀번호 변경 — 바꾸고 나면 다른 기기의 로그인은 모두 끊는다 */
api.post('/auth/password', async (c) => {
  const body: { current?: unknown; next?: unknown } = await c.req.json().catch(() => ({}));
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';
  if (!current || !next) return c.json({ error: '지금 비밀번호와 새 비밀번호를 모두 입력해 주세요.' }, 400);
  if (next.length < 8) return c.json({ error: '새 비밀번호는 8자 이상으로 해 주세요.' }, 400);

  const me = c.get('user');
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(me.id)
    .first<{ password_hash: string }>();

  if (!row || !(await verifyPassword(current, row.password_hash))) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return c.json({ error: '지금 비밀번호가 맞지 않습니다.' }, 401);
  }

  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(next), me.id)
    .run();
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id).run();

  await createSession(c, me.id);
  return c.body(null, 204);
});
// ── 백업 ────────────────────────────────────────────────────────────────
api.get('/backups', async (c) => c.json(await listBackups(c.env)));

api.post('/backups', async (c) => c.json(await runBackup(c.env), 201));

// 백업으로 장부 되돌리기. 실수로 누르지 않게 그 백업의 날짜를 같이 보내야 한다
api.post('/backups/restore', async (c) => {
  const { key, confirm } = await c.req.json<{ key?: string; confirm?: string }>();
  const date = key?.startsWith('backup:') ? key.slice('backup:'.length, 'backup:'.length + 10) : '';
  if (!key || !date || confirm?.trim() !== date) {
    return c.json({ error: '되돌릴 백업의 날짜를 그대로 적어 주세요.' }, 400);
  }
  try {
    const result = await restoreBackup(c.env, key);
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e) {
    console.error('백업 되돌리기 실패', e);
    return c.json({ error: '되돌리지 못했습니다. 장부는 바뀌지 않았습니다.' }, 500);
  }
});

api.get('/backups/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const sql = await readBackup(c.env, key);
  if (!sql) return c.json({ error: '그 백업을 찾을 수 없습니다.' }, 404);

  const name = `jangbu-${key.replace('backup:', '')}.sql`;
  return new Response(sql, {
    headers: {
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
});

api.route('/', alerts);
api.route('/', presence);
api.route('/', drafts);
api.route('/', masters);
api.route('/', operatorPay);
api.route('/', sites);
api.route('/', workLogs);
api.route('/', photoLogs);
api.route('/', statements);
api.route('/', mail);
api.route('/', summary);
api.route('/', quotes);
api.route('/', dashboard);

// route() 는 부르는 시점에 경로를 복사해 간다. 반드시 모든 경로를 등록한 뒤에 붙일 것.
app.route('/api', api);

app.onError((err, c) => {
  // DB 가 거부한 이유는 「서버 오류」 대신 알아들을 수 있는 말로 돌려준다
  const reason = String(err?.message ?? err);
  if (reason.includes('ALREADY_BILLED')) {
    return c.json({ error: '이미 다른 명세표에 들어간 작업입니다. 새로고침한 뒤 다시 확인해 주세요.' }, 409);
  }
  if (reason.includes('UNIQUE constraint failed')) {
    return c.json({ error: '같은 이름이 이미 있습니다. 다른 이름으로 적어 주세요.' }, 409);
  }
  if (reason.includes('NOT NULL constraint failed')) {
    return c.json({ error: '비워 둘 수 없는 칸이 비어 있거나, 숫자 칸에 숫자가 아닌 것이 들어갔습니다.' }, 400);
  }
  console.error(err);
  return c.json({ error: '서버에서 오류가 발생했습니다.' }, 500);
});

app.all('/api/*', (c) => c.json({ error: '없는 API 경로입니다.' }, 404));

export default {
  fetch: app.fetch,

  /**
   * wrangler.jsonc 의 cron 두 개.
   *   0 0 * * *  (09:00 한국시간) 발행일 지난 미발행 알림
   *   0 18 * * * (03:00 한국시간) 자동 백업 · 만료된 로그인 정리
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 0 * * *') {
      ctx.waitUntil(
        runOverdueAlerts(env)
          .then((r) => console.log(`발행일 알림: 현장 ${r.sites}곳 · 보냄 ${r.sent} · 끊긴 기기 ${r.gone} · 실패 ${r.failed}`))
          .catch((error) => console.error('발행일 알림 실패:', error))
      );
      return;
    }

    ctx.waitUntil(
      runBackup(env)
        .then((entry) => console.log(`백업 완료: ${entry.key} · ${entry.bytes}바이트 · ${entry.rows}행`))
        .catch((error) => console.error('백업 실패:', error))
    );

    // 만료된 로그인은 쌓아 둘 이유가 없다. 접속 중인 기기 목록도 이만큼 깔끔해진다.
    ctx.waitUntil(
      env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`)
        .run()
        .then(({ meta }) => console.log(`만료된 로그인 ${meta.changes ?? 0}개 정리`))
        .catch((error) => console.error('로그인 정리 실패:', error))
    );
    ctx.waitUntil(
      env.DB.prepare(`DELETE FROM login_failures WHERE at <= datetime('now', '-1 day')`)
        .run()
        .catch((error) => console.error('로그인 실패 기록 정리 실패:', error))
    );
  },
} satisfies ExportedHandler<Env>;
