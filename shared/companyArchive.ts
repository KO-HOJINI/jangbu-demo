/**
 * 내 회사를 보관해도 되는지. 안 되면 그 까닭을 돌려준다 (서버와 설정 화면이 같이 쓴다).
 * 보관한 회사는 새 명세표·견적서에서 고를 수 없으므로, 쓸 회사가 하나는 남아야 하고
 * 「기본」 회사는 새 명세표에 먼저 잡히는 곳이라 다른 회사를 기본으로 바꾼 뒤에 보관한다.
 */
export function archiveBlock(
  company: { id: number; is_default: number },
  companies: { id: number; archived?: number }[]
): string | null {
  if (company.is_default) return '기본 회사는 보관할 수 없습니다. 다른 회사를 기본으로 바꾼 뒤 보관해 주세요.';
  const others = companies.filter((c) => c.id !== company.id && !c.archived);
  if (!others.length) return '쓰는 회사가 하나는 남아 있어야 합니다.';
  return null;
}
