import { describe, expect, it } from 'vitest';
import { duplicateSite, fullNameChange, knownClient, siteLabel } from '../src/lib/siteDuplicate';

const sites = [
  { id: 1, label: '가나(동쪽)' },
  { id: 2, label: '다라' },
];
const clients = [
  { id: 1, name: '가나', full_name: '가나건설(주)', archived: 0 },
  { id: 2, name: '다라', full_name: null, archived: 0 },
];

describe('siteLabel — 장부 표기', () => {
  it('거래처(현장), 둘이 같으면 이름 하나만', () => {
    expect(siteLabel(' 가나 ', '동쪽', '')).toBe('가나(동쪽)');
    expect(siteLabel('다라', '다라', '')).toBe('다라');
  });
  it('직접 적은 표기가 있으면 그것을 쓴다', () => {
    expect(siteLabel('가나', '동쪽', ' 가나 동 ')).toBe('가나 동');
  });
  it('둘 중 하나라도 비면 아직 모른다', () => {
    expect(siteLabel('가나', ' ', '')).toBe('');
  });
});

describe('duplicateSite — 같은 표기의 현장이 이미 있는가', () => {
  it('새로 등록할 때 같은 표기가 있으면 그 현장', () => {
    expect(duplicateSite('가나(동쪽)', sites, null)?.id).toBe(1);
    expect(duplicateSite('가나(서쪽)', sites, null)).toBeNull();
    expect(duplicateSite('', sites, null)).toBeNull();
  });
  it('수정 중인 현장 자신은 겹친 것으로 보지 않는다', () => {
    expect(duplicateSite('가나(동쪽)', sites, 1)).toBeNull();
    expect(duplicateSite('다라', sites, 1)?.id).toBe(2);
  });
});

describe('knownClient · fullNameChange — 이미 있는 거래처', () => {
  it('약칭이 같은 거래처를 찾는다 (앞뒤 빈칸 무시)', () => {
    expect(knownClient(' 가나 ', clients)?.id).toBe(1);
    expect(knownClient('가', clients)).toBeNull();
  });
  it('정식 상호를 다르게 적으면 무엇에서 무엇으로 바뀌는지', () => {
    expect(fullNameChange(clients[0], '가나종합건설(주)')).toEqual({ from: '가나건설(주)', to: '가나종합건설(주)' });
  });
  it('같게 적었거나, 비워 뒀거나, 원래 없던 것을 채우는 것은 바뀜이 아니다', () => {
    expect(fullNameChange(clients[0], ' 가나건설(주) ')).toBeNull();
    expect(fullNameChange(clients[0], '')).toBeNull();
    expect(fullNameChange(clients[1], '다라건설')).toBeNull();
    expect(fullNameChange(null, '새건설')).toBeNull();
  });
});
