import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { PresenceResponse, SessionEntry } from '../../shared/types';
import { refreshSession, SESSION_COOKIE } from '../auth';
import { readChanged } from '../changed';
import type { AppEnv } from '../types';

/**
 * 동시 접속 표시.
 *
 * 화면이 20초마다 「나 아직 여기 있고, 지금 이 문서를 보고 있다」고 알려 주면(POST /presence),
 * 그 답으로 지금 살아 있는 다른 로그인들을 돌려준다. 같은 문서를 둘이 열어 두었는지
 * 바로 알 수 있어야, 서로 덮어쓰는 사고를 미리 막을 수 있다.
 */
const presence = new Hono<AppEnv>();

/** 이 시간 안에 소식이 있었으면 「접속 중」으로 본다 (화면은 20초마다 알려 온다) */
const ALIVE = '-75 seconds';

/** 사람이 알아볼 수 없는 User-Agent 대신 '윈도우 크롬' 같은 이름을 만든다 */
export function deviceName(ua: string | undefined): string {
  if (!ua) return '알 수 없는 기기';

  const os = /iPhone/i.test(ua)
    ? '아이폰'
    : /iPad/i.test(ua)
      ? '아이패드'
      : /Android/i.test(ua)
        ? '안드로이드'
        : /Macintosh|Mac OS X/i.test(ua)
          ? '맥'
          : /Windows/i.test(ua)
            ? '윈도우'
            : null;

  // 순서가 중요하다. 엣지·웨일·삼성 인터넷은 모두 User-Agent 에 Chrome 을 함께 달고 다닌다.
  const browser = /Edg\//.test(ua)
    ? '엣지'
    : /Whale\//.test(ua)
      ? '웨일'
      : /SamsungBrowser\//.test(ua)
        ? '삼성 인터넷'
        : /OPR\//.test(ua)
          ? '오페라'
          : /Firefox\//.test(ua)
            ? '파이어폭스'
            : /Chrome\//.test(ua)
              ? '크롬'
              : /Safari\//.test(ua)
                ? '사파리'
                : null;

  return [os, browser].filter(Boolean).join(' ') || '알 수 없는 기기';
}

/** SQLite 의 'YYYY-MM-DD HH:MM:SS' (UTC) 를 브라우저가 바로 읽는 ISO 로 */
export const sqlToIso = (value: string | null): string =>
  value ? `${value.replace(' ', 'T')}Z` : new Date().toISOString();

/** 화면이 보낸 글자를 길이만 잘라 그대로 쓴다 (내 계정에게만 보이는 값이다) */
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

type Row = {
  id: string;
  device: string | null;
  viewing: string | null;
  viewing_label: string | null;
  last_seen: string | null;
  name: string;
};

async function activeSessions(db: D1Database, myId: string): Promise<SessionEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.device, s.viewing, s.viewing_label, s.last_seen, u.name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > datetime('now')
          AND s.last_seen > datetime('now', ?)
        ORDER BY s.last_seen DESC`
    )
    .bind(ALIVE)
    .all<Row>();

  return results.map((r) => ({
    userName: r.name,
    device: r.device ?? '알 수 없는 기기',
    viewing: r.viewing,
    viewingLabel: r.viewing_label,
    lastSeen: sqlToIso(r.last_seen),
    self: r.id === myId,
  }));
}

/** 「나 여기 있다」 + 지금 접속 중인 목록 받기 */
presence.post('/presence', async (c) => {
  const myId = getCookie(c, SESSION_COOKIE) ?? '';
  await refreshSession(c);
  const body: { view?: unknown; label?: unknown } = await c.req.json().catch(() => ({}));

  await c.env.DB.prepare(
    `UPDATE sessions
        SET last_seen = datetime('now'),
            viewing = ?,
            viewing_label = ?,
            device = COALESCE(device, ?)
      WHERE id = ?`
  )
    .bind(clean(body.view, 40), clean(body.label, 60), deviceName(c.req.header('user-agent')), myId)
    .run();

  const [sessions, changed] = await Promise.all([activeSessions(c.env.DB, myId), readChanged(c.env)]);
  return c.json({ sessions, changed } satisfies PresenceResponse);
});

/** 설정 화면에서 보여줄 목록 (마지막 소식 순서) */
presence.get('/sessions', async (c) => {
  const myId = getCookie(c, SESSION_COOKIE) ?? '';
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.device, s.viewing, s.viewing_label, s.last_seen, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > datetime('now')
      ORDER BY s.last_seen DESC NULLS LAST`
  ).all<Row>();

  return c.json(
    results.map<SessionEntry>((r) => ({
      userName: r.name,
      device: r.device ?? '알 수 없는 기기',
      viewing: r.viewing,
      viewingLabel: r.viewing_label,
      lastSeen: sqlToIso(r.last_seen),
      self: r.id === myId,
    }))
  );
});

/** 지금 이 브라우저만 남기고 나머지 로그인을 끊는다 */
presence.delete('/sessions/others', async (c) => {
  const myId = getCookie(c, SESSION_COOKIE) ?? '';
  const { meta } = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(c.get('user').id, myId)
    .run();

  return c.json({ removed: meta.changes ?? 0 });
});

export default presence;
