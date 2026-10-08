// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { insertEmailLog } from '../worker/mail';

function fakeD1() {
  const d = new DatabaseSync(':memory:');
  d.exec(fs.readFileSync('migrations/0001_init.sql', 'utf8'));
  d.exec(fs.readFileSync('migrations/0011_statement_emails.sql', 'utf8'));
  d.exec(`
    INSERT INTO companies (id, name, biz_no) VALUES (1, '내회사', '123-45-67890');
    INSERT INTO clients (id, name) VALUES (1, '거래처');
    INSERT INTO statements (id, client_id, company_id, issue_date, period_start, period_end, supplier_name, customer_name)
    VALUES (1, 1, 1, '2026-09-30', '2026-09-01', '2026-09-30', '공급자', '받는자');
  `);
  const db = {
    prepare(sql: string) {
      const stmt = d.prepare(sql);
      const bound = (args: unknown[]) => ({
        run: async () => stmt.run(...(args as never[])),
        first: async <T>() => (stmt.get(...(args as never[])) ?? null) as T | null,
        all: async <T>() => ({ results: stmt.all(...(args as never[])) as T[] }),
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    },
  };
  return { d, db: db as unknown as D1Database };
}

describe('웹메일(네이버/mailto) 발송 기록 (insertEmailLog)', () => {
  it('네이버 메일 쓰기 창을 열었을 때 statement_emails 에 발송 상태로 정상 기록된다', async () => {
    const { d, db } = fakeD1();
    const ok = await insertEmailLog(
      db,
      1,
      ['client@example.com', 'boss@example.com'],
      '26년 9월 거래명세표'
    );

    expect(ok).toBe(true);

    const rows = d.prepare('SELECT to_addrs, subject, status FROM statement_emails WHERE statement_id = 1').all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].to_addrs).toBe('client@example.com, boss@example.com');
    expect(rows[0].subject).toBe('26년 9월 거래명세표');
    expect(rows[0].status).toBe('sent');
  });

  it('수신자가 비어 있으면 기록하지 않고 false 를 반환한다', async () => {
    const { d, db } = fakeD1();
    const ok = await insertEmailLog(db, 1, [], '빈 수신자');

    expect(ok).toBe(false);
    const rows = d.prepare('SELECT * FROM statement_emails WHERE statement_id = 1').all();
    expect(rows.length).toBe(0);
  });
});
