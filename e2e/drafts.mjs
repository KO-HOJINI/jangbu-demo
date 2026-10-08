/**
 * 임시저장 되돌리기 · 다시 실행 · 지점 이동 · 20개 제한 · 접속 표시 확인.
 * 임시저장 기록을 지웠다 다시 쓰므로 로컬 개발 서버에서만 돈다.
 *   JANGBU_PASSWORD=... node e2e/drafts.mjs
 */
const BASE = (process.env.BASE ?? 'http://localhost:5173').replace(/\/$/, '');
const PASSWORD = process.env.JANGBU_PASSWORD;
if (!PASSWORD) {
  console.error('JANGBU_PASSWORD 환경변수로 비밀번호를 넣어 주세요. (저장소에는 비밀번호를 적지 않는다)');
  process.exit(1);
}
if (!BASE.startsWith('http://localhost') && process.env.ALLOW_LIVE !== '1') {
  console.error(`임시저장 기록을 지웠다 다시 쓰므로 로컬 개발 서버에서만 돌린다. (${BASE})`);
  process.exit(1);
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.JANGBU_USERNAME ?? 'admin', password: PASSWORD }),
});
if (!login.ok) throw new Error('로그인 실패: ' + login.status);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { cookie, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const save = (note) => call('/drafts/statement', { method: 'PUT', body: JSON.stringify({ payload: { note } }) });
const note = (s) => s?.payload?.note ?? null;

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  기대=${JSON.stringify(expected)} 실제=${JSON.stringify(actual)}`}`);
};

await call('/drafts/statement', { method: 'DELETE' });
console.log('\n[1] 담아 둔 것이 없을 때');
check('null 을 돌려준다', await call('/drafts/statement'), null);

console.log('\n[2] 저장하면 지점이 쌓인다');
let s = await save('가');
check('첫 저장', note(s), '가');
check('되돌릴 것 없음', s.canUndo, false);
s = await save('나');
s = await save('다');
check('세 번 저장하면 지점 3개', s.points.length, 3);
check('지금은 마지막', note(s), '다');
check('되돌릴 수 있음', s.canUndo, true);
check('다시 실행할 것 없음', s.canRedo, false);

console.log('\n[3] 같은 내용은 지점을 늘리지 않는다 (1초마다 올라오므로 중요)');
s = await save('다');
check('그대로 3개', s.points.length, 3);

console.log('\n[4] 되돌리기');
s = await call('/drafts/statement/undo', { method: 'POST' });
check('다 → 나', note(s), '나');
s = await call('/drafts/statement/undo', { method: 'POST' });
check('나 → 가', note(s), '가');
check('더 되돌릴 것 없음', s.canUndo, false);
check('기록은 그대로 3개', s.points.length, 3);
s = await call('/drafts/statement/undo', { method: 'POST' });
check('맨 앞에서 더 눌러도 그대로', note(s), '가');

console.log('\n[5] 다른 컴퓨터에서 이어 받기 (새로 불러오기)');
check('되돌린 지점이 그대로 보인다', note(await call('/drafts/statement')), '가');

console.log('\n[6] 다시 실행');
s = await call('/drafts/statement/redo', { method: 'POST' });
check('가 → 나', note(s), '나');
s = await call('/drafts/statement/redo', { method: 'POST' });
check('나 → 다', note(s), '다');
check('더 실행할 것 없음', s.canRedo, false);

console.log('\n[7] 되돌린 뒤 새로 고치면 앞쪽 기록은 버린다');
await call('/drafts/statement/undo', { method: 'POST' });   // 다 → 나
s = await save('라');
check('나 뒤에 라가 붙는다', note(s), '라');
check('다 는 사라졌다', s.points.length, 3);
check('다시 실행할 것 없음', s.canRedo, false);
check('되돌리면 나', note(await call('/drafts/statement/undo', { method: 'POST' })), '나');
await call('/drafts/statement/redo', { method: 'POST' });

console.log('\n[8] 지점 하나를 콕 집어 되돌아가기');
const first = (await call('/drafts/statement')).points.at(-1);
s = await call('/drafts/statement/restore', { method: 'POST', body: JSON.stringify({ id: first.id }) });
check('가장 처음 지점으로', note(s), '가');

console.log('\n[9] 21번째 저장부터는 오래된 지점이 밀려난다');
await call('/drafts/statement', { method: 'DELETE' });
for (let i = 1; i <= 25; i++) s = await save(`값${i}`);
check('지점은 20개까지', s.points.length, 20);
check('지금은 마지막', note(s), '값25');
const oldest = await call('/drafts/statement/restore', { method: 'POST', body: JSON.stringify({ id: s.points.at(-1).id }) });
check('가장 오래된 지점은 값6 (값1~5 는 밀려남)', note(oldest), '값6');

console.log('\n[10] 발행하고 나면 기록째 지운다');
await call('/drafts/statement', { method: 'DELETE' });
check('다시 null', await call('/drafts/statement'), null);

console.log('\n[11] 없는 종류는 거절한다');
const bad = await fetch(`${BASE}/api/drafts/hack`, { headers: { cookie } });
check('400', bad.status, 400);

console.log('\n[12] 접속 표시');
const p = await call('/presence', { method: 'POST', body: JSON.stringify({ view: 'statement:new', label: '거래명세표 작성 중' }) });
check('내 접속이 보인다', p.sessions.some((x) => x.self), true);
check('보고 있는 화면이 기록된다', p.sessions.find((x) => x.self)?.viewing, 'statement:new');
check('기기 이름이 붙는다', typeof p.sessions.find((x) => x.self)?.device === 'string', true);

const list = await call('/sessions');
check('설정 화면 목록에도 나온다', list.some((x) => x.self), true);

console.log(`\n${fail ? '✗' : '✓'} ${pass}건 통과 · ${fail}건 실패`);
process.exit(fail ? 1 : 0);
