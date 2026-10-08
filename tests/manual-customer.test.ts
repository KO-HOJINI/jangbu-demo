// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MANUAL_CLIENT_NAME, customerSnapshot, manualClientId, typedCustomerName } from '../worker/manualCustomer';
import type { Client } from '../shared/types';

// node:sqlite 를 워커의 D1 처럼 쓰게 감싼다 (prepare → bind → run/first)
function fakeD1() {
  const d = new DatabaseSync(':memory:');
  d.exec(fs.readFileSync('migrations/0001_init.sql', 'utf8'));
  const db = {
    prepare(sql: string) {
      const stmt = d.prepare(sql);
      const bound = (args: unknown[]) => ({
        run: async () => stmt.run(...(args as never[])),
        first: async <T>() => (stmt.get(...(args as never[])) ?? null) as T | null,
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    },
  };
  return { d, db: db as unknown as D1Database };
}

describe('「직접 입력」 명세표의 숨은 거래처', () => {
  it('처음 부르면 보관 상태로 하나 만들고, 다시 불러도 같은 거래처를 쓴다', async () => {
    const { d, db } = fakeD1();
    const first = await manualClientId(db);
    const second = await manualClientId(db);
    expect(second).toBe(first);
    const rows = d.prepare('SELECT name, archived FROM clients WHERE name = ?').all(MANUAL_CLIENT_NAME);
    expect(rows).toEqual([{ name: MANUAL_CLIENT_NAME, archived: 1 }]);
  });
});

describe('typedCustomerName — 쳐 넣은 받는 곳 이름', () => {
  it('앞뒤 빈칸을 지우고, 비었으면 null', () => {
    expect(typedCustomerName('  가산건설 ')).toBe('가산건설');
    expect(typedCustomerName('   ')).toBeNull();
    expect(typedCustomerName(undefined)).toBeNull();
    expect(typedCustomerName(42)).toBeNull();
  });

  it('너무 길면 60자에서 자른다', () => {
    expect(typedCustomerName('가'.repeat(80))).toBe('가'.repeat(60));
  });
});

describe('customerSnapshot — 명세표에 찍을 공급받는 자', () => {
  const client = {
    id: 3,
    name: '아라',
    full_name: '아라개발(주)',
    biz_no: '123-45-67890',
    ceo_name: '홍길동',
    address: '서울',
  } as Client;

  it('등록한 거래처는 정식 상호와 사업자 정보를 쓴다', () => {
    expect(customerSnapshot(client, null)).toEqual({
      customer_name: '아라개발(주)',
      customer_biz_no: '123-45-67890',
      customer_ceo: '홍길동',
      customer_address: '서울',
    });
  });

  it('직접 입력이면 쳐 넣은 이름만 쓰고 나머지는 비운다', () => {
    expect(customerSnapshot(client, '가산건설')).toEqual({
      customer_name: '가산건설',
      customer_biz_no: null,
      customer_ceo: null,
      customer_address: null,
    });
  });
});
