import { describe, expect, it } from 'vitest';
import { countsAsChange, markChanged, readChanged } from '../worker/changed';

describe('countsAsChange — 장부가 바뀐 요청인가', () => {
  it.each([
    ['POST', '/api/work-logs', 200, true],
    ['PUT', '/api/sites/3', 200, true],
    ['PATCH', '/api/statements/7/pay', 204, true],
    ['DELETE', '/api/work-logs/12', 204, true],
    // 읽기만 한 것
    ['GET', '/api/work-logs', 200, false],
    // 실패한 저장은 바뀐 것이 없다
    ['POST', '/api/work-logs', 400, false],
    ['POST', '/api/work-logs', 500, false],
    // 20초마다 오는 접속 표시와 적는 중에 계속 오는 임시저장은 세지 않는다
    ['POST', '/api/presence', 200, false],
    ['PUT', '/api/drafts/statement', 200, false],
    ['POST', '/api/drafts/quote/undo', 200, false],
  ])('%s %s (%i) → %s', (method, path, status, expected) => {
    expect(countsAsChange(method, path, status)).toBe(expected);
  });
});

describe('markChanged · readChanged — 마지막으로 바뀐 시각', () => {
  const fakeEnv = () => {
    const store = new Map<string, string>();
    return {
      BACKUPS: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => void store.set(key, value),
      },
    } as unknown as Env;
  };

  it('아무도 저장한 적 없으면 null', async () => {
    expect(await readChanged(fakeEnv())).toBeNull();
  });

  it('저장하면 값이 생기고, 또 저장하면 달라진다', async () => {
    const env = fakeEnv();
    await markChanged(env, 1000);
    const first = await readChanged(env);
    await markChanged(env, 2000);
    expect(first).toBe('1000');
    expect(await readChanged(env)).toBe('2000');
  });

  it('적어 두지 못해도 저장 자체는 막지 않는다', async () => {
    const env = { BACKUPS: { put: async () => Promise.reject(new Error('KV 한도')), get: async () => Promise.reject(new Error('KV')) } } as unknown as Env;
    await expect(markChanged(env)).resolves.toBeUndefined();
    expect(await readChanged(env)).toBeNull();
  });
});
