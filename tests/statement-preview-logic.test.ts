// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { statementFileName } from '../src/lib/print';
import { sumTotals } from '../worker/routes/statements';

describe('거래명세표 파일명 및 시트 헤더 현장명 표기 검증', () => {
  it('거래처명과 현장명이 다르면 둘 다 파일명에 포함된다', () => {
    const name = statementFileName({
      issue_date: '2026-09-29',
      customer_name: '가온건설',
      customer_site_name: '테스트',
    });
    expect(name).toBe('26년 9월 가온 테스트');
  });

  it('거래처명과 현장명이 같으면 중복되지 않고 한 번만 나온다', () => {
    const name = statementFileName({
      issue_date: '2026-09-29',
      customer_name: '가온',
      customer_site_name: '가온',
    });
    expect(name).toBe('26년 9월 가온');
  });

  it('현장명이 없으면 거래처명만 나온다', () => {
    const name = statementFileName({
      issue_date: '2026-09-29',
      customer_name: '아라개발(주)',
      customer_site_name: null,
    });
    expect(name).toBe('26년 9월 아라');
  });
});

describe('합계 금액 계산 (sumTotals) 검증', () => {
  it('공급가액 및 10% 부가세가 정확히 반올림 계산된다', () => {
    const lines = [
      { supply_amount: 1400000, vat_amount: 140000 },
      { supply_amount: 1540000, vat_amount: 154000 },
    ];
    const totals = sumTotals(lines);
    expect(totals.count).toBe(2);
    expect(totals.supplyAmount).toBe(2940000);
    expect(totals.vatAmount).toBe(294000);
    expect(totals.totalAmount).toBe(3234000);
  });
});
