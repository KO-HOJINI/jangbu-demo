/** 「2026-10」 → 「2026년 10월」 */
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

/** 「10/5」 — 준 날을 짧게 */
export const shortDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 금액 칸에 적은 글자를 숫자로. 쉼표·「원」·빈칸은 버린다.
 * 비어 있거나 숫자가 아니면 null (0 은 0 — 월급을 0 으로 적으면 그 달부터 주지 않는다는 뜻).
 */
export function toAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,원]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}
