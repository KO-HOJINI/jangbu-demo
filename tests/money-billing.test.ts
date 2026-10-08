// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { REISSUE_CONFLICT_SQL } from '../worker/reissue';
import { DOC_STATUS_SQL, UNPAID_LINE_AMOUNT, UNPAID_TOTAL_SQL } from '../worker/unpaid';

/**
 * 돈 계산과 이중 청구 막기 — 실제 SQLite 에 마이그레이션을 그대로 올려서 확인한다.
 * (계산 열과 트리거는 DB 안에 있어서, 흉내 낸 코드로는 확인할 수 없다)
 */
const MIGRATIONS = [
  '0001_init.sql',
  '0004_quotes.sql',
  '0005_presence_drafts.sql',
  '0006_company_stamps.sql',
  '0007_ot_rounding_billing_guard.sql',
  '0008_payments.sql',
];

function db() {
  const d = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) d.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  // node 의 SQLite 는 D1 처럼 외래키를 검사한다. 이 시험은 계산 열·트리거가 관심사라 부모 자료를 만들지 않고 끈다.
  d.exec('PRAGMA foreign_keys = OFF');
  return d;
}

describe('OT금액 = 금액 × 0.1 × OT시간 (원 단위 반올림)', () => {
  const d = db();
  const add = d.prepare('INSERT INTO work_logs (work_date, site_id, base_amount, ot_hours) VALUES (?, 1, ?, ?) RETURNING ot_amount, supply_amount');

  it.each([
    // 컴퓨터 계산으로 80,499.999… 가 되어 예전에는 1원이 모자랐던 값들
    [350_000, 2.3, 80_500],
    [700_000, 0.7, 49_000],
    // 원래 맞던 값들은 그대로
    [1_400_000, 1.5, 210_000],
    [1_200_000, 1, 120_000],
    [1_400_000, 3, 420_000],
    [1_000_000, 0, 0],
    // 원 아래가 생기면 반올림
    [1_234_567, 0.5, 61_728],
  ])('%i원 × %s시간 → OT %i원', (base, hours, ot) => {
    const row = add.get('2026-09-01', base, hours) as { ot_amount: number; supply_amount: number };
    expect(row.ot_amount).toBe(ot);
    expect(row.supply_amount).toBe(base + ot);
  });
});

describe('같은 작업을 명세표 두 장에 넣지 못한다', () => {
  const setup = () => {
    const d = db();
    d.prepare('INSERT INTO work_logs (id, work_date, site_id, base_amount) VALUES (1, ?, 1, 1400000)').run('2026-08-13');
    const statement = d.prepare(
      `INSERT INTO statements (company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name, status)
       VALUES (1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발', ?) RETURNING id`
    );
    const line = d.prepare(
      `INSERT INTO statement_lines (statement_id, work_log_id, line_no, work_date, supply_amount, vat_amount)
       VALUES (?, ?, 1, '2026-08-13', 1400000, 140000)`
    );
    const newStatement = (status = 'issued') => (statement.get(status) as { id: number }).id;
    return { d, newStatement, addLine: (sid: number, workLogId: number | null = 1) => line.run(sid, workLogId) };
  };

  it('이미 발행된 작업을 다른 명세표에 넣으면 DB 가 거부한다', () => {
    const { newStatement, addLine } = setup();
    addLine(newStatement());
    expect(() => addLine(newStatement())).toThrow(/ALREADY_BILLED/);
  });

  it('앞 명세표를 취소하면 다시 발행할 수 있다', () => {
    const { d, newStatement, addLine } = setup();
    const first = newStatement();
    addLine(first);
    d.prepare("UPDATE statements SET status = 'void' WHERE id = ?").run(first);
    expect(() => addLine(newStatement())).not.toThrow();
  });

  it('취소한 명세표를 되살릴 때: 그 사이 다른 명세표에 담긴 작업을 찾아낸다', () => {
    const { d, newStatement, addLine } = setup();
    const first = newStatement();
    addLine(first);
    d.prepare("UPDATE statements SET status = 'void' WHERE id = ?").run(first);
    const conflicts = (id: number) => d.prepare(REISSUE_CONFLICT_SQL).all(id) as { work_date: string; statement_id: number }[];
    // 아직 아무 데도 안 담겼으면 되살려도 된다
    expect(conflicts(first)).toEqual([]);

    const second = newStatement();
    addLine(second);
    expect(conflicts(first)).toEqual([{ work_date: '2026-08-13', statement_id: second }]);

    // 뒤의 것도 취소하면 다시 되살릴 수 있다
    d.prepare("UPDATE statements SET status = 'void' WHERE id = ?").run(second);
    expect(conflicts(first)).toEqual([]);
  });

  it('손으로 추가한 줄(장부와 연결 없음)은 상관없다', () => {
    const { newStatement, addLine } = setup();
    const sid = newStatement();
    addLine(sid, null);
    expect(() => addLine(newStatement(), null)).not.toThrow();
  });

  it('취소된 명세표에 넣는 것은 막지 않는다 (백업 되살리기 순서)', () => {
    const { newStatement, addLine } = setup();
    addLine(newStatement());
    expect(() => addLine(newStatement('void'))).not.toThrow();
  });

  it('거부되면 그 묶음 전체가 취소된다 — 빈 명세표가 남지 않는다', () => {
    const { d, newStatement, addLine } = setup();
    addLine(newStatement());
    const before = (d.prepare('SELECT COUNT(*) AS n FROM statements').get() as { n: number }).n;
    d.exec('BEGIN');
    try {
      addLine(newStatement());
      d.exec('COMMIT');
    } catch {
      d.exec('ROLLBACK');
    }
    expect((d.prepare('SELECT COUNT(*) AS n FROM statements').get() as { n: number }).n).toBe(before);
  });
});

describe('명세표 입금(수금) 및 미수금 관리', () => {
  it('새 명세표는 기본적으로 paid_at이 NULL(미수금)이다', () => {
    const d = db();
    const row = d.prepare(
      `INSERT INTO statements (company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name)
       VALUES (1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발') RETURNING *`
    ).get() as { paid_at: string | null; paid_amount: number | null };
    expect(row.paid_at).toBeNull();
    expect(row.paid_amount).toBeNull();
  });

  it('입금 처리 시 paid_at, paid_amount, paid_memo가 정상 기록된다', () => {
    const d = db();
    const created = d.prepare(
      `INSERT INTO statements (company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name)
       VALUES (1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발') RETURNING id`
    ).get() as { id: number };

    d.prepare('UPDATE statements SET paid_at = ?, paid_amount = ?, paid_memo = ? WHERE id = ?')
      .run('2026-09-20', 15400000, '국민은행 입금', created.id);

    const updated = d.prepare('SELECT paid_at, paid_amount, paid_memo FROM statements WHERE id = ?')
      .get(created.id) as { paid_at: string; paid_amount: number; paid_memo: string };

    expect(updated.paid_at).toBe('2026-09-20');
    expect(updated.paid_amount).toBe(15400000);
    expect(updated.paid_memo).toBe('국민은행 입금');
  });

  it('입금 취소 시 paid_at이 다시 NULL이 된다', () => {
    const d = db();
    const created = d.prepare(
      `INSERT INTO statements (company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name, paid_at, paid_amount)
       VALUES (1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발', '2026-09-20', 15400000) RETURNING id`
    ).get() as { id: number };

    d.prepare('UPDATE statements SET paid_at = NULL, paid_amount = NULL, paid_memo = NULL WHERE id = ?')
      .run(created.id);

    const updated = d.prepare('SELECT paid_at FROM statements WHERE id = ?').get(created.id) as { paid_at: string | null };
    expect(updated.paid_at).toBeNull();
  });
});


describe('미수금은 명세표에 찍힌 금액으로 센다', () => {
  /** 장부 두 줄(140만·120만)을 담은 미입금 명세표 — 한 줄은 명세표에서 100만으로 고쳤고, 손으로 적은 줄 50만이 하나 더 있다 */
  function unpaidStatement() {
    const d = db();
    d.exec("INSERT INTO sites (id, client_id, name, label) VALUES (1, 1, '광장', '아라(광장)')");
    d.exec(
      "INSERT INTO work_logs (id, work_date, site_id, base_amount) VALUES (1, '2026-08-01', 1, 1400000), (2, '2026-08-02', 1, 1200000), (3, '2026-08-03', 1, 900000)"
    );
    d.exec(
      `INSERT INTO statements (id, company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name)
       VALUES (1, 1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발')`
    );
    d.exec(
      `INSERT INTO statement_lines (statement_id, work_log_id, line_no, work_date, supply_amount, vat_amount, edited) VALUES
         (1, 1, 1, '2026-08-01', 1400000, 140000, 0),
         (1, 2, 2, '2026-08-02', 1000000, 100000, 1),
         (1, NULL, 3, '2026-08-20', 500000, 50000, 1)`
    );
    return d;
  }
  const total = (d: DatabaseSync, from = '2026-08-01', to = '2026-08-31') =>
    (d.prepare(UNPAID_TOTAL_SQL).get(from, to) as { amount: number }).amount;
  const bySite = (d: DatabaseSync) =>
    (d.prepare(`SELECT SUM(${UNPAID_LINE_AMOUNT}) AS amount FROM work_logs w WHERE w.site_id = 1`).get() as { amount: number }).amount;

  it('대시보드: 고친 금액과 손으로 적은 줄까지 더한다 (140만 + 100만 + 50만)', () => {
    expect(total(unpaidStatement())).toBe(2_900_000);
  });

  it('현장별: 그 현장 장부 줄이 명세표에 찍힌 금액으로 센다 (140만 + 100만, 안 담긴 줄은 0)', () => {
    expect(bySite(unpaidStatement())).toBe(2_400_000);
  });

  it('입금했거나 취소한 명세표는 세지 않고, 기간 밖의 줄도 뺀다', () => {
    const paid = unpaidStatement();
    paid.exec("UPDATE statements SET paid_at = '2026-09-20' WHERE id = 1");
    expect([total(paid), bySite(paid)]).toEqual([0, 0]);

    const voided = unpaidStatement();
    voided.exec("UPDATE statements SET status = 'void' WHERE id = 1");
    expect([total(voided), bySite(voided)]).toEqual([0, 0]);

    expect(total(unpaidStatement(), '2026-08-01', '2026-08-10')).toBe(2_400_000);
  });
});

describe('취소한 명세표·견적서의 줄은 고치지 못한다', () => {
  it('발행된 것만 고칠 수 있다고 답한다', () => {
    const d = db();
    d.exec(
      `INSERT INTO statements (id, company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name, status)
       VALUES (1, 1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발', 'issued'),
              (2, 1, 1, '2026-08-31', '2026-08-01', '2026-08-31', '한강중기', '아라개발', 'void')`
    );
    const editable = (id: number) => d.prepare(DOC_STATUS_SQL('statements')).get(id) as { status: string } | undefined;
    expect(editable(1)?.status).toBe('issued');
    expect(editable(2)?.status).toBe('void');
    expect(editable(3)).toBeUndefined();
  });
});
