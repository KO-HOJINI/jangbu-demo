import { describe, expect, it } from 'vitest';
import { filterSummary, periodLabel } from '../src/lib/ledgerFilterSummary';

// 휴대폰 작업일보 「찾아보기」 상자를 접었을 때 보이는 한 줄
describe('찾아보기 조건을 한 줄로', () => {
  it('한 달을 통째로 고르면 「2026년 8월」', () => {
    expect(periodLabel('2026-08-01', '2026-08-31')).toBe('2026년 8월');
    expect(periodLabel('2026-02-01', '2026-02-28')).toBe('2026년 2월');
  });

  it('한 달이 아니면 날짜를 그대로', () => {
    expect(periodLabel('2026-08-01', '2026-08-15')).toBe('2026-08-01 ~ 2026-08-15');
    expect(periodLabel('2026-08-01', '2026-09-30')).toBe('2026-08-01 ~ 2026-09-30');
  });

  it('고르지 않은 조건은 적지 않는다', () => {
    expect(filterSummary({ from: '2026-08-01', to: '2026-08-31' })).toBe('2026년 8월');
  });

  it('고른 현장·기사님·찾는 글자를 뒤에 붙인다', () => {
    expect(
      filterSummary({ from: '2026-08-01', to: '2026-08-31', site: '아라(광장)', operator: '김기사', q: ' 환기구 ' })
    ).toBe('2026년 8월, 아라(광장), 김기사, 「환기구」');
  });
});
