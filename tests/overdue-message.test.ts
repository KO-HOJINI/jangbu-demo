import { describe, expect, it } from 'vitest';
import { koreaToday, manwon, overdueMessage } from '../worker/routes/alerts';

describe('아침 알림 문구', () => {
  it('금액은 화면처럼 「1억 7,111만 원」', () => {
    expect(manwon(171_110_000)).toBe('1억 7,111만 원');
    expect(manwon(47_700_000)).toBe('4,770만 원');
    expect(manwon(100_000_000)).toBe('1억 원');
    expect(manwon(5_000)).toBe('5,000원');
  });

  it('현장이 많아도 한 통으로 — 큰 두 곳과 「외 N곳」', () => {
    const items = [
      { site_id: 8, site_label: '다솜', issue_date: '2026-09-25', cutoff: '2026-09-25', count: 18, amount: 47_700_000 },
      { site_id: 7, site_label: '아라(부천)', issue_date: '2026-09-20', cutoff: '2026-09-20', count: 23, amount: 27_860_000 },
      { site_id: 5, site_label: '아라(시흥)', issue_date: '2026-09-25', cutoff: '2026-09-25', count: 20, amount: 26_520_000 },
    ];
    expect(overdueMessage(items, '2026-09-29')).toEqual({
      title: '명세표 낼 현장 3곳 · 1억 208만 원',
      body: '발행일이 지났는데 아직 안 낸 작업이 있습니다. 다솜 4,770만 원, 아라(부천) 2,786만 원 외 1곳',
      url: '/sites',
      tag: 'overdue-2026-09-29',
    });
  });

  it('밀린 게 없으면 보내지 않는다', () => {
    expect(overdueMessage([], '2026-09-29')).toBeNull();
  });

  it('cron 이 도는 00:00 UTC 는 한국 09:00 — 같은 날짜', () => {
    expect(koreaToday(Date.UTC(2026, 8, 29, 0, 0))).toBe('2026-09-29');
    // 한국 자정 직후(UTC 전날 15:00)도 한국 날짜로
    expect(koreaToday(Date.UTC(2026, 8, 28, 15, 30))).toBe('2026-09-29');
  });
});

describe('아침 알림 문구 — 발행일 전날·당일', () => {
  const item = (issue_date: string) => ({ site_id: 8, site_label: '다솜', issue_date, cutoff: issue_date, count: 3, amount: 4_200_000 });

  it('내일이 발행일이면 지났다고 하지 않는다', () => {
    expect(overdueMessage([item('2026-10-25')], '2026-10-24')?.body).toBe('내일 발행할 명세표 1곳. 다솜 420만 원');
  });

  it('오늘이 발행일이면 오늘이라고 말한다', () => {
    expect(overdueMessage([item('2026-10-25')], '2026-10-25')?.body).toBe('오늘 발행할 명세표 1곳. 다솜 420만 원');
  });
});
