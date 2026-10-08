import { describe, expect, it } from 'vitest';
import type { Masters, WorkLogRow } from '../shared/types';
import { markDuplicates, matchSite, normalizeRows, photoDate } from '../src/lib/photoLog';
import { extractJsonArray } from '../worker/routes/photoLogs';

const site = (id: number, client_id: number, name: string, label: string, archived = 0) =>
  ({ id, client_id, name, label, archived }) as Masters['sites'][number];

const masters = {
  sites: [
    site(3, 2, '한강', '나래(한강)'),
    site(11, 2, '금강', '나래(금강)'),
    site(8, 3, '다솜', '다솜'),
    site(2, 8, '광장', '아라(광장)'),
    site(4, 7, '양재', '새봄(양재)'),
    site(99, 7, '옛현장', '새봄(옛현장)', 1),
  ],
  operators: [
    { id: 10, name: '박', archived: 0 },
    { id: 9, name: '이', archived: 0 },
    { id: 1, name: '김', archived: 0 },
  ],
  rates: [
    { site_id: 3, boom_size: 42, half_day_amount: null, full_day_amount: 1_400_000 },
    { site_id: 4, boom_size: 32, half_day_amount: 700_000, full_day_amount: 1_000_000 },
  ],
} as unknown as Masters;

// 2026-09-29 시험 사진을 Llama 4 Scout 가 읽은 그대로
const AI_ROWS = [
  { date: '8/25', site: '나래(한강)', work: '1단벽체', time: '07:00~17:00', m: 42, ot: 0, pour: 150, amount: null, operator: '박' },
  { date: '9/1', site: '아라(광장)', work: '벽체', time: '07:00~17:00', m: 42, ot: 0, pour: 150, amount: null, operator: '박' },
  { date: '', site: '다솜', work: '기초', time: '7~16', m: 37, ot: 0, pour: null, amount: null, operator: '이' },
  { date: '9/3', site: '새봄(양재)', work: '채움', time: '07:00~12:00', m: 32, ot: 0, pour: null, amount: 700000, operator: '김' },
];

describe('사진에서 읽은 줄 다듬기', () => {
  const rows = normalizeRows(AI_ROWS, masters, '2026-09-29');

  it('날짜를 한 번만 적고 이어 쓴 줄은 윗줄 날짜', () => {
    expect(rows.map((r) => r.work_date)).toEqual(['2026-08-25', '2026-09-01', '2026-09-01', '2026-09-03']);
  });

  it('현장·기사님을 목록에 맞춘다', () => {
    expect(rows.map((r) => r.site_id)).toEqual([3, 2, 8, 4]);
    expect(rows.map((r) => r.operator_id)).toEqual([10, 10, 9, 1]);
  });

  it('시간은 「07:00~16:00」 꼴로', () => {
    expect(rows[2].time).toBe('07:00~16:00');
  });

  it('금액을 못 읽었으면 단가표에서 채우고 「자동」, 적혀 있으면 그대로', () => {
    expect([rows[0].base_amount, rows[0].amount_auto]).toEqual([1_400_000, 1]);
    expect([rows[3].base_amount, rows[3].amount_auto]).toEqual([700_000, 0]); // 반나절 70만 — 적힌 대로
    expect([rows[1].base_amount, rows[1].amount_auto]).toEqual([0, 0]); // 아라(광장)는 단가 미등록
  });

  it('「140만」 처럼 적힌 금액도 알아듣는다', () => {
    const [r] = normalizeRows([{ date: '9/1', site: '다솜', amount: '140만' }], masters, '2026-09-29');
    expect(r.base_amount).toBe(1_400_000);
  });
});

describe('현장 이름 맞추기', () => {
  it('띄어쓰기·괄호가 달라도', () => {
    expect(matchSite('나래 한강', masters.sites)).toBe(3);
  });
  it('현장 이름만 적어도 하나로 떨어지면', () => {
    expect(matchSite('광장', masters.sites)).toBe(2);
  });
  it('여럿에 걸리거나 모르면 비워 두고 부모님께 고르시게 한다', () => {
    expect(matchSite('나래', masters.sites)).toBeNull();
    expect(matchSite('가산동', masters.sites)).toBeNull();
  });
  it('보관한 현장에는 붙이지 않는다', () => {
    expect(matchSite('새봄(옛현장)', masters.sites)).toBeNull();
  });
});

describe('날짜', () => {
  it('1월에 찍은 12월 장부는 작년', () => {
    expect(photoDate('12/28', '2027-01-03')).toBe('2026-12-28');
  });
  it('이상한 날짜는 모른다고 한다', () => {
    expect(photoDate('13/40', '2026-09-29')).toBeNull();
  });
});

describe('이미 장부에 있는 줄 가리기', () => {
  const log = (id: number, work_date: string, site_id: number, boom: number, operator_id: number | null) =>
    ({ id, work_date, site_id, boom_size: boom, operator_id, site_label: '나래(한강)', operator_name: '박' }) as WorkLogRow;

  it('같은 날·현장·규격이면 이미 있는 것으로 보고 꺼 둔다', () => {
    const rows = markDuplicates(normalizeRows(AI_ROWS, masters, '2026-09-29'), [log(76, '2026-08-25', 3, 42, 10)]);
    expect(rows[0].duplicateOf?.id).toBe(76);
    expect(rows[0].include).toBe(false);
    expect(rows.slice(1).every((r) => r.duplicateOf == null && r.include)).toBe(true);
  });

  it('같은 날 같은 현장에 두 대가 갔는데 장부에 한 줄뿐이면, 남는 한 줄은 새 작업', () => {
    const two = normalizeRows(
      [
        { date: '8/25', site: '나래(한강)', m: 42, operator: '박' },
        { date: '8/25', site: '나래(한강)', m: 42, operator: '이' },
      ],
      masters,
      '2026-09-29'
    );
    const rows = markDuplicates(two, [log(76, '2026-08-25', 3, 42, 10)]);
    expect(rows.map((r) => r.duplicateOf?.id ?? null)).toEqual([76, null]);
  });

  it('기사님이 다르게 적혀 있으면 다른 작업', () => {
    const rows = markDuplicates(
      normalizeRows([{ date: '8/25', site: '나래(한강)', m: 42, operator: '이' }], masters, '2026-09-29'),
      [log(76, '2026-08-25', 3, 42, 10)]
    );
    expect(rows[0].duplicateOf).toBeNull();
  });
});

describe('모델 답에서 JSON 꺼내기', () => {
  it('```json 울타리·앞뒤 말이 붙어도', () => {
    expect(extractJsonArray('네, 옮겼습니다.\n```json\n[{"date":"9/1"}]\n```')).toEqual([{ date: '9/1' }]);
  });
  it('배열이 없으면 null', () => {
    expect(extractJsonArray('읽을 수 없습니다')).toBeNull();
  });
});

describe('이미 있는 줄 표시', () => {
  it('날짜는 「9/1」 꼴', () => {
    const [row] = markDuplicates(
      normalizeRows([{ date: '9/1', site: '다솜', m: 37 }], masters, '2026-09-29'),
      [{ id: 5, work_date: '2026-09-01', site_id: 8, boom_size: 37, operator_id: null, site_label: '다솜', operator_name: null } as WorkLogRow]
    );
    expect(row.duplicateOf?.label).toBe('9/1 다솜 37M');
  });
});
