/**
 * 원본 엑셀과 실서버 DB 를 행 단위로 대조하고, 금액 계산을 검증한다.
 * 이관 스크립트와 같은 파서를 쓰지 않고 여기서 다시 읽어, 파서 버그가 있으면 드러나게 한다.
 *
 * 자료를 바꾸지 않는다 (장부·백업을 읽기만). 끝나면 로그아웃한다.
 *   JANGBU_PASSWORD=... node e2e/excel_vs_live.mjs   (이 컴퓨터의 원본자료/거래명세표.xlsx 가 필요)
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const XLSX = process.env.XLSX ?? '원본자료/거래명세표.xlsx';
const BASE = (process.env.BASE ?? 'https://example.workers.dev').replace(/\/$/, '');
const PASSWORD = process.env.JANGBU_PASSWORD;
if (!PASSWORD) {
  console.error('JANGBU_PASSWORD 환경변수로 비밀번호를 넣어 주세요. (저장소에는 비밀번호를 적지 않는다)');
  process.exit(1);
}

// ── xlsx 읽기 ───────────────────────────────────────────────────────────
function unzip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const entries = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataOff = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(dataOff, dataOff + compSize);
    entries.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const dec = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const files = unzip(XLSX);
const shared = [...files.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(([, b]) => [...b.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => dec(m[1])).join(''));

const rows = new Map();
for (const [, attrs, body] of files.get('xl/worksheets/sheet1.xml').toString('utf8').matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
  const r = Number(/ r="(\d+)"/.exec(attrs)?.[1]);
  const cells = {};
  for (const [, ca, cb] of body.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const col = / r="([A-Z]+)\d+"/.exec(ca)?.[1];
    if (!col || !cb) continue;
    const t = / t="([^"]+)"/.exec(ca)?.[1];
    const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cb)?.[1];
    if (v != null) cells[col] = (t === 's' ? shared[+v] : dec(v)).trim();
  }
  if (Object.keys(cells).length) rows.set(r, cells);
}

const isNum = (v) => v != null && v !== '' && !Number.isNaN(Number(v));
const serialToISO = (s) => new Date(Math.round((Number(s) - 25569) * 86400000)).toISOString().slice(0, 10);

function parseTime(raw) {
  if (!raw) return [null, null];
  const m = /^(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})$/.exec(String(raw));
  if (m) return [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`];
  if (isNum(raw)) {
    const d = String(Math.round(Number(raw))).padStart(8, '0');
    if (d.length !== 8) return [null, null];
    return [`${d.slice(0, 2)}:${d.slice(2, 4)}`, `${d.slice(4, 6)}:${d.slice(6, 8)}`];
  }
  return [null, null];
}

const excel = [];
let date = null;
for (let r = 5; r <= Math.max(...rows.keys()); r++) {
  const c = rows.get(r);
  if (!c) continue;
  if (isNum(c.B)) date = serialToISO(c.B);
  if (!c.C || !date) continue;
  const [st, et] = parseTime(c.E);
  excel.push({
    excelRow: r,
    work_date: date,
    site_label: c.C,
    description: c.D ?? null,
    start_time: st,
    end_time: et,
    pour_volume: isNum(c.F) ? Number(c.F) : null,
    boom_size: isNum(c.G) ? Math.round(Number(c.G)) : null,
    ot_hours: isNum(c.H) ? Number(c.H) : 0,
    base_amount: isNum(c.J) ? Math.round(Number(c.J)) : 0,
    operator_name: c.K ?? null,
    fuel_amount: isNum(c.M) ? Math.round(Number(c.M)) : null,
  });
}

// ── DB 읽기 ─────────────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.JANGBU_USERNAME ?? 'admin', password: PASSWORD }),
});
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const led = await (await fetch(`${BASE}/api/work-logs?from=2000-01-01&to=2099-12-31`, { headers: { cookie } })).json();

// 장부 목록은 work_date DESC, sort_order, id 순서다.
// 단순히 reverse 하면 같은 날짜 안에서 순서가 뒤집히므로 제대로 정렬한다.
const db = [...led.rows].sort(
  (a, b) => a.work_date.localeCompare(b.work_date) || a.sort_order - b.sort_order || a.id - b.id
);

// ── 대조 ────────────────────────────────────────────────────────────────
const FIELDS = ['work_date', 'site_label', 'description', 'start_time', 'end_time', 'pour_volume', 'boom_size', 'ot_hours', 'base_amount', 'operator_name', 'fuel_amount'];
const diffs = [];

console.log(`엑셀 ${excel.length}행 · DB ${db.length}행`);
if (excel.length !== db.length) console.log(`  ⚠ 행 수가 다릅니다`);

for (let i = 0; i < Math.min(excel.length, db.length); i++) {
  for (const f of FIELDS) {
    const a = excel[i][f] ?? null;
    const b = db[i][f] ?? null;
    if (String(a) !== String(b)) diffs.push({ i, excelRow: excel[i].excelRow, field: f, excel: a, db: b });
  }
}

console.log(`\n[1] 엑셀 ↔ DB 행 단위 대조 (${excel.length}행 × ${FIELDS.length}개 항목 = ${excel.length * FIELDS.length}건)`);
console.log(diffs.length ? `  ✗ 불일치 ${diffs.length}건` : `  ✓ 전부 일치`);
for (const d of diffs.slice(0, 12)) console.log(`    엑셀 ${d.excelRow}행 ${d.field}: 엑셀=${JSON.stringify(d.excel)} DB=${JSON.stringify(d.db)}`);

// ── 금액 계산 ───────────────────────────────────────────────────────────
const calcBad = [];
for (const row of led.rows) {
  const expectedOt = Math.round((row.base_amount * row.ot_hours) / 10);
  if (row.ot_amount !== expectedOt) calcBad.push({ id: row.id, 항목: 'OT금액', 기대: expectedOt, 실제: row.ot_amount });
  if (row.supply_amount !== row.base_amount + row.ot_amount) {
    calcBad.push({ id: row.id, 항목: '공급가액', 기대: row.base_amount + row.ot_amount, 실제: row.supply_amount });
  }
}
const otRows = led.rows.filter((r) => r.ot_hours > 0);
console.log(`\n[2] 금액 계산 (OT금액 = 금액×0.1×OT시간, 공급가액 = 금액+OT금액)`);
console.log(`  검사 ${led.rows.length}행 (OT 있는 행 ${otRows.length}행)`);
console.log(calcBad.length ? `  ✗ 어긋남 ${calcBad.length}건: ${JSON.stringify(calcBad.slice(0, 5))}` : `  ✓ 전부 일치`);

// ── 합계 ────────────────────────────────────────────────────────────────
const excelSupply = excel.reduce((s, r) => s + r.base_amount + Math.round((r.base_amount * r.ot_hours) / 10), 0);
console.log(`\n[3] 공급가액 합계`);
console.log(`  엑셀 계산: ${excelSupply.toLocaleString('ko-KR')}`);
console.log(`  DB  집계 : ${led.totals.supplyAmount.toLocaleString('ko-KR')}`);
console.log(excelSupply === led.totals.supplyAmount ? '  ✓ 일치' : '  ✗ 불일치');

// ── 세액 반올림 ─────────────────────────────────────────────────────────
const stmts = await (await fetch(`${BASE}/api/statements`, { headers: { cookie } })).json();
console.log(`\n[4] 명세표 세액 반올림 (줄별 세액 합 vs 총액 기준 세액)`);
if (!stmts.length) {
  console.log('  발행된 명세표가 없어 건너뜀');
} else {
  for (const s of stmts) {
    const d = await (await fetch(`${BASE}/api/statements/${s.id}`, { headers: { cookie } })).json();
    const lineVatSum = d.lines.reduce((a, l) => a + l.vat_amount, 0);
    const totalVat = d.totals.vatAmount;
    console.log(`  #${s.id} 줄별합 ${lineVatSum.toLocaleString('ko-KR')} / 총액기준 ${totalVat.toLocaleString('ko-KR')} ${lineVatSum === totalVat ? '✓' : '✗ 차이 ' + (totalVat - lineVatSum)}`);
  }
}

// ── 미발행 집계 ─────────────────────────────────────────────────────────
const sum = await (await fetch(`${BASE}/api/summary?from=2000-01-01&to=2099-12-31`, { headers: { cookie } })).json();
const sumSupply = sum.cells.reduce((a, c) => a + c.supply_amount, 0);
const sumCount = sum.cells.reduce((a, c) => a + c.count, 0);
console.log(`\n[5] 현장별 집계 ↔ 장부`);
console.log(`  건수  집계 ${sumCount} / 장부 ${led.totals.count} ${sumCount === led.totals.count ? '✓' : '✗'}`);
console.log(`  공급가액 집계 ${sumSupply.toLocaleString('ko-KR')} / 장부 ${led.totals.supplyAmount.toLocaleString('ko-KR')} ${sumSupply === led.totals.supplyAmount ? '✓' : '✗'}`);

// ── 백업 ────────────────────────────────────────────────────────────────
const backups = await (await fetch(`${BASE}/api/backups`, { headers: { cookie } })).json();
console.log(`\n[6] 자동 백업`);
console.log(`  보관 ${backups.length}개 · 가장 최근 ${backups[0]?.date ?? '(없음)'} (${backups[0]?.rows ?? 0}행, ${Math.round((backups[0]?.bytes ?? 0) / 1024)}KB, 만든 시각 ${backups[0]?.createdAt ?? '-'})`);
if (backups[0]) {
  const sql = await (await fetch(`${BASE}/api/backups/${backups[0].key}`, { headers: { cookie } })).text();
  const has = (t) => sql.includes(`INSERT INTO ${t} `) || sql.includes(`-- ${t}: 없음`);
  const tables = ['users', 'companies', 'company_stamps', 'clients', 'sites', 'site_rates', 'site_contacts', 'operators', 'work_logs', 'statements', 'statement_lines', 'quotes', 'quote_lines'];
  const missing = tables.filter((t) => !has(t));
  console.log(missing.length ? `  ✗ 최근 백업에 빠진 표: ${missing.join(', ')}` : `  ✓ 최근 백업에 표 ${tables.length}개가 모두 들어 있음`);
}

// 검사하느라 만든 로그인은 남기지 않는다 (설정 → 접속 중인 기기 목록에 뜨지 않게)
await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } });
console.log('\n(검사용 로그인 정리함)');
