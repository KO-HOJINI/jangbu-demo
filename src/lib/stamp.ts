import type { Company } from '../../shared/types';

/**
 * 도장 그림 주소 (없으면 null).
 * 바꿀 때마다 주소 끝(?v=)이 달라져서, 브라우저가 옛 도장을 붙들고 있지 않는다.
 */
export function stampUrl(company: Pick<Company, 'id' | 'stamp_updated_at'> | null | undefined): string | null {
  if (!company?.stamp_updated_at) return null;
  return `/api/companies/${company.id}/stamp?v=${encodeURIComponent(company.stamp_updated_at)}`;
}
