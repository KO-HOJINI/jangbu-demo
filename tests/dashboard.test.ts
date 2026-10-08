// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CLIENT_STATS_SQL, mergeClientStats, UNBILLED_AMOUNT } from '../worker/routes/dashboard';
import { UNPAID_BY_CLIENT_SQL } from '../worker/unpaid';

const MIGRATIONS = [
  '0001_init.sql',
  '0004_quotes.sql',
  '0005_presence_drafts.sql',
  '0006_company_stamps.sql',
  '0007_ot_rounding_billing_guard.sql',
  '0008_payments.sql',
];

function setupTestDb() {
  const d = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) d.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  d.exec('PRAGMA foreign_keys = OFF');

  // 기사님
  d.exec("INSERT INTO operators (id, name) VALUES (1, '김기사'), (2, '이기사')");
  // 현장
  d.exec("INSERT INTO sites (id, client_id, name, label) VALUES (1, 1, '광장', '아라(광장)')");

  // 작업 내역 추가:
  // 1: 42M, 김기사, 공급가액 1,400,000, 주유 300,000, 타설 100, OT 0
  d.exec(
    "INSERT INTO work_logs (work_date, site_id, boom_size, operator_id, base_amount, ot_hours, fuel_amount, pour_volume, business_owner) " +
    "VALUES ('2026-08-01', 1, 42, 1, 1400000, 0, 300000, 100, '한강중기')"
  );
  // 2: 42M, 이기사, 공급가액 1,400,000 + OT 140,000 = 1,540,000, 주유 200,000, 타설 150, OT 1
  d.exec(
    "INSERT INTO work_logs (work_date, site_id, boom_size, operator_id, base_amount, ot_hours, fuel_amount, pour_volume, business_owner) " +
    "VALUES ('2026-08-02', 1, 42, 2, 1400000, 1, 200000, 150, '금강중기')"
  );
  // 3: 32M, 김기사, 공급가액 1,000,000, 주유 150,000, 타설 50, OT 0
  d.exec(
    "INSERT INTO work_logs (work_date, site_id, boom_size, operator_id, base_amount, ot_hours, fuel_amount, pour_volume, business_owner) " +
    "VALUES ('2026-09-01', 1, 32, 1, 1000000, 0, 150000, 50, '한강중기')"
  );

  return d;
}

describe('대시보드 통계 집계', () => {
  const d = setupTestDb();

  it('전체 KPI가 올바르게 합산된다', () => {
    const kpi = d.prepare(`
      SELECT
        COUNT(*) AS workCount,
        SUM(supply_amount) AS supplyAmount,
        SUM(fuel_amount) AS fuelAmount,
        SUM(pour_volume) AS pourVolume,
        SUM(ot_hours) AS otHours
      FROM work_logs
    `).get() as { workCount: number; supplyAmount: number; fuelAmount: number; pourVolume: number; otHours: number };

    expect(kpi.workCount).toBe(3);
    // 140만 + 154만 + 100만 = 394만
    expect(kpi.supplyAmount).toBe(3_940_000);
    // 30만 + 20만 + 15만 = 65만
    expect(kpi.fuelAmount).toBe(650_000);
    // 100 + 150 + 50 = 300
    expect(kpi.pourVolume).toBe(300);
    expect(kpi.otHours).toBe(1);
  });

  it('차량 규격(Boom M)별로 올바르게 그룹화된다', () => {
    const rows = d.prepare(`
      SELECT boom_size, COUNT(*) AS count, SUM(supply_amount) AS supply_amount
      FROM work_logs
      GROUP BY boom_size
      ORDER BY boom_size ASC
    `).all() as { boom_size: number; count: number; supply_amount: number }[];

    expect(rows).toHaveLength(2);
    expect(rows[0].boom_size).toBe(32);
    expect(rows[0].count).toBe(1);
    expect(rows[0].supply_amount).toBe(1_000_000);

    expect(rows[1].boom_size).toBe(42);
    expect(rows[1].count).toBe(2);
    expect(rows[1].supply_amount).toBe(2_940_000);
  });

  it('기사님별로 올바르게 그룹화된다', () => {
    const rows = d.prepare(`
      SELECT op.name AS operator_name, COUNT(*) AS count, SUM(w.supply_amount) AS supply_amount
      FROM work_logs w
      JOIN operators op ON op.id = w.operator_id
      GROUP BY w.operator_id
      ORDER BY supply_amount DESC
    `).all() as { operator_name: string; count: number; supply_amount: number }[];

    expect(rows).toHaveLength(2);
    // 김기사: 140만 + 100만 = 240만 (2건)
    expect(rows[0].operator_name).toBe('김기사');
    expect(rows[0].count).toBe(2);
    expect(rows[0].supply_amount).toBe(2_400_000);

    // 이기사: 154만 (1건)
    expect(rows[1].operator_name).toBe('이기사');
    expect(rows[1].count).toBe(1);
    expect(rows[1].supply_amount).toBe(1_540_000);
  });

  it('월별로 올바르게 그룹화된다', () => {
    const rows = d.prepare(`
      SELECT substr(work_date, 1, 7) AS month, COUNT(*) AS count, SUM(supply_amount) AS supply_amount
      FROM work_logs
      GROUP BY month
      ORDER BY month ASC
    `).all() as { month: string; count: number; supply_amount: number }[];

    expect(rows).toHaveLength(2);
    expect(rows[0].month).toBe('2026-08');
    expect(rows[0].count).toBe(2);
    expect(rows[0].supply_amount).toBe(2_940_000);

    expect(rows[1].month).toBe('2026-09');
    expect(rows[1].count).toBe(1);
    expect(rows[1].supply_amount).toBe(1_000_000);
  });
});

describe('미발행 금액과 거래처별 받을 돈', () => {
  const d = setupTestDb();
  d.exec("INSERT INTO clients (id, name) VALUES (1, '아라'), (2, '나래'), (3, '새봄')");
  d.exec("INSERT INTO sites (id, client_id, name, label) VALUES (2, 2, '한강', '나래(한강)')");
  // 나래: 9월 2건 (하나는 발행했고 아직 못 받음, 하나는 미발행)
  d.exec(
    "INSERT INTO work_logs (id, work_date, site_id, boom_size, operator_id, base_amount) VALUES " +
      "(10, '2026-09-10', 2, 42, 1, 1500000), (11, '2026-09-20', 2, 42, 1, 700000)"
  );
  d.exec(
    "INSERT INTO statements (id, company_id, client_id, site_id, issue_date, period_start, period_end, supplier_name, customer_name) VALUES " +
      "(1, 1, 2, 2, '2026-09-25', '2026-08-26', '2026-09-25', '한강중기', '나래'), " +
      // 새봄: 이 기간에 작업은 없고, 손으로 적은 줄만 있는 못 받은 명세표
      "(2, 1, 3, NULL, '2026-09-25', '2026-08-26', '2026-09-25', '한강중기', '새봄')"
  );
  d.exec(
    "INSERT INTO statement_lines (statement_id, work_log_id, line_no, work_date, supply_amount, vat_amount) VALUES " +
      "(1, 10, 1, '2026-09-10', 1600000, 160000), (2, NULL, 1, '2026-09-12', 300000, 30000)"
  );
  const range = ['2026-01-01', '2026-12-31'];

  it('엑셀로 이미 낸 옛 장부(9월 1일 앞)는 미발행으로 세지 않는다', () => {
    const row = d.prepare(`SELECT SUM(${UNBILLED_AMOUNT}) AS amount FROM work_logs w`).get() as { amount: number };
    // 8월 두 건(294만)은 빼고, 9월의 아라 100만 + 나래 70만
    expect(row.amount).toBe(1_700_000);
  });

  it('거래처별로 매출·미발행·받을 돈을 모은다 (많이 번 곳부터)', () => {
    const rows = d.prepare(CLIENT_STATS_SQL).all(...range) as Parameters<typeof mergeClientStats>[0];
    const unpaid = d.prepare(UNPAID_BY_CLIENT_SQL).all(...range) as Parameters<typeof mergeClientStats>[1];
    expect(mergeClientStats(rows, unpaid)).toEqual([
      { clientId: 1, name: '아라', count: 3, supplyAmount: 3_940_000, unbilledAmount: 1_000_000, unpaidAmount: 0 },
      // 받을 돈은 명세표에 찍힌 금액(160만)으로 센다 — 장부 금액(150만)이 아니다
      { clientId: 2, name: '나래', count: 2, supplyAmount: 2_200_000, unbilledAmount: 700_000, unpaidAmount: 1_600_000 },
      // 작업은 없어도 받을 돈이 남은 거래처는 뒤에 넣는다
      { clientId: 3, name: '새봄', count: 0, supplyAmount: 0, unbilledAmount: 0, unpaidAmount: 300_000 },
    ]);
  });

  it('입금 처리한 명세표는 받을 돈에서 빠진다', () => {
    d.exec("UPDATE statements SET paid_at = '2026-10-01' WHERE id = 1");
    const unpaid = d.prepare(UNPAID_BY_CLIENT_SQL).all(...range) as { client_id: number; amount: number }[];
    expect(unpaid.map((u) => [u.client_id, u.amount])).toEqual([[3, 300_000]]);
  });
});
