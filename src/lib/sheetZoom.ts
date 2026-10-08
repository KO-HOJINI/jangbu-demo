/** A4 양식의 폭 210mm 를 화면 점으로 (1in = 25.4mm = 96px) */
const SHEET_PX = (210 / 25.4) * 96;

/**
 * 좁은 화면에서 명세표·견적서 A4 양식을 화면 폭에 맞추는 배율.
 * 본문 양옆 여백(16px 씩)을 뺀 폭에 딱 들어가게 하고, 넓은 화면에서는 키우지 않는다.
 * 소수 셋째 자리에서 내려 반올림 때문에 1px 넘치는 일이 없게 한다.
 */
export function sheetZoom(viewportWidth: number): number {
  const fit = Math.floor(((viewportWidth - 32) / SHEET_PX) * 1000) / 1000;
  return Math.min(1, Math.max(0.2, fit));
}
