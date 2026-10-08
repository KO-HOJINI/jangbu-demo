import { Hono } from 'hono';
import type { DraftState } from '../../shared/types';
import type { AppEnv } from '../types';
import { sqlToIso } from './presence';

/**
 * 자동 임시저장.
 *
 * 발행을 누르기 전의 명세표·견적서를 서버에 담아 둔다. 브라우저가 아니라 서버에 있으므로
 * 다른 컴퓨터에서 로그인해도 하던 작업이 그대로 이어진다.
 *
 * draft_history 는 시간 순서로 쌓인 기록 전체이고, drafts.current_id 가 그중 지금 지점을
 * 가리키는 손가락이다. 되돌리기·다시 실행은 이 손가락만 옮기므로 기록이 지워지지 않는다.
 * 되돌린 상태에서 새로 고치면 그때 앞쪽(다시 실행할 것) 기록을 버리고 거기서 다시 쌓는다.
 */
const drafts = new Hono<AppEnv>();

const KINDS = new Set(['statement', 'quote']);
/** 남겨 둘 되돌리기 지점 수 */
const KEEP = 20;
/** 담아 둘 수 있는 JSON 크기 (작성 중인 화면 값이라 원래 아주 작다) */
const MAX_BYTES = 64 * 1024;

type HistoryRow = { id: number; payload: string; saved_at: string };

async function load(db: D1Database, userId: number, kind: string) {
  const [pointer, history] = await Promise.all([
    db
      .prepare('SELECT current_id FROM drafts WHERE user_id = ? AND kind = ?')
      .bind(userId, kind)
      .first<{ current_id: number }>(),
    db
      .prepare('SELECT id, payload, saved_at FROM draft_history WHERE user_id = ? AND kind = ? ORDER BY id')
      .bind(userId, kind)
      .all<HistoryRow>(),
  ]);

  const rows = history.results;
  if (!rows.length) return null;

  // 손가락이 없거나 가리키던 기록이 사라졌으면 가장 최근 것으로 본다
  const currentId = rows.some((r) => r.id === pointer?.current_id)
    ? pointer!.current_id
    : rows[rows.length - 1].id;

  return { rows, currentId };
}

function toState(loaded: { rows: HistoryRow[]; currentId: number }): DraftState {
  const { rows, currentId } = loaded;
  const current = rows.find((r) => r.id === currentId)!;

  return {
    payload: JSON.parse(current.payload) as unknown,
    savedAt: sqlToIso(current.saved_at),
    canUndo: rows.some((r) => r.id < currentId),
    canRedo: rows.some((r) => r.id > currentId),
    points: [...rows]
      .reverse()
      .map((r) => ({ id: r.id, savedAt: sqlToIso(r.saved_at), current: r.id === currentId })),
  };
}

const kindOf = (c: { req: { param: (k: string) => string } }) => {
  const kind = c.req.param('kind');
  return KINDS.has(kind) ? kind : null;
};

/** 지금 담겨 있는 것 (없으면 null) */
drafts.get('/drafts/:kind', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const loaded = await load(c.env.DB, c.get('user').id, kind);
  return c.json(loaded ? toState(loaded) : null);
});

/** 자동 저장 — 내용이 그대로면 새 지점을 만들지 않는다 */
drafts.put('/drafts/:kind', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const body = await c.req.json<{ payload?: unknown }>().catch(() => null);
  if (!body || body.payload === undefined) return c.json({ error: '저장할 내용이 없습니다.' }, 400);

  const payload = JSON.stringify(body.payload);
  if (payload.length > MAX_BYTES) return c.json({ error: '임시저장 내용이 너무 큽니다.' }, 413);

  const db = c.env.DB;
  const userId = c.get('user').id;
  const loaded = await load(db, userId, kind);

  // 1초마다 올라오므로, 달라진 게 없으면 지점을 늘리지 않고 그대로 돌려준다
  if (loaded) {
    const current = loaded.rows.find((r) => r.id === loaded.currentId)!;
    if (current.payload === payload) return c.json(toState(loaded));

    // 되돌려 놓은 상태에서 새로 고쳤다면, 앞쪽(다시 실행) 기록은 버리고 여기서 다시 쌓는다
    await db
      .prepare('DELETE FROM draft_history WHERE user_id = ? AND kind = ? AND id > ?')
      .bind(userId, kind, loaded.currentId)
      .run();
  }

  const inserted = await db
    .prepare('INSERT INTO draft_history (user_id, kind, payload) VALUES (?, ?, ?) RETURNING id')
    .bind(userId, kind, payload)
    .first<{ id: number }>();

  await db
    .prepare(
      `INSERT INTO drafts (user_id, kind, current_id) VALUES (?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET current_id = excluded.current_id`
    )
    .bind(userId, kind, inserted!.id)
    .run();

  // 오래된 지점 정리
  await db
    .prepare(
      `DELETE FROM draft_history
        WHERE user_id = ? AND kind = ?
          AND id NOT IN (SELECT id FROM draft_history WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?)`
    )
    .bind(userId, kind, userId, kind, KEEP)
    .run();

  return c.json(toState((await load(db, userId, kind))!));
});

/** 손가락만 옮긴다 — 되돌리기 / 다시 실행 / 특정 지점으로 */
async function move(
  db: D1Database,
  userId: number,
  kind: string,
  pick: (rows: HistoryRow[], currentId: number) => HistoryRow | undefined
) {
  const loaded = await load(db, userId, kind);
  if (!loaded) return null;

  const target = pick(loaded.rows, loaded.currentId);
  if (!target) return toState(loaded);

  await db
    .prepare('UPDATE drafts SET current_id = ? WHERE user_id = ? AND kind = ?')
    .bind(target.id, userId, kind)
    .run();

  return toState({ rows: loaded.rows, currentId: target.id });
}

drafts.post('/drafts/:kind/undo', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const state = await move(c.env.DB, c.get('user').id, kind, (rows, id) =>
    [...rows].reverse().find((r) => r.id < id)
  );
  return state ? c.json(state) : c.json({ error: '되돌릴 기록이 없습니다.' }, 404);
});

drafts.post('/drafts/:kind/redo', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const state = await move(c.env.DB, c.get('user').id, kind, (rows, id) => rows.find((r) => r.id > id));
  return state ? c.json(state) : c.json({ error: '되돌릴 기록이 없습니다.' }, 404);
});

drafts.post('/drafts/:kind/restore', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const { id } = await c.req.json<{ id?: number }>().catch(() => ({ id: undefined }));
  if (typeof id !== 'number') return c.json({ error: '돌아갈 지점을 골라 주세요.' }, 400);

  const state = await move(c.env.DB, c.get('user').id, kind, (rows) => rows.find((r) => r.id === id));
  return state ? c.json(state) : c.json({ error: '되돌릴 기록이 없습니다.' }, 404);
});

/** 발행을 마쳤거나 「처음부터 다시」를 눌렀을 때 — 기록째 지운다 */
drafts.delete('/drafts/:kind', async (c) => {
  const kind = kindOf(c);
  if (!kind) return c.json({ error: '없는 임시저장 종류입니다.' }, 400);

  const userId = c.get('user').id;
  await c.env.DB.prepare('DELETE FROM drafts WHERE user_id = ? AND kind = ?').bind(userId, kind).run();
  await c.env.DB.prepare('DELETE FROM draft_history WHERE user_id = ? AND kind = ?').bind(userId, kind).run();

  return c.body(null, 204);
});

export default drafts;
