import { describe, expect, it } from 'vitest';
import { addDraftLine, changeDraftLine, linesToSend, removeDraftLine, withIds } from '../src/lib/quoteDraft';

// 발행하기 전 견적서 줄을 양식에서 바로 고치기
const rates = [
  { item_name: '펌프카 장비', spec: '32M', basis: '반나절', supply_amount: 500000 },
  { item_name: '펌프카 장비', spec: '32M', basis: '하루', supply_amount: 800000 },
];

describe('발행 전 견적 줄 고치기', () => {
  const lines = withIds(rates);

  it('단가표에서 온 줄에 번호와 세액을 붙인다', () => {
    expect(lines.map((l) => l.id)).toEqual([1, 2]);
    expect(lines[1].vat_amount).toBe(80000);
  });

  it('공급가액을 고치면 세액도 따라 바뀐다', () => {
    const next = changeDraftLine(lines, 2, { supply_amount: 900000 });
    expect(next[1]).toMatchObject({ id: 2, supply_amount: 900000, vat_amount: 90000 });
    expect(next[0]).toEqual(lines[0]);
  });

  it('글자 칸만 고치면 금액은 그대로', () => {
    expect(changeDraftLine(lines, 1, { basis: '4시간' })[0]).toMatchObject({ basis: '4시간', supply_amount: 500000, vat_amount: 50000 });
  });

  it('줄을 더하면 겹치지 않는 번호의 빈 줄이 맨 아래에 붙는다', () => {
    const next = addDraftLine(removeDraftLine(lines, 1));
    expect(next.map((l) => l.id)).toEqual([2, 3]);
    expect(next[1]).toMatchObject({ item_name: '펌프카 장비', spec: null, basis: null, supply_amount: 0, vat_amount: 0 });
  });

  it('발행할 때는 번호와 세액을 떼고 보낸다 (세액은 서버가 다시 셈한다)', () => {
    expect(linesToSend(lines)).toEqual(rates);
  });
});
