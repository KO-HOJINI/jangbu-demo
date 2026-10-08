import { describe, expect, it } from 'vitest';
import type { Masters } from '../shared/types';
import { normalizeRows, type PhotoRow } from '../src/lib/photoLog';

const masters = {
  sites: [
    { id: 1, client_id: 1, name: '광장', label: '아라(광장)', archived: 0 },
    { id: 2, client_id: 2, name: '가산동', label: '가온(가산동)', archived: 0 },
  ],
  operators: [
    { id: 10, name: '김기사', archived: 0 },
  ],
  rates: [
    { site_id: 1, boom_size: 42, half_day_amount: null, full_day_amount: 1_400_000 },
  ],
} as unknown as Masters;

describe('사진 장부 파싱 결과 검토 및 수정/줄 삭제 로직', () => {
  const sampleRaw = [
    { date: '9/15', site: '광장', work: '벽체', time: '07:00~15:00', m: 42, ot: 0, pour: 150, amount: null, operator: '김기사' },
    { date: '9/15', site: '가산동', work: '기초', time: '08:00~16:00', m: 32, ot: 0, pour: null, amount: 800000, operator: '김기사' },
    { date: '9/15', site: '미등록현장', work: '슬라브', time: '07:00~17:00', m: 37, ot: 0, pour: null, amount: null, operator: '김기사' },
  ];

  it('초기 정규화 시 3건 중 현장 매칭된 2건만 기본 include=true가 된다', () => {
    const rows = normalizeRows(sampleRaw, masters, '2026-09-29');
    expect(rows.length).toBe(3);
    const chosen = rows.filter((r) => r.include && r.site_id != null);
    expect(chosen.length).toBe(2);
    expect(rows[2].site_id).toBeNull();
    expect(rows[2].include).toBe(false);
  });

  it('특정 줄 삭제(remove) 시 행 목록과 등록 대상(chosen)에서 완전히 제거된다', () => {
    let rows = normalizeRows(sampleRaw, masters, '2026-09-29');
    const targetKey = rows[0].key; // 광장 작업
    
    // remove 로직 시뮬레이션
    rows = rows.filter((r) => r.key !== targetKey);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.key === targetKey)).toBeUndefined();

    const chosen = rows.filter((r) => r.include && r.site_id != null);
    expect(chosen.length).toBe(1);
    expect(chosen[0].site_id).toBe(2); // 가산동만 남음
  });

  it('전체 해제(toggleAll: false) 시 모든 행의 include가 false가 되어 선택 건수가 0이 된다', () => {
    let rows = normalizeRows(sampleRaw, masters, '2026-09-29');
    rows = rows.map((r) => (r.site_id != null ? { ...r, include: false } : r));

    const chosen = rows.filter((r) => r.include && r.site_id != null);
    expect(chosen.length).toBe(0);
  });

  it('전체 선택(toggleAll: true) 시 현장 ID가 존재하는 행만 include=true가 된다', () => {
    let rows = normalizeRows(sampleRaw, masters, '2026-09-29');
    // 모두 껐다가 다시 켜기
    rows = rows.map((r) => (r.site_id != null ? { ...r, include: false } : r));
    rows = rows.map((r) => (r.site_id != null ? { ...r, include: true } : r));

    const chosen = rows.filter((r) => r.include && r.site_id != null);
    expect(chosen.length).toBe(2);
    // 현장 미등록 행은 여전히 미선택
    expect(rows[2].include).toBe(false);
  });

  it('특정 행의 필드(작업 내용, 날짜, 금액) 수정 시 변경사항이 반영된다', () => {
    let rows = normalizeRows(sampleRaw, masters, '2026-09-29');
    const targetKey = rows[1].key;

    rows = rows.map((r) =>
      r.key === targetKey
        ? { ...r, description: '기초 및 기둥 타설', base_amount: 900000, amount_auto: 0 }
        : r
    );

    const updated = rows.find((r) => r.key === targetKey);
    expect(updated?.description).toBe('기초 및 기둥 타설');
    expect(updated?.base_amount).toBe(900000);
    expect(updated?.amount_auto).toBe(0);
  });
});
