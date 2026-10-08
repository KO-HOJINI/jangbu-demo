/** 작업일보 첫 화면에서 빈 달을 거슬러 찾는 최대 달 수 (장부가 비어도 끝없이 넘기지 않게) */
export const AUTO_BACK_MAX = 12;

/**
 * 첫 화면이 빈 달일 때 다음에 할 일.
 * step 은 이번 달에서 몇 달 거슬러 왔는지(0 = 이번 달).
 * 'stop' 은 그 달에 머문다, 'reset' 은 이번 달로 돌아온다, 숫자는 그만큼 거슬러 간 달을 본다.
 */
export function nextAutoBack(step: number, hasRows: boolean): number | 'stop' | 'reset' {
  if (hasRows) return 'stop';
  if (step >= AUTO_BACK_MAX) return 'reset';
  return step + 1;
}
