/**
 * 거래처·현장 등록 화면이 저장 전에 미리 알리는 것들.
 * 서버는 같은 장부 표기를 저장할 때 막고(409), 같은 약칭의 거래처는 그대로 쓰면서 정식 상호만 바꾼다
 * (worker/routes/sites.ts). 화면은 그 일을 적는 동안 먼저 보여 준다.
 */

/** 장부 표기 — 서버의 buildLabel 과 같은 규칙. 아직 정할 수 없으면 빈 글자 */
export function siteLabel(clientName: string, siteName: string, typedLabel: string): string {
  const typed = typedLabel.trim();
  if (typed) return typed;
  const client = clientName.trim();
  const site = siteName.trim();
  if (!client || !site) return '';
  return client === site ? client : `${client}(${site})`;
}

/** 같은 표기의 현장이 이미 있으면 그 현장. 수정 중인 현장(ownId) 자신은 뺀다 */
export function duplicateSite<T extends { id: number; label: string }>(
  label: string,
  sites: readonly T[],
  ownId: number | null
): T | null {
  if (!label) return null;
  return sites.find((s) => s.label === label && s.id !== ownId) ?? null;
}

/** 약칭이 같은 거래처 — 있으면 새로 만들지 않고 그 거래처에 현장이 붙는다 */
export function knownClient<T extends { name: string }>(name: string, clients: readonly T[]): T | null {
  const key = name.trim();
  if (!key) return null;
  return clients.find((c) => c.name === key) ?? null;
}

/** 이미 있는 거래처의 정식 상호가 저장하면 바뀌는가. 비어 있던 것을 채우는 것은 알리지 않는다 */
export function fullNameChange(
  client: { full_name: string | null } | null,
  typedFullName: string
): { from: string; to: string } | null {
  const to = typedFullName.trim();
  if (!client?.full_name || !to || to === client.full_name) return null;
  return { from: client.full_name, to };
}
