import { Hono } from 'hono';
import type {
  DashboardBoomStat,
  DashboardClientStat,
  DashboardKpi,
  DashboardMonthStat,
  DashboardOperatorStat,
  DashboardOwnerStat,
  DashboardResponse,
} from '../../shared/types';
import type { AppEnv } from '../types';
import { ALERT_FROM } from '../../shared/issueDue';
import { UNPAID_BY_CLIENT_SQL, UNPAID_TOTAL_SQL } from '../unpaid';

const dashboard = new Hono<AppEnv>();

/** 장부 한 줄(w)이 취소하지 않은 명세표에 담겼는가 */
const ISSUED = `(SELECT 1 FROM statement_lines sl
                   JOIN statements st ON st.id = sl.statement_id AND st.status <> 'void'
                  WHERE sl.work_log_id = w.id LIMIT 1)`;

/**
 * 장부 한 줄(w)의 미발행 금액. 명세표에 안 담긴 줄만 세되, ALERT_FROM 앞의 장부는 뺀다
 * — 엑셀에서 옮겨 온 2026년 6~8월은 명세표를 이미 엑셀·종이로 냈다 (아침 알림과 같은 기준).
 * 빼지 않으면 「올해 전체」에서 매출 전부가 미발행으로 보인다.
 */
export const UNBILLED_AMOUNT = `CASE WHEN ${ISSUED} IS NULL AND w.work_date >= '${ALERT_FROM}' THEN w.supply_amount ELSE 0 END`;

/** 기간(? ~ ?) 안의 거래처별 작업 건수·매출·미발행 금액. 많이 번 곳부터 */
export const CLIENT_STATS_SQL = `
  SELECT c.id                              AS client_id,
         c.name                            AS name,
         COUNT(*)                          AS count,
         COALESCE(SUM(w.supply_amount), 0) AS supply_amount,
         COALESCE(SUM(${UNBILLED_AMOUNT}), 0) AS unbilled_amount
    FROM work_logs w
    JOIN sites s   ON s.id = w.site_id
    JOIN clients c ON c.id = s.client_id
   WHERE w.work_date >= ? AND w.work_date <= ?
   GROUP BY c.id
   ORDER BY supply_amount DESC, count DESC`;

/** 거래처별 매출에 못 받은 돈을 붙인다. 그 기간에 작업은 없고 받을 돈만 남은 거래처도 뒤에 넣는다 */
export function mergeClientStats(
  rows: { client_id: number; name: string; count: number; supply_amount: number; unbilled_amount: number }[],
  unpaid: { client_id: number; name: string; amount: number }[]
): DashboardClientStat[] {
  const owed = new Map(unpaid.map((u) => [u.client_id, u.amount]));
  const seen = new Set(rows.map((r) => r.client_id));
  return [
    ...rows.map((r) => ({
      clientId: r.client_id,
      name: r.name,
      count: r.count,
      supplyAmount: r.supply_amount,
      unbilledAmount: r.unbilled_amount,
      unpaidAmount: owed.get(r.client_id) ?? 0,
    })),
    ...unpaid
      .filter((u) => !seen.has(u.client_id) && u.amount > 0)
      .map((u) => ({ clientId: u.client_id, name: u.name, count: 0, supplyAmount: 0, unbilledAmount: 0, unpaidAmount: u.amount })),
  ];
}

dashboard.get('/dashboard', async (c) => {
  const { from, to } = c.req.query();

  const where = ['w.work_date >= ?', 'w.work_date <= ?'];
  const params: unknown[] = [from ?? '0000-01-01', to ?? '9999-12-31'];

  // 1. 전체 KPI 집계
  const kpiPromise = c.env.DB.prepare(
    `SELECT
       COUNT(*)                                                         AS workCount,
       COALESCE(SUM(w.supply_amount), 0)                                AS supplyAmount,
       COALESCE(SUM(w.base_amount), 0)                                  AS baseAmount,
       COALESCE(SUM(w.ot_amount), 0)                                    AS otAmount,
       COALESCE(SUM(w.fuel_amount), 0)                                  AS fuelAmount,
       COALESCE(SUM(w.extra_amount), 0)                                 AS extraAmount,
       COALESCE(SUM(w.pour_volume), 0)                                  AS pourVolume,
       COALESCE(SUM(w.ot_hours), 0)                                     AS otHours,
       COALESCE(SUM(${UNBILLED_AMOUNT}), 0)                             AS unbilledAmount
     FROM work_logs w
     WHERE ${where.join(' AND ')}`
  )
    .bind(...params)
    .first<Omit<DashboardKpi, 'netAmount' | 'unpaidAmount'>>();

  // 미수금은 명세표에 찍힌 금액으로 센다 — 손으로 적은 줄과 「직접 입력」 명세표까지 (worker/unpaid.ts)
  const unpaidPromise = c.env.DB.prepare(UNPAID_TOTAL_SQL)
    .bind(...params)
    .first<{ amount: number }>();

  // 2. 차량 규격(붐길이 M)별 통계
  const boomPromise = c.env.DB.prepare(
    `SELECT
       w.boom_size,
       COUNT(*)                          AS count,
       COALESCE(SUM(w.supply_amount), 0) AS supply_amount,
       COALESCE(SUM(w.fuel_amount), 0)   AS fuel_amount,
       COALESCE(SUM(w.pour_volume), 0)   AS pour_volume,
       COALESCE(SUM(w.ot_hours), 0)      AS ot_hours
     FROM work_logs w
     WHERE ${where.join(' AND ')}
     GROUP BY w.boom_size
     ORDER BY (CASE WHEN w.boom_size IS NULL THEN 999 ELSE w.boom_size END) ASC`
  )
    .bind(...params)
    .all<{
      boom_size: number | null;
      count: number;
      supply_amount: number;
      fuel_amount: number;
      pour_volume: number;
      ot_hours: number;
    }>();

  // 3. 기사님별 통계
  const operatorPromise = c.env.DB.prepare(
    `SELECT
       w.operator_id,
       COALESCE(op.name, '미지정')        AS operator_name,
       COALESCE(op.is_staff, 0)          AS is_staff,
       COUNT(*)                          AS count,
       COALESCE(SUM(w.supply_amount), 0) AS supply_amount,
       COALESCE(SUM(w.fuel_amount), 0)   AS fuel_amount,
       COALESCE(SUM(w.extra_amount), 0)  AS extra_amount,
       COALESCE(SUM(w.pour_volume), 0)   AS pour_volume,
       COALESCE(SUM(w.ot_hours), 0)      AS ot_hours
     FROM work_logs w
     LEFT JOIN operators op ON op.id = w.operator_id
     WHERE ${where.join(' AND ')}
     GROUP BY w.operator_id
     ORDER BY is_staff DESC, supply_amount DESC, count DESC`
  )
    .bind(...params)
    .all<{
      operator_id: number | null;
      operator_name: string;
      is_staff: number;
      count: number;
      supply_amount: number;
      fuel_amount: number;
      extra_amount: number;
      pour_volume: number;
      ot_hours: number;
    }>();

  // 4. 월별 추이 (전체 데이터 또는 기간 내)
  const monthPromise = c.env.DB.prepare(
    `SELECT
       substr(w.work_date, 1, 7)         AS month,
       COUNT(*)                          AS count,
       COALESCE(SUM(w.supply_amount), 0) AS supply_amount,
       COALESCE(SUM(w.fuel_amount), 0)   AS fuel_amount,
       COALESCE(SUM(w.extra_amount), 0)  AS extra_amount,
       COALESCE(SUM(w.pour_volume), 0)   AS pour_volume
     FROM work_logs w
     WHERE ${where.join(' AND ')}
     GROUP BY month
     ORDER BY month ASC`
  )
    .bind(...params)
    .all<{
      month: string;
      count: number;
      supply_amount: number;
      fuel_amount: number;
      extra_amount: number;
      pour_volume: number;
    }>();

  // 5. 사업자별 통계 (한강중기/금강중기 등)
  const ownerPromise = c.env.DB.prepare(
    `SELECT
       COALESCE(NULLIF(TRIM(w.business_owner), ''), '미지정') AS owner,
       COUNT(*)                          AS count,
       COALESCE(SUM(w.supply_amount), 0) AS supply_amount,
       COALESCE(SUM(w.fuel_amount), 0)   AS fuel_amount
     FROM work_logs w
     WHERE ${where.join(' AND ')}
     GROUP BY owner
     ORDER BY supply_amount DESC`
  )
    .bind(...params)
    .all<{
      owner: string;
      count: number;
      supply_amount: number;
      fuel_amount: number;
    }>();

  // 6. 거래처별 매출과 받을 돈
  const clientPromise = c.env.DB.prepare(CLIENT_STATS_SQL)
    .bind(...params)
    .all<{ client_id: number; name: string; count: number; supply_amount: number; unbilled_amount: number }>();
  const clientUnpaidPromise = c.env.DB.prepare(UNPAID_BY_CLIENT_SQL)
    .bind(...params)
    .all<{ client_id: number; name: string; amount: number }>();

  const [rawKpi, rawUnpaid, rawBoom, rawOperator, rawMonth, rawOwner, rawClient, rawClientUnpaid] = await Promise.all([
    kpiPromise,
    unpaidPromise,
    boomPromise,
    operatorPromise,
    monthPromise,
    ownerPromise,
    clientPromise,
    clientUnpaidPromise,
  ]);

  const kpiData = rawKpi ?? {
    workCount: 0,
    supplyAmount: 0,
    baseAmount: 0,
    otAmount: 0,
    fuelAmount: 0,
    extraAmount: 0,
    pourVolume: 0,
    otHours: 0,
    unbilledAmount: 0,
  };

  const kpi: DashboardKpi = {
    ...kpiData,
    unpaidAmount: rawUnpaid?.amount ?? 0,
    netAmount: kpiData.supplyAmount - kpiData.fuelAmount - kpiData.extraAmount,
  };

  const byBoomSize: DashboardBoomStat[] = rawBoom.results.map((r) => {
    const supply = r.supply_amount;
    const fuel = r.fuel_amount;
    const count = r.count;
    return {
      boomSize: r.boom_size,
      label: r.boom_size ? `${r.boom_size}M` : '미지정',
      count,
      supplyAmount: supply,
      fuelAmount: fuel,
      pourVolume: Math.round(r.pour_volume * 10) / 10,
      otHours: Math.round(r.ot_hours * 10) / 10,
      avgSupply: count > 0 ? Math.round(supply / count) : 0,
      fuelRatio: supply > 0 ? Math.round((fuel / supply) * 1000) / 10 : 0,
    };
  });

  const byOperator: DashboardOperatorStat[] = rawOperator.results.map((r) => {
    const supply = r.supply_amount;
    const fuel = r.fuel_amount;
    const extra = r.extra_amount;
    const count = r.count;
    return {
      operatorId: r.operator_id,
      operatorName: r.operator_name,
      isStaff: r.is_staff === 1,
      count,
      supplyAmount: supply,
      fuelAmount: fuel,
      extraAmount: extra,
      pourVolume: Math.round(r.pour_volume * 10) / 10,
      otHours: Math.round(r.ot_hours * 10) / 10,
      avgSupply: count > 0 ? Math.round(supply / count) : 0,
      fuelRatio: supply > 0 ? Math.round((fuel / supply) * 1000) / 10 : 0,
    };
  });

  const byMonth: DashboardMonthStat[] = rawMonth.results.map((r) => ({
    month: r.month,
    count: r.count,
    supplyAmount: r.supply_amount,
    fuelAmount: r.fuel_amount,
    netAmount: r.supply_amount - r.fuel_amount - r.extra_amount,
    pourVolume: Math.round(r.pour_volume * 10) / 10,
  }));

  const byOwner: DashboardOwnerStat[] = rawOwner.results.map((r) => ({
    owner: r.owner,
    count: r.count,
    supplyAmount: r.supply_amount,
    fuelAmount: r.fuel_amount,
  }));

  const body: DashboardResponse = {
    period: {
      from: from ?? '전체',
      to: to ?? '전체',
    },
    kpi,
    byBoomSize,
    byOperator,
    byMonth,
    byOwner,
    byClient: mergeClientStats(rawClient.results, rawClientUnpaid.results),
  };

  return c.json(body);
});

export default dashboard;
