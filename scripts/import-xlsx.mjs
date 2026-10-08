#!/usr/bin/env node
/**
 * 기존 엑셀을 D1 시드 SQL로 변환한다.
 *
 *   node scripts/import-xlsx.mjs [장부엑셀] [거래처엑셀] [출력경로]
 *   기본값: 원본자료/거래명세표.xlsx  원본자료/거래처.xlsx  ->  migrations/0002_seed.sql
 *
 * - 거래명세표.xlsx 의 '2026년 장부' 시트  -> 거래처 / 현장 / 기사 / 작업 기록
 * - 거래처.xlsx 의 '거래처 등록용' 시트    -> 현장의 원청·주소·마감일·단가표·담당자
 *
 * 외부 의존성 없음. xlsx(zip) 해제와 XML 파싱을 직접 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { isNum, parseSiteLabel, parseTimeRange, serialToISO, sqlNumber, sqlQuote } from './parse.mjs';

/** 쓰던 엑셀 원본을 모아 둔 곳 */
const SOURCE_DIR = '원본자료';

const LEDGER_FILE = process.argv[2] ?? path.join(SOURCE_DIR, '거래명세표.xlsx');
const REGISTRY_FILE = process.argv[3] ?? path.join(SOURCE_DIR, '거래처.xlsx');
const OUT = process.argv[4] ?? path.join('migrations', '0002_seed.sql');

const LEDGER_SHEET = '2026년 장부';
const REGISTRY_SHEET_PREFIX = '거래처 등록용';

// ── zip 리더 (중앙 디렉터리만 읽고 필요한 엔트리를 inflate) ──────────────
function unzip(file) {
  const buf = fs.readFileSync(file);
  const eocd = (() => {
    for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
    throw new Error('zip End Of Central Directory를 찾지 못했습니다');
  })();

  const entries = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 중앙 디렉터리가 손상되었습니다');
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

// ── XML 헬퍼 ────────────────────────────────────────────────────────────
const decodeXml = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** 워크북 하나를 열어 시트 이름 -> 셀맵 조회 함수를 돌려준다 */
function openWorkbook(file) {
  const files = unzip(file);
  const text = (name) => files.get(name)?.toString('utf8') ?? '';

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, body]) =>
    [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')
  );
  const sheetNames = [...text('xl/workbook.xml').matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) =>
    decodeXml(m[1])
  );

  return {
    sheetNames,
    /** 시트 이름(또는 시작 문자열)으로 행 맵을 읽는다 */
    readSheet(match) {
      const idx = sheetNames.findIndex((n) => n === match || n.startsWith(match));
      if (idx < 0) throw new Error(`'${match}' 시트를 찾지 못했습니다. 시트: ${sheetNames.join(', ')}`);

      const xml = text(`xl/worksheets/sheet${idx + 1}.xml`);
      const rows = new Map();
      for (const [, rowAttrs, body] of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
        const r = Number(/ r="(\d+)"/.exec(rowAttrs)?.[1]);
        if (!r) continue;
        const cells = {};
        for (const [, cAttrs, cBody] of body.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const col = / r="([A-Z]+)\d+"/.exec(cAttrs)?.[1];
          if (!col || !cBody) continue;
          const type = / t="([^"]+)"/.exec(cAttrs)?.[1];
          let value = null;
          if (type === 'inlineStr') {
            value = decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(cBody)?.[1] ?? '');
          } else {
            const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cBody)?.[1];
            if (v != null) value = type === 's' ? shared[Number(v)] : decodeXml(v);
          }
          if (value != null && String(value).trim() !== '') cells[col] = String(value).trim();
        }
        if (Object.keys(cells).length) rows.set(r, cells);
      }
      return rows;
    },
  };
}

// ── 값 변환 ─────────────────────────────────────────────────────────────
// 다듬는 규칙은 scripts/parse.mjs 에 있다 (테스트가 같은 것을 쓴다)
const num = (v) => (isNum(v) ? Number(v) : null);
const int = (v) => (isNum(v) ? Math.round(Number(v)) : null);
const q = sqlQuote;
const n = sqlNumber;

// ── 1. 장부 읽기 ────────────────────────────────────────────────────────
const ledgerRows = openWorkbook(LEDGER_FILE).readSheet(LEDGER_SHEET);
const maxRow = Math.max(...ledgerRows.keys());

const logs = [];
const warnings = [];
let currentDate = null;
let sortOrder = 0;

for (let r = 5; r <= maxRow; r++) {
  const c = ledgerRows.get(r);
  if (!c) continue;

  if (isNum(c.B)) {
    currentDate = serialToISO(c.B);
    sortOrder = 0;
  }
  if (!c.C) continue; // 현장명 없으면 데이터 행이 아님
  if (!currentDate) {
    warnings.push(`장부 ${r}행: 날짜를 알 수 없어 건너뜀 (${c.C})`);
    continue;
  }

  const [startTime, endTime] = parseTimeRange(c.E);
  if (c.E && !startTime) warnings.push(`장부 ${r}행: 작업시간 해석 실패 -> ${JSON.stringify(c.E)}`);

  logs.push({
    workDate: currentDate,
    siteLabel: c.C,
    description: c.D ?? null,
    startTime,
    endTime,
    pourVolume: num(c.F),
    boomSize: int(c.G),
    otHours: num(c.H) ?? 0,
    baseAmount: int(c.J) ?? 0,
    operator: c.K ?? null,
    businessOwner: c.L ?? null,
    fuelAmount: int(c.M),
    extraAmount: int(c.N),
    sortOrder: sortOrder++,
  });
}

// ── 2. 거래처 등록 시트 읽기 (없으면 건너뜀) ────────────────────────────
/** 규격별 단가 열: [열, 규격, '반나절'|'하루'] */
const RATE_COLUMNS = [
  ['L', 26, 'half'],
  ['M', 26, 'full'],
  ['N', 32, 'half'],
  ['O', 32, 'full'],
  ['P', 37, 'half'],
  ['Q', 37, 'full'],
  ['R', 42, 'full'],
];

const registry = new Map(); // 시트용이름(label) -> 등록 정보

if (fs.existsSync(REGISTRY_FILE)) {
  const rows = openWorkbook(REGISTRY_FILE).readSheet(REGISTRY_SHEET_PREFIX);

  for (const [rowNo, c] of rows) {
    if (rowNo <= 22) continue; // 22행까지는 양식·머리글
    const label = c.S?.trim();
    if (!label) continue;

    const rates = [];
    for (const [col, boom, kind] of RATE_COLUMNS) {
      const amount = int(c[col]);
      if (amount == null) continue;
      const existing = rates.find((x) => x.boom === boom) ?? { boom, half: null, full: null };
      existing[kind] = amount;
      if (!rates.includes(existing)) rates.push(existing);
    }

    // 담당자는 X/Y/Z 열에 줄바꿈으로 여러 명이 들어 있다 (없으면 I/J/K 한 명)
    const split = (v) => (v ? String(v).split(/\r?\n/).map((s) => s.trim()) : []);
    const names = split(c.Z).length ? split(c.Z) : split(c.I);
    const phones = split(c.X).length ? split(c.X) : split(c.J);
    const emails = split(c.Y).length ? split(c.Y) : split(c.K);
    const contacts = names
      .map((name, i) => ({ name, phone: phones[i] ?? null, email: emails[i] ?? null }))
      .filter((x) => x.name);

    registry.set(label, {
      registeredAt: isNum(c.B) ? serialToISO(c.B) : null,
      primeContractor: c.C ?? null,
      clientFullName: c.D ?? null,
      address: c.E ?? null,
      closingDay: c.F ?? null,
      issueDay: c.G ?? null,
      companyName: c.H ?? null, // 한강중기 / 금강중기
      memo: c.T ?? null,
      rates,
      contacts,
    });
  }
} else {
  warnings.push(`${REGISTRY_FILE} 이 없어 거래처 등록 정보는 건너뜁니다.`);
}

// ── 3. 마스터 도출 (장부 + 등록시트 합집합) ─────────────────────────────
const siteLabels = [...new Set([...logs.map((l) => l.siteLabel), ...registry.keys()])];
const parsed = siteLabels.map((label) => ({ label, ...parseSiteLabel(label) }));
const clientNames = [...new Set(parsed.map((p) => p.client))].sort();
const operatorNames = [...new Set(logs.map((l) => l.operator).filter(Boolean))].sort();

const clientId = new Map(clientNames.map((name, i) => [name, i + 1]));
const siteId = new Map(parsed.map((p, i) => [p.label, i + 1]));
const operatorId = new Map(operatorNames.map((name, i) => [name, i + 1]));

// 거래처 정식 상호: 등록시트의 '건설회사' 를 우선 사용
const clientFullName = new Map();
for (const [label, info] of registry) {
  const { client } = parseSiteLabel(label);
  if (info.clientFullName) clientFullName.set(client, info.clientFullName);
}

// 사업자 구분 -> companies.id
const COMPANY_ID = { 한강중기: 1, 금강중기: 2 };
const companyIdOf = (name) => {
  if (!name) return null;
  for (const [key, id] of Object.entries(COMPANY_ID)) if (name.includes(key)) return id;
  return null;
};

// ── 4. SQL 출력 ─────────────────────────────────────────────────────────
const L = [];
const rateCount = [...registry.values()].reduce((s, r) => s + r.rates.length, 0);
const contactCount = [...registry.values()].reduce((s, r) => s + r.contacts.length, 0);

L.push('-- 기존 엑셀 이관 시드 (scripts/import-xlsx.mjs 자동 생성 — 직접 수정하지 말 것)');
L.push(`-- 원본: ${path.basename(LEDGER_FILE)} + ${path.basename(REGISTRY_FILE)} / 생성: ${new Date().toISOString()}`);
L.push(
  `-- 작업 ${logs.length}건, 현장 ${siteLabels.length}개(등록정보 ${registry.size}개), 거래처 ${clientNames.length}개, 기사 ${operatorNames.length}명, 단가 ${rateCount}건, 담당자 ${contactCount}명`
);
L.push('');

L.push('-- 공급자 (내 회사) — 엑셀 거래명세표/견적서 시트에서 추출');
L.push(
  'INSERT INTO companies (id, name, biz_no, ceo_name, address, biz_type, biz_item, tel, fax, is_default, sort_order) VALUES'
);
L.push(
  `  (1, '한강중기(샘플중기)', '123-45-67890', '김대표', '서울시 샘플구 샘플로 1, 101호', '건설업', '건설기계대여', '010-1234-5678', '0504-000-0000', 1, 1),`
);
L.push(
  `  (2, '금강중기(샘플중기)', '234-56-78901', '이대표', '인천 샘플구 샘플로 2, 202호', '건설업', '건설기계대여', '010-1234-5678', '0504-000-0000', 0, 2);`
);
L.push('');

L.push('-- 거래처');
L.push('INSERT INTO clients (id, name, full_name) VALUES');
L.push(
  clientNames
    .map((name) => `  (${clientId.get(name)}, ${q(name)}, ${q(clientFullName.get(name) ?? null)})`)
    .join(',\n') + ';'
);
L.push('');

L.push('-- 현장 (장부 표기 기준, 이름별 전부 구분 / 등록시트 정보 병합)');
L.push(
  'INSERT INTO sites (id, client_id, name, label, prime_contractor, address, company_id, closing_day, issue_day, registered_at, memo) VALUES'
);
L.push(
  parsed
    .map((p) => {
      const r = registry.get(p.label);
      return `  (${siteId.get(p.label)}, ${clientId.get(p.client)}, ${q(p.site)}, ${q(p.label)}, ${q(
        r?.primeContractor
      )}, ${q(r?.address)}, ${n(companyIdOf(r?.companyName))}, ${q(r?.closingDay)}, ${q(r?.issueDay)}, ${q(
        r?.registeredAt
      )}, ${q(r?.memo)})`;
    })
    .join(',\n') + ';'
);
L.push('');

if (rateCount) {
  L.push('-- 현장별 규격 단가표');
  L.push('INSERT INTO site_rates (site_id, boom_size, half_day_amount, full_day_amount) VALUES');
  L.push(
    [...registry.entries()]
      .flatMap(([label, info]) =>
        info.rates.map((r) => `  (${siteId.get(label)}, ${r.boom}, ${n(r.half)}, ${n(r.full)})`)
      )
      .join(',\n') + ';'
  );
  L.push('');
}

if (contactCount) {
  L.push('-- 현장 담당자');
  L.push('INSERT INTO site_contacts (site_id, name, phone, email, sort_order) VALUES');
  L.push(
    [...registry.entries()]
      .flatMap(([label, info]) =>
        info.contacts.map((c, i) => `  (${siteId.get(label)}, ${q(c.name)}, ${q(c.phone)}, ${q(c.email)}, ${i})`)
      )
      .join(',\n') + ';'
  );
  L.push('');
}

L.push('-- 기사님 (일부는 외주 업체명 — 설정 화면에서 정리)');
L.push('INSERT INTO operators (id, name) VALUES');
L.push(operatorNames.map((name) => `  (${operatorId.get(name)}, ${q(name)})`).join(',\n') + ';');
L.push('');

L.push('-- 장부');
L.push(
  'INSERT INTO work_logs (work_date, site_id, description, start_time, end_time, pour_volume, boom_size, ot_hours, base_amount, operator_id, business_owner, fuel_amount, extra_amount, sort_order) VALUES'
);
L.push(
  logs
    .map(
      (l) =>
        `  (${q(l.workDate)}, ${siteId.get(l.siteLabel)}, ${q(l.description)}, ${q(l.startTime)}, ${q(
          l.endTime
        )}, ${n(l.pourVolume)}, ${n(l.boomSize)}, ${n(l.otHours)}, ${n(l.baseAmount)}, ${
          l.operator ? operatorId.get(l.operator) : 'NULL'
        }, ${q(l.businessOwner)}, ${n(l.fuelAmount)}, ${n(l.extraAmount)}, ${l.sortOrder})`
    )
    .join(',\n') + ';'
);
L.push('');

// id 를 직접 지정해 넣어도 AUTOINCREMENT 테이블은 sqlite_sequence 가 자동으로
// 최대 rowid 로 올라가므로, 다음 채번은 알아서 이어진다 (별도 보정 불필요).

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');

const total = logs.reduce((s, l) => s + l.baseAmount + Math.trunc((l.baseAmount * l.otHours) / 10), 0);
console.log(`${OUT} 생성 완료`);
console.log(
  `  작업 ${logs.length}건 · 현장 ${siteLabels.length}개 · 거래처 ${clientNames.length}개 · 기사 ${operatorNames.length}명`
);
console.log(`  거래처 등록 ${registry.size}개 · 단가 ${rateCount}건 · 담당자 ${contactCount}명`);
console.log(`  기간 ${logs[0]?.workDate} ~ ${logs.at(-1)?.workDate} · 공급가액 합계 ${total.toLocaleString('ko-KR')}원`);
if (warnings.length) {
  console.log(`\n경고 ${warnings.length}건:`);
  for (const w of warnings) console.log(`  - ${w}`);
}
