import { describe, expect, it } from 'vitest';
import { normalizeManualLines } from '../worker/routes/statements';

// 명세표에 손으로 적어 발행하는 줄 (등록하지 않은 임시 현장·추가 요금)
describe('손으로 적은 명세 줄 다듬기', () => {
  it('보내지 않았으면 빈 목록 — 예전처럼 장부 줄만으로 발행한다', () => {
    expect(normalizeManualLines(undefined, '2026-09-30')).toEqual([]);
  });

  it('날짜가 없거나 이상하면 기간 끝날로 둔다', () => {
    const [a, b] = normalizeManualLines(
      [
        { supply_amount: 1400000 },
        { work_date: '9/3', supply_amount: 0 },
      ],
      '2026-09-30'
    )!;
    expect(a.work_date).toBe('2026-09-30');
    expect(b.work_date).toBe('2026-09-30');
  });

  it('숫자는 숫자로, 빈 칸은 0·null 로', () => {
    const [line] = normalizeManualLines(
      [{ work_date: '2026-09-12', description: '  임시 타설 ', supply_amount: '1400000', ot_hours: '', boom_size: '' }],
      '2026-09-30'
    )!;
    expect(line).toEqual({
      work_date: '2026-09-12',
      description: '임시 타설',
      start_time: null,
      end_time: null,
      ot_hours: 0,
      boom_size: null,
      supply_amount: 1400000,
    });
  });

  it('금액 칸에 숫자가 아닌 게 있으면 받지 않는다', () => {
    expect(normalizeManualLines([{ supply_amount: '백만원' }], '2026-09-30')).toBeNull();
  });

  it('원 아래는 반올림한다 (장부 금액과 같은 정수)', () => {
    expect(normalizeManualLines([{ supply_amount: 1000.6 }], '2026-09-30')![0].supply_amount).toBe(1001);
  });
});
