import { describe, expect, it } from 'vitest';
import {
  issueDeadline,
  learnedRateText,
  shouldAskRateSlot,
  autoAmount,
  koreanAmount,
  manwon,
  monthRange,
  shiftMonthRange,
  parseDateInput,
  parseIssueDay,
  rateFor,
  shortDate,
  parseTimeRangeInput,
  timeRange,
  won,
} from '../src/lib/format';

describe('koreanAmount — 거래명세표 금액란', () => {
  // 원본 엑셀 수식은 자릿수를 하나씩 잘라 붙여 1,204,000 에서 '만' 위치가 틀어졌다.
  // 여기서는 4자리씩 묶어 계산하므로 그 문제가 없다.
  it.each([
    [0, '영원정 (₩0)'],
    [900, '구백원정 (₩900)'],
    [1_000, '일천원정 (₩1,000)'],
    [10_000, '일만원정 (₩10,000)'],
    [10_001, '일만일원정 (₩10,001)'],
    [1_200_000, '일백이십만원정 (₩1,200,000)'],
    [1_204_000, '일백이십만사천원정 (₩1,204,000)'],
    [5_940_000, '오백구십사만원정 (₩5,940,000)'],
    [8_580_000, '팔백오십팔만원정 (₩8,580,000)'],
    [11_440_000, '일천일백사십사만원정 (₩11,440,000)'],
    [100_000_000, '일억원정 (₩100,000,000)'],
    // 십의 자리 1 은 '일십' 으로 쓴다 (원본 엑셀과 같은 표기)
    [171_110_000, '일억칠천일백일십일만원정 (₩171,110,000)'],
  ])('%i → %s', (amount, expected) => {
    expect(koreanAmount(amount)).toBe(expected);
  });

  it('0 원이 아닌데 빈 문자열이 나오지 않는다', () => {
    for (let n = 1; n < 3000; n += 7) expect(koreanAmount(n)).toMatch(/^[가-힣]+원정 \(₩/);
  });
});

describe('parseDateInput — 명세표에서 날짜 칸을 고칠 때', () => {
  it.each([
    ['8/13', '2026-08-13'],
    ['8.13', '2026-08-13'],
    ['08/03', '2026-08-03'],
    ['8월 13일', '2026-08-13'],
    ['2026-08-31', '2026-08-31'],
    ['2026.8.31', '2026-08-31'],
    ['2026년 8월 31일', '2026-08-31'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateInput(input, '2026-01-01')).toBe(expected);
  });

  it('못 읽는 값은 null 을 돌려주어 원래 값이 유지된다', () => {
    for (const bad of ['', '아무거나', '13/45/99', 'abc']) {
      expect(parseDateInput(bad, '2026-01-01')).toBeNull();
    }
  });

  it('연도가 없으면 기준 날짜의 연도를 쓴다', () => {
    expect(parseDateInput('3/2', '2027-11-20')).toBe('2027-03-02');
  });
});

describe('monthRange', () => {
  it.each([
    ['2026-02-15', ['2026-02-01', '2026-02-28']],
    ['2028-02-15', ['2028-02-01', '2028-02-29']], // 윤년
    ['2026-12-05', ['2026-12-01', '2026-12-31']],
    ['2026-04-30', ['2026-04-01', '2026-04-30']],
  ])('%s → %s', (input, expected) => {
    expect(monthRange(input)).toEqual(expected);
  });
});

describe('issueDeadline — 발행 마감까지 남은 날', () => {
  it('현장에 발행일이 없으면 25일을 기준으로 센다', () => {
    expect(parseIssueDay(null)).toBe(25);
    expect(issueDeadline(null, '2026-09-09').date).toBe('2026-09-25');
    expect(issueDeadline(null, '2026-09-09').daysLeft).toBe(16);
  });

  it('현장에 적힌 발행일이 우선한다', () => {
    expect(issueDeadline('20일', '2026-09-09').date).toBe('2026-09-20');
    expect(issueDeadline('20일', '2026-09-09').daysLeft).toBe(11);
  });

  it('이번 달 마감이 지났으면 다음 달로 넘어간다', () => {
    expect(issueDeadline('20일', '2026-09-21').date).toBe('2026-10-20');
    expect(issueDeadline('25일', '2026-12-26').date).toBe('2027-01-25');
  });

  it('마감일 당일이면 0 일', () => {
    const d = issueDeadline('25일', '2026-09-25');
    expect(d.daysLeft).toBe(0);
    expect(d.label).toBe('오늘 발행');
    expect(d.urgency).toBe('today');
  });

  it("'말일' 은 그 달의 마지막 날", () => {
    expect(parseIssueDay('말일')).toBe('last');
    expect(issueDeadline('말일', '2026-02-10').date).toBe('2026-02-28');
    expect(issueDeadline('말일', '2028-02-10').date).toBe('2028-02-29');
  });

  it('31일 마감인데 그 달에 31일이 없으면 마지막 날로 당겨진다', () => {
    expect(issueDeadline('31일', '2026-04-10').date).toBe('2026-04-30');
  });

  it('사흘 이내면 급한 것으로 표시한다', () => {
    expect(issueDeadline('25일', '2026-09-23').urgency).toBe('soon');
    expect(issueDeadline('25일', '2026-09-20').urgency).toBe('normal');
  });
});

describe('rateFor — 장부에서 규격을 넣으면 채워지는 금액', () => {
  const rates = [
    { site_id: 7, boom_size: 32, half_day_amount: 700_000, full_day_amount: 1_000_000 },
    { site_id: 7, boom_size: 42, half_day_amount: null, full_day_amount: 1_400_000 },
    { site_id: 3, boom_size: 42, half_day_amount: null, full_day_amount: 1_500_000 },
    { site_id: 9, boom_size: 26, half_day_amount: 600_000, full_day_amount: null },
  ];

  it('현장마다 같은 규격이라도 금액이 다르다', () => {
    expect(rateFor(rates, 7, 42)).toBe(1_400_000);
    expect(rateFor(rates, 3, 42)).toBe(1_500_000);
  });

  it('하루 금액을 먼저 쓰고, 없으면 반나절 금액을 쓴다', () => {
    expect(rateFor(rates, 7, 32)).toBe(1_000_000);
    expect(rateFor(rates, 9, 26)).toBe(600_000);
  });

  it('등록되지 않은 조합이면 null — 자동으로 채우지 않는다', () => {
    expect(rateFor(rates, 7, 55)).toBeNull();
    expect(rateFor(rates, 99, 42)).toBeNull();
    expect(rateFor(rates, null, 42)).toBeNull();
    expect(rateFor(rates, 7, null)).toBeNull();
  });
});

describe('표시 형식', () => {
  it('금액에 천 단위 쉼표', () => {
    expect(won(1_400_000)).toBe('1,400,000');
    expect(won(0)).toBe('0');
    expect(won(null)).toBe('');
  });

  it('날짜는 월/일 로 줄여 쓴다', () => {
    expect(shortDate('2026-08-03')).toBe('8/3');
    expect(shortDate('2026-12-25')).toBe('12/25');
  });

  it('작업 시간은 한쪽만 있어도 그대로 보여준다', () => {
    expect(timeRange('07:00', '16:00')).toBe('07:00~16:00');
    expect(timeRange('07:00', null)).toBe('07:00');
    expect(timeRange(null, null)).toBe('');
  });
});

describe('parseTimeRangeInput — 장부 작업시간 한 칸', () => {
  it.each([
    ['07:00~17:00', '07:00', '17:00'],
    ['7:00 ~ 17:00', '07:00', '17:00'],
    ['7~17', '07:00', '17:00'],
    ['7:30-16', '07:30', '16:00'],
    ['0700 1700', '07:00', '17:00'],
    ['700~1630', '07:00', '16:30'],
    ['07001700', '07:00', '17:00'],
    ['13:00–24:00', '13:00', '24:00'],
  ])('%s → %s ~ %s', (text, start, end) => {
    expect(parseTimeRangeInput(text)).toEqual({ start, end });
  });

  it('한쪽만 적으면 시작만', () => {
    expect(parseTimeRangeInput('08:00')).toEqual({ start: '08:00', end: null });
  });

  it('비우면 둘 다 지운다', () => {
    expect(parseTimeRangeInput('  ')).toEqual({ start: null, end: null });
  });

  it.each(['25:00~17:00', '07:60~17:00', '24:30', '오전 7시', '7~17~19', 'abc'])('알아들을 수 없는 %s 는 null', (text) => {
    expect(parseTimeRangeInput(text)).toBeNull();
  });
});

describe('manwon — 금액을 만 단위로 읽기 (0 개수 오타를 한눈에)', () => {
  it.each([
    [1_400_000, '140만 원'],
    [14_000_000, '1,400만 원'],
    [120_500, '12만 500원'],
    [9_000, '9,000원'],
    [150_000_000, '1억 5,000만 원'],
    [100_000_000, '1억 원'],
    [100_000_500, '1억 500원'],
    [-50_000, '-5만 원'],
  ])('%i → %s', (amount, text) => {
    expect(manwon(amount)).toBe(text);
  });

  it('비었거나 숫자가 아니면 아무것도 보여주지 않는다', () => {
    expect(manwon(0)).toBe('');
    expect(manwon(null)).toBe('');
    expect(manwon(Number.NaN)).toBe('');
  });
});

describe('shiftMonthRange — 특정 개월 수 이동한 달의 1일/말일', () => {
  it('저번달(-1) 범위 계산', () => {
    expect(shiftMonthRange('2026-09-20', -1)).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('다음달(+1) 범위 계산', () => {
    expect(shiftMonthRange('2026-08-15', 1)).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('연도가 바뀌는 경우 (1월에서 -1 -> 전년도 12월)', () => {
    expect(shiftMonthRange('2026-01-10', -1)).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('연도가 바뀌는 경우 (12월에서 +1 -> 다음해 1월)', () => {
    expect(shiftMonthRange('2026-12-31', 1)).toEqual(['2027-01-01', '2027-01-31']);
  });

  it('윤년 2월 말일 처리 (2024년은 윤년)', () => {
    expect(shiftMonthRange('2024-03-15', -1)).toEqual(['2024-02-01', '2024-02-29']);
  });
});


describe('명세표 파일 이름', async () => {
  const { statementFileName } = await import('../src/lib/print');
  it('26년 8월 아라 광장 — 상호 꼬리는 떼고 현장명을 붙인다', () => {
    expect(statementFileName({ issue_date: '2026-09-29', period_end: '2026-08-31', customer_name: '아라개발(주)', customer_site_name: '광장' })).toBe('26년 8월 아라 광장');
  });
  it('거래처와 현장 이름이 같으면 한 번만 (가온 가온 → 가온)', () => {
    expect(statementFileName({ issue_date: '2026-09-29', period_end: '2026-08-31', customer_name: '가온', customer_site_name: '가온' })).toBe('26년 8월 가온');
  });
  it('임시 현장 이름도 붙는다', () => {
    expect(statementFileName({ issue_date: '2026-09-29', period_end: '2026-09-30', customer_name: '다솜', customer_site_name: '가산동 임시' })).toBe('26년 9월 다솜 가산동 임시');
  });
});

describe('splitAddressParen — 명세표/견적서 소재지 괄호 줄바꿈', async () => {
  const { splitAddressParen } = await import('../src/components/StatementSheet');
  it('괄호 참고주소가 있으면 괄호 앞에서 줄바꿈된다', () => {
    expect(
      splitAddressParen('서울시 샘플구 샘플로 1, 101호 (샘플동, 샘플타워)')
    ).toBe('서울시 샘플구 샘플로 1, 101호\n(샘플동, 샘플타워)');
  });
  it('괄호가 없으면 원본 그대로 유지된다', () => {
    expect(splitAddressParen('서울시 강남구 테헤란로 123')).toBe('서울시 강남구 테헤란로 123');
  });
  it('이미 줄바꿈이 있는 경우 유지된다', () => {
    expect(splitAddressParen('서울시 강남구\n(역삼동)')).toBe('서울시 강남구\n(역삼동)');
  });
  it('null, undefined, 빈 문자열이면 빈 문자열을 반환한다', () => {
    expect(splitAddressParen(null)).toBe('');
    expect(splitAddressParen(undefined)).toBe('');
    expect(splitAddressParen('')).toBe('');
  });
});

describe('learnedRateText — 새 작업의 금액이 단가로 등록되었을 때 알리는 말', () => {
  it('규격·하루/반나절·금액을 적는다', () => {
    expect(learnedRateText(42, { slot: 'full_day', amount: 1400000 })).toBe('42M 하루 단가 1,400,000원');
    expect(learnedRateText(32, { slot: 'half_day', amount: 550000 })).toBe('32M 반나절 단가 550,000원');
  });
});

describe('shouldAskRateSlot — 새 단가를 등록하기 전에 하루/반나절을 물을지', () => {
  const rates = [{ site_id: 1, boom_size: 42, half_day_amount: null, full_day_amount: 1400000 }];
  const base = { siteId: 2, boomSize: 42, amount: 1400000, hasTime: false };

  it('단가가 없는 현장·규격에 시간 없이 금액을 적으면 묻는다', () => {
    expect(shouldAskRateSlot(rates, base)).toBe(true);
  });
  it('시간을 적었으면 시간으로 가르므로 묻지 않는다', () => {
    expect(shouldAskRateSlot(rates, { ...base, hasTime: true })).toBe(false);
  });
  it('이미 단가가 있거나, 규격·금액이 없으면 묻지 않는다', () => {
    expect(shouldAskRateSlot(rates, { ...base, siteId: 1 })).toBe(false);
    expect(shouldAskRateSlot(rates, { ...base, boomSize: null })).toBe(false);
    expect(shouldAskRateSlot(rates, { ...base, amount: 0 })).toBe(false);
  });
});

describe('autoAmount — 현장·규격을 바꿨을 때 금액 칸', () => {
  it('비어 있거나 자동으로 채운 그대로면 새 단가로 바꾼다', () => {
    expect(autoAmount('', null, 1400000)).toEqual({ amount: '1400000', autoFilled: '1400000' });
    expect(autoAmount('1400000', '1400000', 1200000)).toEqual({ amount: '1200000', autoFilled: '1200000' });
  });
  it('손으로 친 금액은 건드리지 않는다', () => {
    expect(autoAmount('1300000', null, 1400000)).toBeNull();
    expect(autoAmount('1300000', '1400000', null)).toBeNull();
  });
  it('자동으로 채운 금액은, 바꾼 현장·규격에 단가가 없으면 지운다 — 앞 현장의 금액이 새 현장의 단가로 등록되지 않게', () => {
    expect(autoAmount('1400000', '1400000', null)).toEqual({ amount: '', autoFilled: null });
  });
  it('비어 있고 단가도 없으면 그대로', () => {
    expect(autoAmount('', null, null)).toBeNull();
  });
});
