/**
 * 거래처를 보관하면 소속 현장도 함께 보관한다 — 장부·명세표·견적서의 선택 목록은 현장을 보고 만들기 때문에
 * 현장이 남아 있으면 거래처만 보관해도 목록에서 빠지지 않는다. 되살릴 때도 현장을 함께 되살린다.
 * 지난 장부와 명세표는 그대로 남는다.
 */
export async function archiveClientSites(db: D1Database, clientId: number, archived: boolean): Promise<void> {
  await db
    .prepare('UPDATE sites SET archived = ? WHERE client_id = ?')
    .bind(archived ? 1 : 0, clientId)
    .run();
}
