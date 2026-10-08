import { describe, expect, it } from 'vitest';
import { monthsBetween, payMonths, payRows, salaryFor, shiftMonth, staffFirst } from '../shared/operatorPay';

const staff = [
  { id: 1, name: '가', memo: null, archived: 0, is_staff: 1 },
  { id: 2, name: '나', memo: null, archived: 0, is_staff: 1 },
];
const salaries = [
  { id: 1, operator_id: 1, from_month: '2026-06', amount: 3_000_000 },
  { id: 2, operator_id: 1, from_month: '2026-10', amount: 3_300_000 },
  { id: 3, operator_id: 2, from_month: '2026-08', amount: 2_800_000 },
];

describe('그 달의 월급', () => {
  it('그 달까지 정해진 것 가운데 가장 늦은 금액을 쓴다', () => {
    expect(salaryFor(salaries, 1, '2026-09')).toBe(3_000_000);
    expect(salaryFor(salaries, 1, '2026-10')).toBe(3_300_000);
    expect(salaryFor(salaries, 1, '2027-01')).toBe(3_300_000);
  });

  it('월급을 정하기 전의 달은 0 이다', () => {
    expect(salaryFor(salaries, 2, '2026-07')).toBe(0);
    expect(salaryFor(salaries, 9, '2026-10')).toBe(0);
  });
});

describe('달 다루기', () => {
  it('앞뒤 달로 옮긴다 (해를 넘어도)', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('두 달 사이의 모든 달을 차례로 준다', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-11', '2026-10')).toEqual([]);
  });
});

describe('그 달 월급', () => {
  it('기사님마다 그 달의 월급과 줬는지를 낸다', () => {
    expect(payRows(staff, salaries, [], '2026-10')).toEqual([
      { operatorId: 1, name: '가', salary: 3_300_000, paidDate: null },
      { operatorId: 2, name: '나', salary: 2_800_000, paidDate: null },
    ]);
  });

  it('이미 준 달은 나중에 월급을 바꿔도 줄 때 금액 그대로다', () => {
    const pays = [{ operator_id: 1, month: '2026-09', paid_date: '2026-10-05', paid_salary: 2_900_000 }];
    expect(payRows(staff, salaries, pays, '2026-09')[0]).toMatchObject({ salary: 2_900_000, paidDate: '2026-10-05' });
  });
});

describe('기간의 달마다 줄 돈 (통계)', () => {
  const pays = [{ operator_id: 1, month: '2026-09', paid_date: '2026-10-05', paid_salary: 3_000_000 }];
  // 야간수당은 한 건씩이고, 일한 날의 달에 더한다
  const ots = [
    { id: 1, operator_id: 1, work_date: '2026-09-12', amount: 100_000, note: null, paid_date: null },
    { id: 2, operator_id: 1, work_date: '2026-09-20', amount: 50_000, note: null, paid_date: '2026-09-25' },
    { id: 3, operator_id: 2, work_date: '2026-10-02', amount: 70_000, note: null, paid_date: null },
  ];

  it('늦은 달부터, 달마다 월급과 야간수당을 더한 합계와 아직 안 준 돈을 낸다', () => {
    const months = payMonths(staff, salaries, pays, ots, '2026-09', '2026-10', '2026-10');
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09']);
    expect(months[1].rows[0]).toEqual({ operatorId: 1, name: '가', salary: 3_000_000, ot: 150_000, total: 3_150_000 });
    // 9월: 「가」는 월급을 받았고 야간수당 10만이 남음, 「나」는 월급 280만이 남음
    expect(months[1]).toMatchObject({ total: 3_150_000 + 2_800_000, unpaid: 100_000 + 2_800_000 });
    expect(months[0]).toMatchObject({ total: 3_300_000 + 2_870_000, unpaid: 3_300_000 + 2_870_000 });
  });

  it('월급을 정하기 전의 달과 아직 오지 않은 달은 뺀다', () => {
    // 기간을 「전체」(2020~2030)로 골라도 줄 돈이 있는 달만 나온다
    const months = payMonths(staff, salaries, [], [], '2020-01', '2030-12', '2026-10');
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07', '2026-06']);
    // 6·7월에는 「나」의 월급이 없어 그 줄은 빠진다
    expect(months[4].rows.map((r) => r.name)).toEqual(['가']);
  });

  it('월급을 정하지 않았어도 야간수당이 있는 달은 나온다', () => {
    const months = payMonths(staff, [], [], ots, '2026-01', '2026-12', '2026-10');
    expect(months.map((m) => [m.month, m.total, m.unpaid])).toEqual([
      ['2026-10', 70_000, 70_000],
      ['2026-09', 150_000, 100_000],
    ]);
  });

  it('월급도 야간수당도 없으면 비어 있다', () => {
    expect(payMonths(staff, [], [], [], '2026-01', '2026-12', '2026-10')).toEqual([]);
  });
});

describe('우리 기사님이 맨 위', () => {
  it('우리 기사님을 앞에 두고, 그 안에서는 원래 순서를 지킨다', () => {
    const list = [
      { id: 5, is_staff: 0 },
      { id: 1, is_staff: 1 },
      { id: 7, is_staff: 0 },
      { id: 2, is_staff: 1 },
    ];
    expect(staffFirst(list).map((o) => o.id)).toEqual([1, 2, 5, 7]);
  });
});
