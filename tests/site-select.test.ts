import { describe, expect, it } from 'vitest';
import { allSitesValue, clientIdFromValue, siteForClient } from '../src/lib/siteSelect';

// 장부 기준 실제 자료 일부: 다솜(3)은 현장 두 곳, 라온(4)·마루(5)은 한 곳
const sites = [
  { id: 1, client_id: 4, archived: 0 }, // 라온(샘플리)
  { id: 8, client_id: 3, archived: 0 }, // 다솜
  { id: 14, client_id: 5, archived: 0 }, // 마루(용산)
  { id: 15, client_id: 3, archived: 0 }, // 다솜(상암)
  { id: 99, client_id: 5, archived: 1 }, // 마루의 보관한 현장
];

describe('양식에서 거래처를 바꿨을 때 고를 현장', () => {
  it('현장이 하나뿐인 거래처는 그 현장을 고른다', () => {
    expect(siteForClient(sites, 4)).toBe('1');
  });

  it('현장이 여럿이면 비워 둔다 — 어느 곳인지 알 수 없다', () => {
    expect(siteForClient(sites, 3)).toBe('');
  });

  it('보관한 현장은 세지 않는다 — 마루은 살아 있는 현장이 하나뿐이다', () => {
    expect(siteForClient(sites, 5)).toBe('14');
  });

  it('현장이 없는 거래처는 비워 둔다', () => {
    expect(siteForClient(sites, 7)).toBe('');
  });
});

describe('「○○ 전체」 줄의 값', () => {
  it('거래처 번호를 담았다가 그대로 꺼낸다', () => {
    expect(clientIdFromValue(allSitesValue(3))).toBe(3);
  });

  it('현장 번호는 「전체」가 아니다 — 현장 8 과 거래처 8 이 섞이지 않는다', () => {
    expect(clientIdFromValue('8')).toBeNull();
    expect(allSitesValue(8)).not.toBe('8');
  });

  it('아무것도 안 고른 값도 「전체」가 아니다', () => {
    expect(clientIdFromValue('')).toBeNull();
  });
});
