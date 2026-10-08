import { describe, expect, it } from 'vitest';
import { archiveBlock } from '../shared/companyArchive';

// 설정 > 내 회사 > 보관
describe('내 회사를 보관해도 되는지', () => {
  const hangang = { id: 1, is_default: 1, archived: 0 };
  const geumgang = { id: 2, is_default: 0, archived: 0 };
  const old = { id: 3, is_default: 0, archived: 1 };

  it('기본이 아니고 다른 회사가 남으면 된다', () => {
    expect(archiveBlock(geumgang, [hangang, geumgang])).toBeNull();
  });

  it('기본 회사는 안 된다', () => {
    expect(archiveBlock(hangang, [hangang, geumgang])).toContain('기본');
  });

  it('쓰는 회사가 하나도 안 남으면 안 된다 (보관한 회사는 세지 않는다)', () => {
    expect(archiveBlock(geumgang, [geumgang, old])).toContain('하나는');
  });
});
