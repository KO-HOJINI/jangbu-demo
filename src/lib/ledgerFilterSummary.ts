import { monthRange } from './format';

/** 한 달을 통째로 고른 기간은 「2026년 8월」, 아니면 날짜 그대로 */
export function periodLabel(from: string, to: string): string {
  const [start, end] = monthRange(from);
  if (from === start && to === end) return `${Number(from.slice(0, 4))}년 ${Number(from.slice(5, 7))}월`;
  return `${from} ~ ${to}`;
}

/** 휴대폰 작업일보 「찾아보기」 상자를 접었을 때 보이는 한 줄 — 고른 조건만 적는다 */
export function filterSummary(filter: { from: string; to: string; site?: string; operator?: string; q?: string }): string {
  const q = filter.q?.trim();
  return [periodLabel(filter.from, filter.to), filter.site, filter.operator, q && `「${q}」`].filter(Boolean).join(', ');
}
