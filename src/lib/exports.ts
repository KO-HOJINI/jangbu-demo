import type { LedgerResponse, SiteMonthCell, WorkLogRow } from '../../shared/types';
import { timeRange } from './format';
import { downloadXlsx, type SheetSpec } from './xlsx';

/** 장부를 세무사에게 넘길 수 있는 평면 시트로 */
export function exportLedger(rows: WorkLogRow[], totals: LedgerResponse['totals'], from: string, to: string) {
  const sheet: SheetSpec = {
    name: '장부',
    header: [
      '월일',
      '현장명',
      '거래처',
      '작업 내용',
      '작업 시간',
      '타설',
      'M',
      'OT',
      'OT 금액',
      '금액',
      '공급가액',
      '세액',
      '합계',
      '기사님',
      '사업자',
      '주유',
      '기타',
      '명세표',
    ],
    widths: [11, 14, 12, 16, 14, 8, 6, 6, 12, 12, 12, 11, 13, 9, 10, 11, 10, 9],
    rows: rows.map((r) => {
      const vat = Math.round(r.supply_amount * 0.1);
      return [
        r.work_date,
        r.site_label,
        r.client_name,
        r.description,
        timeRange(r.start_time, r.end_time),
        r.pour_volume,
        r.boom_size,
        r.ot_hours || null,
        r.ot_amount || null,
        r.base_amount,
        r.supply_amount,
        vat,
        r.supply_amount + vat,
        r.operator_name,
        r.business_owner,
        r.fuel_amount,
        r.extra_amount,
        r.statement_id ? `#${r.statement_id}` : '미발행',
      ];
    }),
  };

  // 마지막에 합계 한 줄
  sheet.rows.push([]);
  sheet.rows.push([
    `합계 ${totals.count}건`,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    totals.otAmount,
    totals.baseAmount,
    totals.supplyAmount,
    totals.vatAmount,
    totals.totalAmount,
    null,
    null,
    totals.fuelAmount,
  ]);

  downloadXlsx(`장부 ${from}~${to}`, [sheet]);
}

/** 현장 × 월 크로스탭 + 현장별 요약 */
export function exportSummary(
  cells: SiteMonthCell[],
  months: string[],
  from: string,
  to: string
) {
  const bySite = new Map<number, { label: string; client: string; byMonth: Map<string, SiteMonthCell> }>();
  for (const c of cells) {
    const entry = bySite.get(c.site_id) ?? { label: c.site_label, client: c.client_name, byMonth: new Map() };
    entry.byMonth.set(c.month, c);
    bySite.set(c.site_id, entry);
  }

  const monthLabel = (m: string) => `${Number(m.split('-')[1])}월`;
  const sites = [...bySite.values()].sort(
    (a, b) =>
      [...b.byMonth.values()].reduce((s, c) => s + c.supply_amount, 0) -
      [...a.byMonth.values()].reduce((s, c) => s + c.supply_amount, 0)
  );

  const crosstab: SheetSpec = {
    name: '현장별',
    header: ['현장', '거래처', ...months.map(monthLabel), '건수', '공급가액', '세액', '합계', '미발행'],
    widths: [16, 12, ...months.map(() => 13), 7, 13, 12, 13, 13],
    rows: sites.map((s) => {
      const list = [...s.byMonth.values()];
      const supply = list.reduce((a, c) => a + c.supply_amount, 0);
      const vat = Math.round(supply * 0.1);
      return [
        s.label,
        s.client,
        ...months.map((m) => s.byMonth.get(m)?.supply_amount ?? null),
        list.reduce((a, c) => a + c.count, 0),
        supply,
        vat,
        supply + vat,
        list.reduce((a, c) => a + c.unbilled_amount, 0) || null,
      ];
    }),
  };

  const totalSupply = cells.reduce((a, c) => a + c.supply_amount, 0);
  crosstab.rows.push([]);
  crosstab.rows.push([
    '합계',
    null,
    ...months.map((m) =>
      cells.filter((c) => c.month === m).reduce((a, c) => a + c.supply_amount, 0)
    ),
    cells.reduce((a, c) => a + c.count, 0),
    totalSupply,
    Math.round(totalSupply * 0.1),
    totalSupply + Math.round(totalSupply * 0.1),
    cells.reduce((a, c) => a + c.unbilled_amount, 0),
  ]);

  // 월별로 한 줄씩 — 엑셀에서 피벗을 돌릴 때 쓰기 좋다
  const flat: SheetSpec = {
    name: '현장×월',
    header: ['현장', '거래처', '월', '건수', '공급가액', '미발행 금액', '미발행 건수'],
    widths: [16, 12, 10, 7, 13, 13, 11],
    rows: cells.map((c) => [
      c.site_label,
      c.client_name,
      c.month,
      c.count,
      c.supply_amount,
      c.unbilled_amount || null,
      c.unbilled_count || null,
    ]),
  };

  downloadXlsx(`현장별 ${from}~${to}`, [crosstab, flat]);
}
