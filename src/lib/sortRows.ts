/** 정렬 값 — 빈 칸(null·빈 글자)은 오름·내림 어느 쪽이든 맨 아래로 보낸다 */
export type SortValue = string | number | null | undefined;

export type SortDir = 'asc' | 'desc';

/**
 * 머리글을 누를 때마다 오름 → 내림 → 원래 순서(null) 로 돈다.
 * first 를 'desc' 로 주면 내림 → 오름 → 원래 순서 (금액처럼 큰 것부터 보고 싶은 칸).
 */
export function nextSortDir(current: SortDir | null, first: SortDir = 'asc'): SortDir | null {
  const second: SortDir = first === 'asc' ? 'desc' : 'asc';
  return current === null ? first : current === first ? second : null;
}

const isEmpty = (v: SortValue) => v === null || v === undefined || v === '';

/**
 * 표 정렬. 원래 배열은 건드리지 않는다.
 * 값이 같으면 원래 순서(장부 날짜·입력 순서)를 그대로 둔다.
 * 한글은 가나다순, 숫자는 크기순.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const ae = isEmpty(a.v);
      const be = isEmpty(b.v);
      if (ae || be) return ae === be ? a.index - b.index : ae ? 1 : -1;
      const diff =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), 'ko', { numeric: true });
      return diff !== 0 ? diff * sign : a.index - b.index;
    })
    .map((x) => x.row);
}
