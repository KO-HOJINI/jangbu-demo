import type { QuoteDraftLine } from '../../shared/types';

/** 발행 전 견적 줄. 양식에서 고르고 고칠 수 있게 화면에서만 쓰는 번호(id)를 붙인다 */
export type DraftLine = QuoteDraftLine & { vat_amount: number };

type BareLine = Omit<QuoteDraftLine, 'id'>;

const vat = (supply: number) => Math.round(supply * 0.1);

/** 단가표에서 온 줄에 번호와 세액을 붙인다 */
export function withIds(lines: BareLine[]): DraftLine[] {
  return lines.map((l, i) => ({ ...l, id: i + 1, vat_amount: vat(l.supply_amount) }));
}

export function changeDraftLine(lines: DraftLine[], id: number, patch: Partial<BareLine>): DraftLine[] {
  return lines.map((l) => {
    if (l.id !== id) return l;
    const next = { ...l, ...patch };
    return { ...next, vat_amount: vat(next.supply_amount) };
  });
}

export function addDraftLine(lines: DraftLine[]): DraftLine[] {
  const id = Math.max(0, ...lines.map((l) => l.id)) + 1;
  return [...lines, { id, item_name: '펌프카 장비', spec: null, basis: null, supply_amount: 0, vat_amount: 0 }];
}

export function removeDraftLine(lines: DraftLine[], id: number): DraftLine[] {
  return lines.filter((l) => l.id !== id);
}

/** 발행할 때 서버로 보낼 모양 — 번호와 세액은 뗀다 (세액은 서버가 다시 셈한다) */
export function linesToSend(lines: DraftLine[]): BareLine[] {
  return lines.map(({ item_name, spec, basis, supply_amount }) => ({ item_name, spec, basis, supply_amount }));
}
