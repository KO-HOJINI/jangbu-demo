import { describe, expect, it } from 'vitest';
import { nextSortDir, sortRows } from '../src/lib/sortRows';

type Row = { id: number; name: string | null; amount: number | null };
const rows: Row[] = [
  { id: 1, name: '라온(샘플리)', amount: 1_400_000 },
  { id: 2, name: null, amount: 1_200_000 },
  { id: 3, name: '가온', amount: null },
  { id: 4, name: '아라(광장)', amount: 1_200_000 },
  { id: 5, name: '', amount: 14_000_000 },
];
const ids = (list: Row[]) => list.map((r) => r.id);

describe('장부 표 정렬', () => {
  it('숫자는 크기순 — 1,400,000 이 14,000,000 보다 작다 (글자순이 아니다)', () => {
    expect(ids(sortRows(rows, (r) => r.amount, 'asc'))).toEqual([2, 4, 1, 5, 3]);
    expect(ids(sortRows(rows, (r) => r.amount, 'desc'))).toEqual([5, 1, 2, 4, 3]);
  });

  it('한글은 가나다순', () => {
    expect(ids(sortRows(rows, (r) => r.name, 'asc'))).toEqual([3, 1, 4, 2, 5]);
    expect(ids(sortRows(rows, (r) => r.name, 'desc'))).toEqual([4, 1, 3, 2, 5]);
  });

  it('빈 칸은 오름·내림 모두 맨 아래, 그 안에서는 원래 순서', () => {
    expect(ids(sortRows(rows, (r) => r.name, 'desc')).slice(-2)).toEqual([2, 5]);
    expect(ids(sortRows(rows, (r) => r.amount, 'desc')).at(-1)).toBe(3);
  });

  it('값이 같으면 원래 순서 그대로 (내림차순에서도 뒤집지 않는다)', () => {
    expect(ids(sortRows(rows, (r) => r.amount, 'asc')).slice(0, 2)).toEqual([2, 4]);
    expect(ids(sortRows(rows, (r) => r.amount, 'desc')).slice(2, 4)).toEqual([2, 4]);
  });

  it('원래 배열은 바꾸지 않는다', () => {
    sortRows(rows, (r) => r.amount, 'desc');
    expect(ids(rows)).toEqual([1, 2, 3, 4, 5]);
  });

  it('머리글을 누를 때마다 오름 → 내림 → 원래 순서', () => {
    expect(nextSortDir(null)).toBe('asc');
    expect(nextSortDir('asc')).toBe('desc');
    expect(nextSortDir('desc')).toBeNull();
  });

  it('금액 칸은 큰 것부터: 내림 → 오름 → 원래 순서', () => {
    expect(nextSortDir(null, 'desc')).toBe('desc');
    expect(nextSortDir('desc', 'desc')).toBe('asc');
    expect(nextSortDir('asc', 'desc')).toBeNull();
  });
});
