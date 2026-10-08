import type { Client } from '../shared/types';
import { MANUAL_CLIENT_NAME } from '../shared/manualCustomer';

export { MANUAL_CLIENT_NAME };

/**
 * 「직접 입력」 명세표 — 장부에 없는 곳의 단기 작업이라 거래처를 등록하지 않고
 * 명세표 상호 칸에 찍힐 이름만 쳐 넣는다.
 *
 * statements.client_id 는 비울 수 없어서(0001), 이런 명세표는 보관 상태의 숨은 거래처
 * 하나에 모아 둔다. 거래처 목록(masters)에서는 빠지고, 명세표 목록에는 쳐 넣은 이름이 보인다.
 */
export async function manualClientId(db: D1Database): Promise<number> {
  // clients.name 은 UNIQUE 라 두 분이 동시에 발행해도 하나만 생긴다
  await db
    .prepare('INSERT OR IGNORE INTO clients (name, archived) VALUES (?, 1)')
    .bind(MANUAL_CLIENT_NAME)
    .run();
  const row = await db
    .prepare('SELECT id FROM clients WHERE name = ?')
    .bind(MANUAL_CLIENT_NAME)
    .first<{ id: number }>();
  return row!.id;
}

/** 쳐 넣은 받는 곳 이름. 비었으면 null (= 직접 입력이 아니다) */
export function typedCustomerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 60) || null;
}

/** 명세표에 남길 공급받는 자. 직접 입력이면 이름만 남기고 사업자 정보는 비운다 */
export function customerSnapshot(client: Client, typedName: string | null) {
  if (typedName) {
    return { customer_name: typedName, customer_biz_no: null, customer_ceo: null, customer_address: null };
  }
  return {
    customer_name: client.full_name ?? client.name,
    customer_biz_no: client.biz_no,
    customer_ceo: client.ceo_name,
    customer_address: client.address,
  };
}
