/**
 * 장부가 마지막으로 바뀐 시각.
 *
 * 저장이 있을 때마다 시각을 적어 두고, 화면이 20초마다 보내는 접속 표시(POST /presence)의 답에 실어 보낸다.
 * 화면은 그 값이 달라졌으면 「다른 기기에서 무언가 바뀌었다」고 알고, 받아 둔 내용을 다시 불러온다.
 * 값 하나라 표를 새로 만들지 않고 백업 보관함(KV)에 같이 둔다 — 백업 열쇠는 'backup:' 으로 시작해 섞이지 않는다.
 * KV 는 다른 곳에서 읽을 때 길게는 1분쯤 늦을 수 있다. 그만큼 늦게 따라오는 것은 괜찮다.
 */
const KEY = 'changed';

/** 20초마다 오는 접속 표시와, 적는 중에 계속 오는 임시저장은 장부가 바뀐 것으로 치지 않는다 */
const QUIET = /\/(presence|drafts)(\/|$)/;

export function countsAsChange(method: string, path: string, status: number): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  if (status >= 400) return false;
  return !QUIET.test(path);
}

/** 적어 두지 못해도(KV 한도 등) 저장 자체는 이미 끝났으니 조용히 넘어간다 */
export async function markChanged(env: Env, now: number = Date.now()): Promise<void> {
  try {
    await env.BACKUPS.put(KEY, String(now));
  } catch (error) {
    console.error('바뀐 시각을 적지 못함:', error);
  }
}

export async function readChanged(env: Env): Promise<string | null> {
  try {
    return await env.BACKUPS.get(KEY);
  } catch {
    return null;
  }
}
