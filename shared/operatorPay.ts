import type { Operator, OperatorOt, OperatorPay, OperatorSalary } from './types';

/**
 * 기사님 월급 규칙 — 기사님 화면과 통계가 같이 쓴다.
 *
 * 월급은 「이 달부터 얼마」로 쌓여 있어(operator_salaries), 그 달까지 정해진 것 가운데 가장 늦은 금액이 그 달의 월급이다.
 * 줬다고 표시하면(operator_pay) 그때의 월급이 같이 적혀 나중에 월급을 바꿔도 달라지지 않는다.
 * 야간수당(operator_ot)은 월급과 따로 한 건씩 적고 건마다 줬는지 표시한다. 통계에서는 일한 날의 달에 더한다.
 * 달은 모두 YYYY-MM 글자로 다룬다 (글자 그대로 견줘도 순서가 맞는다).
 */

/** 그 달 한 기사님의 월급 */
export interface PayRow {
  operatorId: number;
  name: string;
  salary: number;
  paidDate: string | null;
}

/** 통계의 한 칸 — 그 달 한 기사님께 줄 돈 (월급 + 그 달에 일한 야간수당) */
export interface PayStatRow {
  operatorId: number;
  name: string;
  salary: number;
  ot: number;
  total: number;
}

export interface PayMonth {
  month: string;
  rows: PayStatRow[];
  total: number;
  /** 아직 안 준 돈 (월급 + 야간수당) */
  unpaid: number;
}

export function salaryFor(salaries: OperatorSalary[], operatorId: number, month: string): number {
  let latest: OperatorSalary | null = null;
  for (const s of salaries) {
    if (s.operator_id !== operatorId || s.from_month > month) continue;
    if (!latest || s.from_month > latest.from_month) latest = s;
  }
  return latest?.amount ?? 0;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const at = y * 12 + (m - 1) + delta;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** 그 달 우리 기사님마다의 월급 */
export function payRows(staff: Operator[], salaries: OperatorSalary[], pays: OperatorPay[], month: string): PayRow[] {
  return staff.map((op) => {
    const pay = pays.find((p) => p.operator_id === op.id && p.month === month);
    const paidDate = pay?.paid_date ?? null;
    const salary = paidDate ? (pay?.paid_salary ?? 0) : salaryFor(salaries, op.id, month);
    return { operatorId: op.id, name: op.name, salary, paidDate };
  });
}

/**
 * 기간의 달마다 줄 돈, 늦은 달부터.
 * 월급도 야간수당도 없던 앞의 달과 이번 달보다 뒤인 달은 뺀다 — 통계의 기간을 「전체」로 골라도 빈 달이 줄줄이 나오지 않게.
 */
export function payMonths(
  staff: Operator[],
  salaries: OperatorSalary[],
  pays: OperatorPay[],
  ots: OperatorOt[],
  from: string,
  to: string,
  thisMonth: string
): PayMonth[] {
  const firsts = [...salaries.map((s) => s.from_month), ...pays.map((p) => p.month), ...ots.map((o) => o.work_date.slice(0, 7))];
  if (!firsts.length) return [];
  const start = [from, firsts.reduce((a, b) => (a < b ? a : b))].reduce((a, b) => (a > b ? a : b));
  const end = to < thisMonth ? to : thisMonth;

  return monthsBetween(start, end)
    .reverse()
    .map((month) => {
      let unpaid = 0;
      const rows: PayStatRow[] = [];
      for (const pay of payRows(staff, salaries, pays, month)) {
        const mine = ots.filter((o) => o.operator_id === pay.operatorId && o.work_date.slice(0, 7) === month);
        const ot = mine.reduce((sum, o) => sum + o.amount, 0);
        // 월급을 정하기 전이거나 그만둔 뒤(월급 0)이고 야간수당도 없는 달은 그 기사님 줄을 뺀다
        if (!pay.salary && !ot && !pay.paidDate) continue;
        unpaid += (pay.paidDate ? 0 : pay.salary) + mine.reduce((sum, o) => sum + (o.paid_date ? 0 : o.amount), 0);
        rows.push({ operatorId: pay.operatorId, name: pay.name, salary: pay.salary, ot, total: pay.salary + ot });
      }
      return { month, rows, total: rows.reduce((sum, r) => sum + r.total, 0), unpaid };
    })
    .filter((m) => m.rows.length > 0);
}

/** 우리 기사님을 목록 맨 위로 (그 안의 순서는 그대로) */
export function staffFirst<T extends { is_staff: number }>(list: T[]): T[] {
  return [...list.filter((o) => o.is_staff), ...list.filter((o) => !o.is_staff)];
}
