import { describe, expect, it } from 'vitest';
// @ts-expect-error — 이관 스크립트는 순수 자바스크립트다
import { parseSiteLabel, parseTimeRange, serialToISO, sqlQuote } from '../scripts/parse.mjs';

describe('parseTimeRange — 엑셀이 숫자로 뭉개버린 작업시간 복원', () => {
  it('제대로 적힌 시간은 그대로', () => {
    expect(parseTimeRange('07:00~16:00')).toEqual(['07:00', '16:00']);
    expect(parseTimeRange('7:00~16:00')).toEqual(['07:00', '16:00']);
    expect(parseTimeRange('06:30 ~ 14:00')).toEqual(['06:30', '14:00']);
  });

  // 원본 장부의 21개 행이 이렇게 깨져 있었다. HHMM+HHMM 이 이어붙은 숫자다.
  it.each([
    [7001900, ['07:00', '19:00']],
    [7001600, ['07:00', '16:00']],
    [6301400, ['06:30', '14:00']],
    [8001700, ['08:00', '17:00']],
    [13001600, ['13:00', '16:00']],
    [13001630, ['13:00', '16:30']],
    [7001030, ['07:00', '10:30']],
  ])('%i → %s', (input, expected) => {
    expect(parseTimeRange(input)).toEqual(expected);
  });

  it('지수 표기(1.30016E7)도 같은 값으로 읽힌다', () => {
    expect(parseTimeRange(1.30016e7)).toEqual(parseTimeRange(13001600));
    expect(parseTimeRange(1.300163e7)).toEqual(['13:00', '16:30']);
  });

  it('시각이 될 수 없는 숫자는 버린다 (엉뚱한 값이 들어가지 않게)', () => {
    expect(parseTimeRange(9999999)).toEqual([null, null]); // 99:99 는 시각이 아니다
    expect(parseTimeRange(123)).toEqual([null, null]);
    expect(parseTimeRange(null)).toEqual([null, null]);
    expect(parseTimeRange('')).toEqual([null, null]);
  });
});

describe('parseSiteLabel — 장부 현장 표기를 거래처와 현장으로 나눈다', () => {
  it('괄호가 있으면 거래처(현장)', () => {
    expect(parseSiteLabel('아라(광장)')).toEqual({ client: '아라', site: '광장' });
    expect(parseSiteLabel('라온(샘플리)')).toEqual({ client: '라온', site: '샘플리' });
    expect(parseSiteLabel('아라 (부천)')).toEqual({ client: '아라', site: '부천' });
  });

  it('괄호가 없으면 거래처와 현장 이름이 같다', () => {
    expect(parseSiteLabel('다솜')).toEqual({ client: '다솜', site: '다솜' });
    expect(parseSiteLabel('가온')).toEqual({ client: '가온', site: '가온' });
  });

  it('현장 이름 자체에 괄호가 들어가도 마지막 괄호만 자른다', () => {
    expect(parseSiteLabel('나래(한강)')).toEqual({ client: '나래', site: '한강' });
  });
});

describe('serialToISO — 엑셀 날짜 일련번호', () => {
  it.each([
    [46195, '2026-06-22'], // 장부 첫 줄
    [46196, '2026-06-23'],
    [46261, '2026-08-27'], // 장부 마지막 줄
    [46023, '2026-01-01'],
  ])('%i → %s', (serial, expected) => {
    expect(serialToISO(serial)).toBe(expected);
  });

  it('하루씩 늘리면 날짜도 하루씩 늘어난다 (시차로 밀리지 않는다)', () => {
    for (let s = 46195; s < 46265; s++) {
      const a = new Date(`${serialToISO(s)}T00:00:00Z`).getTime();
      const b = new Date(`${serialToISO(s + 1)}T00:00:00Z`).getTime();
      expect(b - a).toBe(86_400_000);
    }
  });
});

describe('sqlQuote — 시드 SQL 만들 때 따옴표 처리', () => {
  it('작은따옴표를 두 번 써서 escape 한다', () => {
    expect(sqlQuote("아라'개발")).toBe("'아라''개발'");
  });

  it('빈 값은 NULL', () => {
    expect(sqlQuote(null)).toBe('NULL');
    expect(sqlQuote('')).toBe('NULL');
  });

  it('한글과 괄호는 그대로', () => {
    expect(sqlQuote('아라(광장)')).toBe("'아라(광장)'");
  });
});
