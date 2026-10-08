import { describe, expect, it } from 'vitest';
import {
  billingPeriod,
  collectOverdue,
  currentBillingPeriod,
  duePeriod,
  overdueTitle,
  shiftBillingPeriod,
} from '../shared/issueDue';

const s25 = { issue_day: '25일', closing_day: '25일' };

describe('가장 최근 발행일과 그때 담을 작업의 마지막 날', () => {
  it('발행일 당일부터 이번 달 발행일이다 (「발행일이 되었는데」)', () => {
    expect(duePeriod(s25, '2026-09-25')).toEqual({ issueDate: '2026-09-25', cutoff: '2026-09-25' });
  });

  it('발행일 전날까지는 지난달 발행일이 가장 최근이다', () => {
    expect(duePeriod(s25, '2026-09-24')).toEqual({ issueDate: '2026-08-25', cutoff: '2026-08-25' });
  });

  it('발행일이 적혀 있지 않으면 25일로 본다 (현장별 화면과 같다)', () => {
    expect(duePeriod({ issue_day: null, closing_day: null }, '2026-09-29').issueDate).toBe('2026-09-25');
  });

  it('마감이 발행보다 뒤 날짜면 지난달 마감분이다 (마감 말일 · 발행 5일)', () => {
    expect(duePeriod({ issue_day: '5일', closing_day: '말일' }, '2026-09-10')).toEqual({
      issueDate: '2026-09-05',
      cutoff: '2026-08-31',
    });
  });

  it('1월 초에는 작년 12월 발행일로 넘어간다', () => {
    expect(duePeriod(s25, '2027-01-03')).toEqual({ issueDate: '2026-12-25', cutoff: '2026-12-25' });
  });

  it('없는 날짜(2월 30일)는 그 달 말일로', () => {
    expect(duePeriod({ issue_day: '30일', closing_day: null }, '2027-03-01').issueDate).toBe('2027-02-28');
  });
});

describe('명세표에 담는 한 달 (발행일 기준)', () => {
  it('발행일이 25일이면 지난달 26일부터 이번 달 25일까지', () => {
    expect(billingPeriod(s25, 2026, 10)).toEqual(['2026-09-26', '2026-10-25']);
  });

  it('발행일이 적혀 있지 않거나 현장을 안 골랐으면 25일로 본다', () => {
    expect(billingPeriod({ issue_day: null, closing_day: null }, 2026, 10)).toEqual(['2026-09-26', '2026-10-25']);
    expect(billingPeriod(null, 2026, 10)).toEqual(['2026-09-26', '2026-10-25']);
  });

  it('발행일이 다르면 그 날에 맞춘 한 달', () => {
    expect(billingPeriod({ issue_day: '10일', closing_day: null }, 2026, 10)).toEqual(['2026-09-11', '2026-10-10']);
  });

  it('말일 발행이면 그 달 1일부터 말일까지', () => {
    expect(billingPeriod({ issue_day: '말일', closing_day: null }, 2026, 2)).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('마감일이 따로 적혀 있으면 마감일까지 담는다 (마감 말일 · 발행 5일은 지난달 치)', () => {
    expect(billingPeriod({ issue_day: '5일', closing_day: '말일' }, 2026, 10)).toEqual(['2026-09-01', '2026-09-30']);
    expect(billingPeriod({ issue_day: '25일', closing_day: '20일' }, 2026, 10)).toEqual(['2026-09-21', '2026-10-20']);
  });

  it('1월 발행분은 작년 12월부터', () => {
    expect(billingPeriod(s25, 2027, 1)).toEqual(['2026-12-26', '2027-01-25']);
  });

  it('오늘이 든 달의 발행분을 처음에 보인다', () => {
    expect(currentBillingPeriod(s25, '2026-10-04')).toEqual(['2026-09-26', '2026-10-25']);
    expect(currentBillingPeriod(s25, '2026-10-28')).toEqual(['2026-09-26', '2026-10-25']);
  });

  it('지난 달 · 다음 달로 한 달씩 옮긴다', () => {
    expect(shiftBillingPeriod(s25, '2026-10-25', -1)).toEqual(['2026-08-26', '2026-09-25']);
    expect(shiftBillingPeriod(s25, '2026-12-25', 1)).toEqual(['2026-12-26', '2027-01-25']);
  });

  it('지난달 마감분을 내는 현장도 한 달씩만 옮긴다 (끝 날의 달과 발행 달이 다르다)', () => {
    const site = { issue_day: '5일', closing_day: '말일' };
    expect(shiftBillingPeriod(site, '2026-09-30', -1)).toEqual(['2026-08-01', '2026-08-31']);
    expect(shiftBillingPeriod(site, '2026-09-30', 1)).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('현장을 바꾸면 보던 달은 그대로 두고 그 현장 발행일에 맞춘다', () => {
    expect(shiftBillingPeriod({ issue_day: '10일', closing_day: null }, '2026-09-25', 0, s25)).toEqual([
      '2026-08-11',
      '2026-09-10',
    ]);
  });

  it('끝 날을 손으로 고쳐 둔 뒤에는 그 날이 든 달을 기준으로 옮긴다', () => {
    expect(shiftBillingPeriod(s25, '2026-10-12', -1)).toEqual(['2026-08-26', '2026-09-25']);
  });
});

describe('밀린 작업 모으기', () => {
  const sites = [
    { id: 1, label: '나래(한강)', ...s25 },
    { id: 2, label: '아라(부천)', issue_day: '20일', closing_day: '20일' },
  ];

  it('마감일까지의 미발행 작업만 세고, 그 뒤 작업은 다음 발행 몫이다', () => {
    const got = collectOverdue(
      sites,
      [
        { site_id: 1, work_date: '2026-09-10', supply_amount: 1_400_000 },
        { site_id: 1, work_date: '2026-09-25', supply_amount: 1_000_000 },
        { site_id: 1, work_date: '2026-09-26', supply_amount: 9_999 }, // 다음 발행 몫
        { site_id: 2, work_date: '2026-09-21', supply_amount: 700_000 }, // 아라(부천)은 20일 마감이라 다음 몫
      ],
      '2026-09-29'
    );
    expect(got).toEqual([
      { site_id: 1, site_label: '나래(한강)', issue_date: '2026-09-25', cutoff: '2026-09-25', count: 2, amount: 2_400_000 },
    ]);
  });

  it('엑셀에서 옮겨 온 8월 이전 작업은 알리지 않는다 (이미 종이로 발행함)', () => {
    const got = collectOverdue(
      sites,
      [
        { site_id: 1, work_date: '2026-08-31', supply_amount: 1_400_000 },
        { site_id: 1, work_date: '2026-09-01', supply_amount: 1_000_000 },
      ],
      '2026-09-29'
    );
    expect(got.map((g) => [g.count, g.amount])).toEqual([[1, 1_000_000]]);
  });

  it('밀린 게 없으면 빈 목록', () => {
    expect(collectOverdue(sites, [], '2026-09-29')).toEqual([]);
  });
});

// 화면 맨 위 알림 띠의 제목 — 오늘이 발행일인 것과 이미 지난 것을 다르게 말한다
describe('알림 띠 제목', () => {
  const on = (issue_date: string) => ({ issue_date });

  it('모두 오늘이 발행일이면 「오늘 발행할 명세표 N곳」', () => {
    expect(overdueTitle([on('2026-10-05'), on('2026-10-05')], '2026-10-05')).toBe('오늘 발행할 명세표 2곳');
  });

  it('모두 지난 것이면 「발행일이 지났는데 안 낸 명세표 N곳」', () => {
    expect(overdueTitle([on('2026-09-25')], '2026-10-05')).toBe('발행일이 지났는데 안 낸 명세표 1곳');
  });

  it('섞여 있으면 둘 다 말한다', () => {
    expect(overdueTitle([on('2026-10-05'), on('2026-09-25'), on('2026-09-20')], '2026-10-05')).toBe(
      '오늘 발행할 명세표 1곳, 발행일이 지난 것 2곳'
    );
  });
});

// 발행일 하루 전부터 알린다 (사용자 결정 2026-10-03) — 당일 아침에 알면 준비할 틈이 없다
describe('하루 전부터 알린다', () => {
  const site = [{ id: 1, label: '나래(한강)', issue_day: '25일', closing_day: '25일' }];
  const log = [{ site_id: 1, work_date: '2026-10-20', supply_amount: 1_400_000 }];

  it('발행일 전날에는 내일 발행할 몫으로 잡힌다', () => {
    expect(collectOverdue(site, log, '2026-10-24')).toEqual([
      { site_id: 1, site_label: '나래(한강)', issue_date: '2026-10-25', cutoff: '2026-10-25', count: 1, amount: 1_400_000 },
    ]);
  });

  it('이틀 전에는 아직 알리지 않는다', () => {
    expect(collectOverdue(site, log, '2026-10-23')).toEqual([]);
  });

  it('달이 바뀌는 날도 넘어간다 (말일 다음 날이 발행일)', () => {
    const first = [{ id: 1, label: '다솜', issue_day: '1일', closing_day: '말일' }];
    const got = collectOverdue(first, [{ site_id: 1, work_date: '2026-10-30', supply_amount: 900_000 }], '2026-10-31');
    expect(got.map((g) => [g.issue_date, g.cutoff, g.count])).toEqual([['2026-11-01', '2026-10-31', 1]]);
  });

  it('제목: 내일 것만 있으면 「내일 발행할 명세표 N곳」', () => {
    expect(overdueTitle([{ issue_date: '2026-10-25' }], '2026-10-24')).toBe('내일 발행할 명세표 1곳');
  });

  it('제목: 오늘·내일·지난 것이 섞이면 급한 순서로 모두 말한다', () => {
    const items = [{ issue_date: '2026-10-25' }, { issue_date: '2026-10-24' }, { issue_date: '2026-10-20' }];
    expect(overdueTitle(items, '2026-10-24')).toBe('오늘 발행할 명세표 1곳, 내일 1곳, 발행일이 지난 것 1곳');
    expect(overdueTitle([items[0], items[2]], '2026-10-24')).toBe('내일 발행할 명세표 1곳, 발행일이 지난 것 1곳');
  });
});
