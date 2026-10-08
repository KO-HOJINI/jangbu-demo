import { Hono } from 'hono';
import { collectOverdue, overdueTitle, type OverdueSite } from '../../shared/issueDue';
import type { AppEnv } from '../types';
import { sendPush, type PushMessage } from '../push';
import { deviceName, sqlToIso } from './presence';

/**
 * 발행일 알림.
 *   - 화면: 맨 위 알림 띠가 GET /alerts/overdue 를 본다.
 *   - 휴대폰·PC: 매일 09:00(한국시간) cron 이 runOverdueAlerts 로 알림을 보낸다.
 *   - 「이 기기에서 알림 받기」: /push/* 로 기기를 등록·해제·시험한다.
 */
const alerts = new Hono<AppEnv>();

/** 한국 날짜 YYYY-MM-DD (워커 시계는 UTC 다) */
export const koreaToday = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

/** 발행일이 내일까지 돌아오는데 아직 명세표를 안 낸 작업 (보관한 현장은 뺀다 — 끝난 현장이 매일 알림을 울리지 않게) */
export async function loadOverdue(db: D1Database, today = koreaToday()): Promise<OverdueSite[]> {
  const [sites, unbilled] = await db.batch([
    db.prepare('SELECT id, label, issue_day, closing_day FROM sites WHERE archived = 0'),
    db.prepare(
      `SELECT w.site_id, w.work_date, w.supply_amount
         FROM work_logs w
        WHERE w.work_date <= ?
          AND NOT EXISTS (SELECT 1 FROM statement_lines sl
                            JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                           WHERE sl.work_log_id = w.id)`
    ).bind(today),
  ]);
  return collectOverdue(
    sites.results as { id: number; label: string; issue_day: string | null; closing_day: string | null }[],
    unbilled.results as { site_id: number; work_date: string; supply_amount: number }[],
    today
  );
}

/** 「1억 7,111만 원」 — 화면의 금액 읽기와 같은 꼴. 알림은 짧아야 해서 만 원 아래는 반올림한다 */
export const manwon = (amount: number) => {
  if (amount < 10_000) return `${amount.toLocaleString('ko-KR')}원`;
  const man = Math.round(amount / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  return [eok ? `${eok.toLocaleString('ko-KR')}억` : '', rest ? `${rest.toLocaleString('ko-KR')}만` : '']
    .filter(Boolean)
    .join(' ') + ' 원';
};

/** 알림 한 통으로 줄인다 — 현장마다 따로 보내면 아침마다 알림이 줄줄이 온다 */
export function overdueMessage(items: OverdueSite[], today: string): PushMessage | null {
  if (!items.length) return null;
  const total = items.reduce((s, i) => s + i.amount, 0);
  const head = items
    .slice(0, 2)
    .map((i) => `${i.site_label} ${manwon(i.amount)}`)
    .join(', ');
  const more = items.length > 2 ? ` 외 ${items.length - 2}곳` : '';
  // 하루 전부터 알리므로, 내일·오늘이 발행일인 것까지 「지났는데」라고 하지 않는다
  const allLate = items.every((i) => i.issue_date < today);
  const lead = allLate ? '발행일이 지났는데 아직 안 낸 작업이 있습니다.' : `${overdueTitle(items, today)}.`;
  return {
    title: `명세표 낼 현장 ${items.length}곳 · ${manwon(total)}`,
    body: `${lead} ${head}${more}`,
    url: '/sites',
    tag: `overdue-${today}`,
  };
}

type SubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };

const vapidOf = (env: Env) => ({
  publicKey: env.VAPID_PUBLIC_KEY,
  privateJwk: env.VAPID_PRIVATE_JWK,
  subject: env.VAPID_SUBJECT,
});

/** 여러 기기에 보내고 결과를 적는다. 끊긴 기기(410)는 지운다. */
async function deliver(env: Env, subs: SubscriptionRow[], message: PushMessage) {
  const results = await Promise.all(
    subs.map(async (s) => {
      const status = await sendPush(s, message, vapidOf(env)).catch((e) => {
        console.error('푸시 오류', e);
        return 'error' as const;
      });
      if (status === 'gone') {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
      } else {
        await env.DB.prepare(`UPDATE push_subscriptions SET last_sent_at = datetime('now'), last_status = ? WHERE id = ?`)
          .bind(status, s.id)
          .run();
      }
      return status;
    })
  );
  return {
    sent: results.filter((r) => r === 'ok').length,
    gone: results.filter((r) => r === 'gone').length,
    failed: results.filter((r) => r === 'error').length,
  };
}

/** 매일 아침 cron 이 부른다 */
export async function runOverdueAlerts(env: Env) {
  if (!env.VAPID_PRIVATE_JWK) {
    console.warn('VAPID_PRIVATE_JWK 가 없어 알림을 보내지 않았습니다 (wrangler secret put VAPID_PRIVATE_JWK)');
    return { sites: 0, sent: 0, gone: 0, failed: 0 };
  }
  const today = koreaToday();
  const items = await loadOverdue(env.DB, today);
  const message = overdueMessage(items, today);
  if (!message) return { sites: 0, sent: 0, gone: 0, failed: 0 };

  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all<SubscriptionRow>();
  return { sites: items.length, ...(await deliver(env, results, message)) };
}

// ── 화면용 ─────────────────────────────────────────────────────────────
alerts.get('/alerts/overdue', async (c) => {
  const today = koreaToday();
  const items = await loadOverdue(c.env.DB, today);
  return c.json({
    today,
    items,
    count: items.reduce((s, i) => s + i.count, 0),
    amount: items.reduce((s, i) => s + i.amount, 0),
  });
});

// ── 기기 등록 ──────────────────────────────────────────────────────────
alerts.get('/push/key', (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY, ready: Boolean(c.env.VAPID_PRIVATE_JWK) }));

/** 알림을 받기로 한 기기 목록 (설정 화면) */
alerts.get('/push/devices', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT endpoint, device, created_at, last_sent_at, last_status FROM push_subscriptions ORDER BY created_at DESC`
  ).all<{ endpoint: string; device: string | null; created_at: string; last_sent_at: string | null; last_status: string | null }>();
  return c.json(
    results.map((r) => ({
      endpoint: r.endpoint,
      device: r.device ?? '알 수 없는 기기',
      createdAt: sqlToIso(r.created_at),
      lastSentAt: r.last_sent_at ? sqlToIso(r.last_sent_at) : null,
      lastStatus: r.last_status,
    }))
  );
});

const isHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length < 1000;
const isKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(v);

alerts.post('/push/subscribe', async (c) => {
  const body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } = await c.req.json().catch(() => ({}));
  const { endpoint } = body;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!isHttps(endpoint) || !isKey(p256dh) || !isKey(auth)) {
    return c.json({ error: '알림 등록 정보가 올바르지 않습니다. 다시 눌러 주세요.' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
                                           auth = excluded.auth, device = excluded.device`
  )
    .bind(c.get('user').id, endpoint, p256dh, auth, deviceName(c.req.header('user-agent')))
    .run();
  return c.body(null, 204);
});

alerts.post('/push/unsubscribe', async (c) => {
  const body: { endpoint?: unknown } = await c.req.json().catch(() => ({}));
  if (typeof body.endpoint !== 'string') return c.json({ error: '어느 기기인지 알 수 없습니다.' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(body.endpoint).run();
  return c.body(null, 204);
});

/** 「시험 알림 보내기」 — 이 기기로 한 통 */
alerts.post('/push/test', async (c) => {
  if (!c.env.VAPID_PRIVATE_JWK) return c.json({ error: '서버에 알림 열쇠가 아직 없습니다.' }, 503);
  const body: { endpoint?: unknown } = await c.req.json().catch(() => ({}));
  const sub = await c.env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
    .bind(typeof body.endpoint === 'string' ? body.endpoint : '')
    .first<SubscriptionRow>();
  if (!sub) return c.json({ error: '이 기기는 알림 받기가 켜져 있지 않습니다.' }, 404);

  const today = koreaToday();
  const items = await loadOverdue(c.env.DB, today);
  const message = overdueMessage(items, today) ?? {
    title: '장부 알림 시험',
    body: '알림이 잘 옵니다. 발행일 하루 전부터, 안 낸 명세표가 있으면 매일 아침 9시에 알려 드립니다.',
    url: '/sites',
  };
  const result = await deliver(c.env, [sub], { ...message, tag: 'test' });
  if (result.gone) return c.json({ error: '이 기기의 알림이 끊겨 있습니다. 알림 받기를 다시 눌러 주세요.' }, 410);
  if (result.failed) return c.json({ error: '알림 서버가 받지 않았습니다. 잠시 뒤 다시 해 주세요.' }, 502);
  return c.json({ ok: true });
});

export default alerts;
