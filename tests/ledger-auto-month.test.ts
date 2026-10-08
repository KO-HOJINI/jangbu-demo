import { describe, expect, it } from 'vitest';
import { AUTO_BACK_MAX, nextAutoBack } from '../src/lib/ledgerAutoMonth';

describe('nextAutoBack — 작업일보 첫 화면이 빈 달이면 작업 있는 달까지 거슬러 가기', () => {
  it('작업이 있으면 그 달에서 멈춘다', () => {
    expect(nextAutoBack(0, true)).toBe('stop');
    expect(nextAutoBack(3, true)).toBe('stop');
  });

  it('작업이 없으면 한 달 더 거슬러 간다', () => {
    expect(nextAutoBack(0, false)).toBe(1);
    expect(nextAutoBack(1, false)).toBe(2);
    expect(nextAutoBack(5, false)).toBe(6);
  });

  it('최대 달 수까지 찾아도 없으면 이번 달로 돌아온다', () => {
    expect(nextAutoBack(AUTO_BACK_MAX, false)).toBe('reset');
  });
});
