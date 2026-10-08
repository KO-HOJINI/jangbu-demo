/**
 * 화면들의 「현장」 고르는 칸이 같은 규칙을 쓰도록 모아 둔 곳.
 *
 * 목록은 거래처끼리 묶고, 묶음마다 맨 위에 「○○ 전체」 줄을 둔다.
 * 그 줄의 value 는 현장 번호와 섞이지 않게 'client:3' 처럼 적는다.
 */

/** 「○○ 전체」 줄임을 알아보는 표시 (뒤에 거래처 번호가 붙는다) */
export const ALL_SITES = 'client:';

/**
 * 명세표 현장 목록의 「직접 입력」 줄 — 등록하지 않은 임시 현장 이름을 쳐서 쓴다.
 * 현장 번호·「○○ 전체」와 섞이지 않는 값.
 */
export const MANUAL_SITE = 'manual:';

/** 거래처 번호 → 「○○ 전체」 줄의 value */
export const allSitesValue = (clientId: number | string): string => `${ALL_SITES}${clientId}`;

/** 고른 값이 「○○ 전체」면 그 거래처 번호, 현장을 골랐으면 null */
export function clientIdFromValue(value: string): number | null {
  return value.startsWith(ALL_SITES) ? Number(value.slice(ALL_SITES.length)) : null;
}

/**
 * 양식에서 거래처를 바꿨을 때 위 「현장」 칸에 넣을 값.
 *
 * 그 거래처의 현장이 하나뿐이면(라온·마루처럼) 바로 그 현장을 고르고,
 * 여럿이면(다솜 → 「다솜」·「다솜(상암)」) 어느 곳인지 알 수 없으므로 비워 둔다.
 * 비워 두면 명세표는 「다솜 전체」, 견적서는 「다솜 현장 선택」으로 보인다.
 *
 * 돌려주는 값은 select 의 value 라 글자다 ('' = 고르지 않음).
 */
export function siteForClient(
  sites: { id: number; client_id: number; archived?: boolean | number | null }[],
  clientId: number
): string {
  const own = sites.filter((s) => s.client_id === clientId && !s.archived);
  return own.length === 1 ? String(own[0].id) : '';
}
