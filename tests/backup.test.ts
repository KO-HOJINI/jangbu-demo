// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { dumpStatements, restoreStatements, splitStatements } from '../worker/backup';

/**
 * 백업을 실제로 되살려 본다.
 *
 * D1 은 SQL 한 문장이 100KB 를 넘으면 실행하지 않는다. 예전 백업은 표 하나를 INSERT 한 문장에
 * 몰아 써서, 도장 그림이 들어간 뒤로 되살릴 수 없었다. 진짜 SQLite 에 스키마를 만들고,
 * 큰 값과 많은 행을 넣어 백업 → 빈 DB 에 한 문장씩 되살리기 → 원래와 같은지 본다.
 */
const MIGRATIONS = [
  '0001_init.sql',
  '0004_quotes.sql',
  '0005_presence_drafts.sql',
  '0006_company_stamps.sql',
  '0007_ot_rounding_billing_guard.sql',
  '0008_payments.sql',
  '0009_work_log_source.sql',
  '0010_push_subscriptions.sql',
  '0011_statement_emails.sql',
  '0012_company_archived.sql',
  '0013_mail_accounts.sql',
  '0014_operator_pay.sql',
  '0015_operator_ot.sql',
];
const D1_MAX_STATEMENT_BYTES = 100_000;

function freshSchema() {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) db.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  // node 의 SQLite 는 D1 처럼 외래키를 검사한다. 이 시험은 되살리기가 관심사라 부모 자료(현장 등)를 만들지 않고 끈다.
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

/** dumpStatements 는 prepare(sql).all() 만 쓰므로 그 모양만 흉내 낸다 */
const asD1 = (db: DatabaseSync) =>
  ({
    prepare: (sql: string) => ({ all: async () => ({ results: db.prepare(sql).all() }) }),
  }) as never;

const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();

describe('백업 → 되살리기', () => {
  // 금강 도장(base64 174KB)보다 큰 그림, 따옴표가 섞인 긴 한글 주소, 한 문장에 안 들어갈 만큼 많은 행
  const stamp = Buffer.from(Array.from({ length: 180_000 }, (_, i) => (i * 7919) % 256)).toString('base64');
  const address = "서울시 샘플구 샘플로 1, 101호 (샘플타워 오피스텔) ".repeat(1600);

  const source = freshSchema();
  source.prepare('INSERT INTO companies (id, name, biz_no, address) VALUES (?, ?, ?, ?)').run(1, '한강중기', '123-45-67890', address);
  source.prepare('INSERT INTO companies (id, name, biz_no) VALUES (?, ?, ?)').run(2, '금강중기', '234-56-78901');
  source.prepare('INSERT INTO company_stamps (company_id, png) VALUES (?, ?)').run(2, stamp);
  const addOperator = source.prepare('INSERT INTO operators (name) VALUES (?)');
  for (let i = 0; i < 3000; i++) addOperator.run(`기사님-${String(i).padStart(4, '0')}-${"'".repeat(i % 3)}`);
  // 장부(계산 열 있음)와, 취소했다가 다시 발행한 명세표 — 이중 청구 트리거와 되살리기 순서가 부딪히지 않는지
  source.prepare('INSERT INTO work_logs (id, work_date, site_id, base_amount, ot_hours) VALUES (1, ?, 1, 350000, 2.3)').run('2026-08-13');
  const addStatement = source.prepare(
    `INSERT INTO statements (id, company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name, status)
     VALUES (?, 1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발', ?)`
  );
  addStatement.run(1, 'void');
  addStatement.run(2, 'issued');
  const addLine = source.prepare(
    `INSERT INTO statement_lines (statement_id, work_log_id, line_no, work_date, supply_amount, vat_amount)
     VALUES (?, 1, 1, '2026-08-13', 430500, 43050)`
  );
  addLine.run(1);
  addLine.run(2);
  // 기사님 월급·지급 기록과 야간수당도 같이 되살아나야 한다
  source.prepare('INSERT INTO operator_salaries (operator_id, from_month, amount) VALUES (1, ?, 3000000)').run('2026-06');
  source.prepare('INSERT INTO operator_pay (operator_id, month, paid_date, paid_salary) VALUES (1, ?, ?, 3000000)').run('2026-09', '2026-10-05');
  source.prepare('INSERT INTO operator_ot (operator_id, work_date, amount, note, paid_date) VALUES (1, ?, 150000, ?, NULL)').run('2026-09-12', '밤샘 타설');

  it('예전처럼 몰아 썼다면 한도를 넘는 크기다 (시험 자료가 제 몫을 하는지)', () => {
    expect(stamp.length).toBeGreaterThan(D1_MAX_STATEMENT_BYTES);
    expect(Buffer.byteLength(address)).toBeGreaterThan(D1_MAX_STATEMENT_BYTES);
  });

  it('모든 문장이 D1 한도(100KB) 안이고, 되살리면 원래와 한 글자도 다르지 않다', async () => {
    const statements = await dumpStatements(asD1(source));

    const tooBig = statements.filter((s) => Buffer.byteLength(s) > D1_MAX_STATEMENT_BYTES);
    expect(tooBig.map((s) => s.slice(0, 60))).toEqual([]);

    // 많은 행은 여러 INSERT 로 나뉘어야 한다
    expect(statements.filter((s) => s.startsWith('INSERT INTO operators')).length).toBeGreaterThan(1);
    // 긴 값은 이어 붙이기로 들어가야 한다
    expect(statements.some((s) => s.startsWith('UPDATE company_stamps SET png = png ||'))).toBe(true);
    expect(statements.some((s) => s.startsWith('UPDATE companies SET address = address ||'))).toBe(true);

    const restored = freshSchema();
    for (const statement of statements) restored.exec(statement);

    for (const table of ['companies', 'company_stamps', 'operators', 'operator_salaries', 'operator_pay', 'operator_ot', 'work_logs', 'statements', 'statement_lines']) {
      expect(rows(restored, table)).toEqual(rows(source, table));
    }
    expect((rows(restored, 'company_stamps')[0] as { png: string }).png).toBe(stamp);
  });

  it('이미 자료가 있는 DB 에 되살려도 백업 시점으로 돌아간다', async () => {
    const statements = await dumpStatements(asD1(source));
    const target = freshSchema();
    target.prepare('INSERT INTO companies (id, name, biz_no) VALUES (?, ?, ?)').run(9, '지워져야 할 회사', '000-00-00000');
    target.prepare('INSERT INTO operators (name) VALUES (?)').run('지워져야 할 기사님');

    for (const statement of statements) target.exec(statement);

    expect(rows(target, 'companies')).toEqual(rows(source, 'companies'));
    expect(rows(target, 'operators')).toEqual(rows(source, 'operators'));
  });
});

/**
 * 설정 화면의 「되돌리기」 — 백업 파일 글을 다시 문장으로 나눠 한꺼번에 실행한다.
 * 로그인 계정(users)은 건드리지 않는다: 되돌린 뒤 로그인이 막히면 안 된다.
 */
describe('화면에서 백업 되돌리기', () => {
  const tricky = "1층; 2층\n-- 주석처럼 보이는 줄 '따옴표'";

  const source = freshSchema();
  source.prepare('INSERT INTO users (id, username, name, password_hash) VALUES (1, ?, ?, ?)').run('old', '예전 계정', 'x');
  source.prepare('INSERT INTO companies (id, name, biz_no, address) VALUES (1, ?, ?, ?)').run('한강중기', '123-45-67890', tricky);
  source.prepare('INSERT INTO operators (name) VALUES (?)').run('박');

  const target = freshSchema();
  target.prepare('INSERT INTO users (id, username, name, password_hash) VALUES (7, ?, ?, ?)').run('now', '지금 계정', 'y');
  target.prepare('INSERT INTO companies (id, name, biz_no) VALUES (9, ?, ?)').run('지워져야 할 회사', '000-00-00000');

  it('글자 안의 ; 와 줄바꿈, -- 에 속지 않고 문장을 나눈다', async () => {
    const original = await dumpStatements(asD1(source));
    const parsed = splitStatements(original.join('\n') + '\n');
    expect(parsed).toEqual(original.filter((s) => !s.startsWith('--')).map((s) => s.replace(/;$/, '')));
  });

  it('장부는 백업 시점으로 돌아가고 로그인 계정은 그대로다', async () => {
    const text = (await dumpStatements(asD1(source))).join('\n') + '\n';
    const statements = restoreStatements(text);
    expect(statements.some((s) => /\busers\b/.test(s.split('\n')[0]))).toBe(false);

    for (const statement of statements) target.exec(statement);

    expect(rows(target, 'companies')).toEqual(rows(source, 'companies'));
    expect(rows(target, 'operators')).toEqual(rows(source, 'operators'));
    expect((rows(target, 'users') as { username: string }[]).map((u) => u.username)).toEqual(['now']);
  });

  it('백업 파일이 아니면 실행할 문장을 내놓지 않는다', () => {
    expect(restoreStatements('DROP TABLE work_logs;')).toEqual([]);
    expect(restoreStatements('')).toEqual([]);
  });
});
